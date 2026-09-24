import { createHash } from "node:crypto";
import { newId } from "@altyapi/commerce-core";
import {
  and,
  eq,
  externalListings,
  externalOrders,
  inArray,
  integrationConnections,
  integrationSyncRuns,
  sql,
  stores,
  withPlatformTx,
  withTenantTx,
  type ExternalOrderLine,
  type Transaction,
} from "@altyapi/database";
import { decryptJson, encryptJson } from "@altyapi/secrets";
import { buildConnector, credentialsContext, MemorySession, requireKeys, sessionContext, type ConnectionRow, type IntegrationDeps } from "./connections";
import { ProviderAuthError, RateLimitedError } from "./http";
import { reconcileStore } from "./reconcile";
import { PROVIDERS } from "./registry";
import type { Connector, ExternalListingInput, ExternalOrderInput, NormalizedOrderStatus } from "./types";

/** Pages fetched per resource in one run; a longer pass continues in the next run. */
const PAGE_BUDGET = { orders: 25, listings: 40 } as const;
/** Listing snapshots are heavier than orders; refresh them at most this often. */
const LISTINGS_EVERY_MS = 60 * 60_000;
/** Lease while a worker syncs a connection (a crashed run is retried after it). */
const LEASE_MS = 15 * 60_000;

const hash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v instanceof Date ? v.toISOString() : v)))
    .digest("hex");

/** Lifecycle order used to keep partial updates from moving an order backwards. */
const RANK: Record<NormalizedOrderStatus, number> = {
  unknown: 0,
  pending_payment: 1,
  awaiting_approval: 2,
  processing: 3,
  ready_to_ship: 4,
  shipped: 5,
  undelivered: 6,
  delivered: 7,
  returned: 8,
  cancelled: 8,
};
const later = (a: NormalizedOrderStatus, b: NormalizedOrderStatus) => (RANK[b] >= RANK[a] ? b : a);

type OrderRow = typeof externalOrders.$inferSelect;

function mergeLines(existing: ExternalOrderLine[], incoming: ExternalOrderLine[]): ExternalOrderLine[] {
  const byId = new Map(existing.map((l, i) => [l.externalId ?? `#${i}`, l]));
  for (const l of incoming) {
    const key = l.externalId ?? `#new${byId.size}`;
    const prev = byId.get(key);
    const next = { ...(prev ?? {}), ...Object.fromEntries(Object.entries(l).filter(([, v]) => v !== null && v !== "")) } as ExternalOrderLine;
    if (!next.name) next.name = prev?.name ?? "—";
    byId.set(key, next);
  }
  return [...byId.values()];
}

function lineTotal(lines: ExternalOrderLine[]): bigint | null {
  let sum = 0n;
  for (const l of lines) {
    if (l.status === "cancelled") continue;
    if (l.unitPrice === null) return null;
    sum += BigInt(l.unitPrice) * BigInt(l.quantity);
  }
  return sum;
}

/** Computes the stored state for an incoming order, honouring partial-update modes. */
function nextOrderState(prev: OrderRow | undefined, o: ExternalOrderInput) {
  if (!o.merge || !prev) {
    const lines = o.lines;
    const status = o.merge === "lines" && lines.length && lines.every((l) => l.status === "cancelled") ? "cancelled" : o.status;
    return {
      externalNumber: o.externalNumber,
      channel: o.channel,
      rawStatus: o.rawStatus,
      status,
      currency: o.currency,
      total: o.total ?? (o.merge === "lines" ? lineTotal(lines) : null),
      itemCount: lines.reduce((s, l) => s + (l.status === "cancelled" ? 0 : l.quantity), 0),
      lines,
      shipping: o.shipping,
      customer: o.customer,
      orderedAt: o.orderedAt,
      externalUpdatedAt: o.externalUpdatedAt,
    };
  }
  const prevStatus = prev.status as NormalizedOrderStatus;
  if (o.merge === "status") {
    return {
      externalNumber: prev.externalNumber ?? o.externalNumber,
      channel: prev.channel ?? o.channel,
      rawStatus: RANK[o.status] >= RANK[prevStatus] ? o.rawStatus : prev.rawStatus,
      status: later(prevStatus, o.status),
      currency: prev.currency,
      total: prev.total,
      itemCount: prev.itemCount,
      lines: prev.lines,
      shipping: o.shipping ?? prev.shipping,
      customer: prev.customer,
      orderedAt: prev.orderedAt,
      externalUpdatedAt: o.externalUpdatedAt ?? prev.externalUpdatedAt,
    };
  }
  const lines = mergeLines(prev.lines, o.lines);
  const allCancelled = lines.length > 0 && lines.every((l) => l.status === "cancelled");
  return {
    externalNumber: prev.externalNumber ?? o.externalNumber,
    channel: prev.channel ?? o.channel,
    rawStatus: allCancelled ? "Cancelled" : RANK[o.status] >= RANK[prevStatus] && o.status !== "cancelled" ? o.rawStatus : prev.rawStatus,
    status: allCancelled ? ("cancelled" as const) : o.status === "cancelled" ? prevStatus : later(prevStatus, o.status),
    currency: prev.currency,
    total: lineTotal(lines) ?? prev.total,
    itemCount: lines.reduce((s, l) => s + (l.status === "cancelled" ? 0 : l.quantity), 0),
    lines,
    shipping: o.shipping ?? prev.shipping,
    customer: prev.customer ?? o.customer,
    orderedAt: prev.orderedAt ?? o.orderedAt,
    externalUpdatedAt: o.externalUpdatedAt && (!prev.externalUpdatedAt || o.externalUpdatedAt > prev.externalUpdatedAt) ? o.externalUpdatedAt : prev.externalUpdatedAt,
  };
}

export async function upsertOrders(tx: Transaction, conn: ConnectionRow, items: ExternalOrderInput[]) {
  let changed = 0;
  let unchanged = 0;
  // Several partial rows for one order can arrive in the same page; apply them in sequence.
  const ids = [...new Set(items.map((i) => i.externalId))];
  const rows = ids.length
    ? await tx.select().from(externalOrders).where(and(eq(externalOrders.connectionId, conn.id), inArray(externalOrders.externalId, ids)))
    : [];
  const current = new Map(rows.map((r) => [r.externalId, r]));
  const touched = new Set<string>();
  for (const item of items) {
    const prev = current.get(item.externalId);
    const state = nextOrderState(prev, item);
    const payloadHash = hash(state);
    if (prev && prev.payloadHash === payloadHash) {
      unchanged += 1;
      if (!touched.has(item.externalId)) await tx.update(externalOrders).set({ lastSeenAt: new Date() }).where(eq(externalOrders.id, prev.id));
      touched.add(item.externalId);
      continue;
    }
    changed += 1;
    touched.add(item.externalId);
    if (prev) {
      const [row] = await tx.update(externalOrders).set({ ...state, payloadHash, lastSeenAt: new Date() }).where(eq(externalOrders.id, prev.id)).returning();
      current.set(item.externalId, row!);
    } else {
      const [row] = await tx
        .insert(externalOrders)
        .values({ id: newId(), organizationId: conn.organizationId, storeId: conn.storeId, connectionId: conn.id, provider: conn.provider, externalId: item.externalId, ...state, payloadHash })
        .returning();
      current.set(item.externalId, row!);
    }
  }
  return { changed, unchanged };
}

export async function upsertListings(tx: Transaction, conn: ConnectionRow, items: ExternalListingInput[]) {
  let changed = 0;
  let unchanged = 0;
  for (let i = 0; i < items.length; i += 500) {
    const chunk = items.slice(i, i + 500);
    const rows = await tx
      .select({ id: externalListings.id, externalId: externalListings.externalId, payloadHash: externalListings.payloadHash })
      .from(externalListings)
      .where(and(eq(externalListings.connectionId, conn.id), inArray(externalListings.externalId, chunk.map((c) => c.externalId))));
    const current = new Map(rows.map((r) => [r.externalId, r]));
    const same: string[] = [];
    for (const item of chunk) {
      const payloadHash = hash(item);
      const prev = current.get(item.externalId);
      if (prev?.payloadHash === payloadHash) {
        unchanged += 1;
        same.push(prev.id);
        continue;
      }
      changed += 1;
      const values = { ...item, payloadHash, lastSeenAt: new Date() };
      if (prev) await tx.update(externalListings).set({ ...values, variantId: null }).where(eq(externalListings.id, prev.id));
      else await tx.insert(externalListings).values({ id: newId(), organizationId: conn.organizationId, storeId: conn.storeId, connectionId: conn.id, provider: conn.provider, ...values });
    }
    if (same.length) await tx.update(externalListings).set({ lastSeenAt: new Date() }).where(inArray(externalListings.id, same));
  }
  return { changed, unchanged };
}

/** Atomically leases due connections so two workers never sync the same one. */
export async function claimDueConnections(deps: IntegrationDeps, limit = 5): Promise<ConnectionRow[]> {
  return withPlatformTx(deps.db, async (tx) => {
    const due = await tx.execute<{ id: string }>(sql`
      select id from integration_connections
      where status = 'active' and next_sync_at <= now()
      order by next_sync_at
      limit ${limit}
      for update skip locked`);
    if (!due.length) return [];
    return tx
      .update(integrationConnections)
      .set({ nextSyncAt: new Date(Date.now() + LEASE_MS) })
      .where(inArray(integrationConnections.id, due.map((d) => d.id)))
      .returning();
  });
}

interface ResourceOutcome {
  fetched: number;
  changed: number;
  unchanged: number;
  hasMore: boolean;
  passCompleted: boolean;
}

async function runResource(
  deps: IntegrationDeps,
  conn: ConnectionRow,
  cursors: Record<string, unknown>,
  resource: "orders" | "listings",
  pull: (cursor: Record<string, unknown>) => Promise<{ items: unknown[]; cursor: Record<string, unknown>; done: boolean }>,
): Promise<ResourceOutcome> {
  const scope = { organizationId: conn.organizationId, storeId: conn.storeId };
  const runId = newId();
  await withTenantTx(deps.db, scope, (tx) => tx.insert(integrationSyncRuns).values({ id: runId, ...scope, connectionId: conn.id, resource }));
  const out: ResourceOutcome = { fetched: 0, changed: 0, unchanged: 0, hasMore: false, passCompleted: false };
  let cursor = (cursors[resource] as Record<string, unknown> | undefined) ?? {};
  try {
    for (let page = 0; page < PAGE_BUDGET[resource]; page++) {
      const result = await pull(cursor);
      out.fetched += result.items.length;
      await withTenantTx(deps.db, scope, async (tx) => {
        const r =
          resource === "orders"
            ? await upsertOrders(tx, conn, result.items as ExternalOrderInput[])
            : await upsertListings(tx, conn, result.items as ExternalListingInput[]);
        out.changed += r.changed;
        out.unchanged += r.unchanged;
        cursor = result.cursor;
        cursors[resource] = cursor;
        // The cursor is saved with the page it belongs to, so a crash resumes exactly here.
        await tx.update(integrationConnections).set({ cursors: { ...cursors } }).where(eq(integrationConnections.id, conn.id));
      });
      if (result.done) {
        out.passCompleted = true;
        break;
      }
      out.hasMore = page === PAGE_BUDGET[resource] - 1;
    }
    await withTenantTx(deps.db, scope, (tx) =>
      tx
        .update(integrationSyncRuns)
        .set({ status: out.hasMore ? "partial" : "succeeded", fetched: out.fetched, changed: out.changed, unchanged: out.unchanged, hasMore: out.hasMore, finishedAt: new Date() })
        .where(eq(integrationSyncRuns.id, runId)),
    );
    return out;
  } catch (err) {
    await withTenantTx(deps.db, scope, (tx) =>
      tx
        .update(integrationSyncRuns)
        .set({
          status: err instanceof RateLimitedError ? "partial" : "failed",
          fetched: out.fetched,
          changed: out.changed,
          unchanged: out.unchanged,
          hasMore: true,
          error: (err instanceof Error ? err.message : String(err)).slice(0, 1000),
          finishedAt: new Date(),
        })
        .where(eq(integrationSyncRuns.id, runId)),
    );
    throw err;
  }
}

/**
 * One sync run for a leased connection: orders (every run) and listing snapshots (hourly,
 * or continuing an unfinished pass), then reconciliation after a complete listing pass.
 */
export async function syncConnection(deps: IntegrationDeps, conn: ConnectionRow): Promise<void> {
  const provider = PROVIDERS[conn.provider as keyof typeof PROVIDERS];
  const scope = { organizationId: conn.organizationId, storeId: conn.storeId };
  const keys = requireKeys(deps.keys);
  const store = await withPlatformTx(deps.db, (tx) => tx.query.stores.findFirst({ where: eq(stores.id, conn.storeId) }));
  const credentials = await decryptJson(keys, conn.credentials, credentialsContext(conn.storeId, conn.provider));
  const settings = provider.settingsSchema.parse(conn.settings);
  const session = new MemorySession(conn.session ? await decryptJson(keys, conn.session, sessionContext(conn.storeId, conn.provider)) : null);
  const connector: Connector = buildConnector(deps, provider, { connectionId: conn.id, credentials, settings, session, defaultCurrency: store?.defaultCurrency ?? "TRY" });
  const cursors: Record<string, unknown> = { ...conn.cursors };

  let hasMore = false;
  let retryAfterMs: number | null = null;
  let failure: unknown = null;
  try {
    if (provider.capabilities.readOrders && connector.pullOrders) {
      const r = await runResource(deps, conn, cursors, "orders", (c) => connector.pullOrders!(c));
      hasMore ||= r.hasMore;
    }
    const listingsDue = Number(cursors.listingsCompletedAt ?? 0) + LISTINGS_EVERY_MS <= Date.now();
    const listingPassOpen = Object.keys((cursors.listings as Record<string, unknown>) ?? {}).length > 0;
    if (provider.capabilities.readListings && connector.pullListings && (listingsDue || listingPassOpen)) {
      if (!listingPassOpen) cursors.listingsPassStartedAt = Date.now();
      const r = await runResource(deps, conn, cursors, "listings", (c) => connector.pullListings!(c));
      hasMore ||= r.hasMore;
      if (r.passCompleted) {
        cursors.listingsCompletedAt = Date.now();
        // Listings not seen since the pass started are gone at the provider.
        await reconcileStore(deps, scope, conn.id, new Date(Number(cursors.listingsPassStartedAt ?? Date.now()) - 60_000));
      }
    }
  } catch (err) {
    failure = err;
    if (err instanceof RateLimitedError) retryAfterMs = err.retryAfterMs;
  }

  const sessionEnvelope = session.dirty ? (session.snapshot() ? await encryptJson(keys, session.snapshot(), sessionContext(conn.storeId, conn.provider)) : null) : undefined;
  const now = Date.now();
  const failures = failure && !(failure instanceof RateLimitedError) ? conn.consecutiveFailures + 1 : 0;
  const backoffMs = failures ? Math.min(conn.pollIntervalMinutes * 60_000 * 2 ** failures, 6 * 3600_000) : 0;
  const nextSyncAt = new Date(
    retryAfterMs !== null ? now + Math.max(retryAfterMs, 30_000) : failures ? now + backoffMs : hasMore ? now + 60_000 : now + conn.pollIntervalMinutes * 60_000,
  );
  await withTenantTx(deps.db, scope, (tx) =>
    tx
      .update(integrationConnections)
      .set({
        cursors,
        ...(sessionEnvelope !== undefined ? { session: sessionEnvelope } : {}),
        lastSyncAt: new Date(now),
        ...(failure ? {} : { lastSuccessAt: new Date(now) }),
        lastError: failure ? (failure instanceof Error ? failure.message : String(failure)).slice(0, 1000) : null,
        consecutiveFailures: failures,
        nextSyncAt,
        // Rejected credentials stop polling until the merchant fixes them.
        ...(failure instanceof ProviderAuthError ? { status: "error" as const } : {}),
      })
      .where(eq(integrationConnections.id, conn.id)),
  );
  if (failure && !(failure instanceof RateLimitedError)) deps.logger.warn({ err: failure, connectionId: conn.id, provider: conn.provider }, "integration sync failed");
}

/** Worker tick: lease and sync due connections one after another. */
export async function runDueSyncs(deps: IntegrationDeps, limit = 5): Promise<number> {
  const due = await claimDueConnections(deps, limit);
  for (const conn of due) {
    try {
      await syncConnection(deps, conn);
    } catch (err) {
      deps.logger.error({ err, connectionId: conn.id }, "integration sync crashed");
    }
  }
  return due.length;
}

/** Job entry point: the scheduler leased the connection; run its sync now. */
export async function syncConnectionById(deps: IntegrationDeps, connectionId: string): Promise<boolean> {
  const conn = await withPlatformTx(deps.db, (tx) => tx.query.integrationConnections.findFirst({ where: eq(integrationConnections.id, connectionId) }));
  if (!conn || conn.status !== "active") return false;
  await syncConnection(deps, conn);
  return true;
}
