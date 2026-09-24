import { newId } from "@altyapi/commerce-core";
import {
  and,
  eq,
  ekosistemDeliveries,
  ekosistemLinks,
  inArray,
  orders,
  pages,
  products,
  publications,
  sql,
  withPlatformTx,
  withTenantTx,
  type DbExecutor,
} from "@altyapi/database";
import type { DomainEventType, EventEnvelope } from "@altyapi/events";
import { PUSH_COALESCE_MS, PUSH_MAX_ATTEMPTS, PUSH_MAX_BACKOFF_MS, PUSH_RATE_PER_MINUTE } from "../constants";
import { EkosistemPeerError } from "../errors";
import { scopesForPushEvent, type PushEventType } from "../scopes";
import { linkCredentials, type EkosistemServerDeps, type LinkRow } from "./common";
import { recordLinkInvalid } from "./pull";

/**
 * Outbound pushes (§10). Internal domain events become `altyapi.*` push notifications for
 * every active link whose peer holds the matching read scope. A delivery that was not sent
 * yet collects further changes of the same (type, ref) for 30 seconds; it is then sent
 * signed (with nonce) to POST {peer}/ekosistem/v1/events, at most 5 attempts with
 * exponential backoff capped at 1 hour, after which it is dropped (the next pull reconciles).
 */

/** Domain events that change what a peer reads from altyapi. */
export const PUSH_SOURCE_EVENTS = [
  "product.created",
  "product.updated",
  "product.published",
  "product.deleted",
  "order.confirmed",
  "order.cancelled",
  "order.fulfilled",
  "refund.completed",
  // Every live storefront change (publish, unpublish, scheduled publishing, rollback) moves
  // the publication pointer, so this one event covers theme and page changes.
  "storefront.publication_switched",
] as const satisfies readonly DomainEventType[];

const PUSH_BACKOFF_BASE_MS = 60_000;
/** A leased delivery is retried by another sender after this. */
const PUSH_LEASE_MS = 2 * 60_000;
const CIRCUIT_RETRY_MS = 60_000;

export interface PushTarget {
  type: PushEventType;
  ref: string;
}

interface Scope {
  organizationId: string;
  storeId: string;
}

/** Storefront orders that the orders endpoint serves (§7.3): confirmed once, never drafts or awaiting payment. */
async function isServedOrder(tx: DbExecutor, storeId: string, orderId: string): Promise<boolean> {
  const [row] = await tx
    .select({ source: orders.source, confirmedAt: orders.confirmedAt, status: orders.status })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.storeId, storeId)));
  return !!row && row.source === "storefront" && row.confirmedAt !== null && row.status !== "draft" && row.status !== "awaiting_payment";
}

/**
 * Maps a domain event to the push it causes, or null. Changes to products that were never
 * published and to orders the orders endpoint does not serve are invisible to peers.
 */
export async function pushTargetFor(tx: DbExecutor, event: Pick<EventEnvelope, "type" | "payload" | "storeId">): Promise<PushTarget | null> {
  const storeId = event.storeId;
  if (!storeId) return null;
  const payload = event.payload as Record<string, unknown>;
  const id = (key: string) => (typeof payload[key] === "string" ? (payload[key] as string) : null);
  switch (event.type) {
    case "product.created":
    case "product.updated": {
      const productId = id("productId");
      if (!productId) return null;
      const [p] = await tx.select({ publishedAt: products.publishedAt }).from(products).where(and(eq(products.id, productId), eq(products.storeId, storeId)));
      return p && p.publishedAt !== null ? { type: "altyapi.product.updated", ref: productId } : null;
    }
    case "product.published": {
      const productId = id("productId");
      return productId ? { type: "altyapi.product.updated", ref: productId } : null;
    }
    case "product.deleted": {
      const productId = id("productId");
      return productId ? { type: "altyapi.product.deleted", ref: productId } : null;
    }
    case "order.confirmed":
    case "order.cancelled":
    case "order.fulfilled":
    case "refund.completed": {
      const orderId = id("orderId");
      return orderId && (await isServedOrder(tx, storeId, orderId)) ? { type: "altyapi.order.updated", ref: orderId } : null;
    }
    case "storefront.publication_switched": {
      const publicationId = id("publicationId");
      const previousId = id("previousPublicationId");
      // The initial publication is created with the store, before any link can exist.
      if (!publicationId || !previousId) return null;
      const rows = await tx
        .select({ id: publications.id, themeVersionId: publications.themeVersionId, pageVersions: publications.pageVersions })
        .from(publications)
        .where(and(eq(publications.storeId, storeId), inArray(publications.id, [publicationId, previousId])));
      const current = rows.find((r) => r.id === publicationId);
      const previous = rows.find((r) => r.id === previousId);
      if (!current || !previous) return null;
      const changed = [...new Set([...Object.keys(previous.pageVersions), ...Object.keys(current.pageVersions)])].filter(
        (pageId) => previous.pageVersions[pageId] !== current.pageVersions[pageId],
      );
      if (!changed.length && current.themeVersionId === previous.themeVersionId) return null;
      const changedPages = changed.length
        ? await tx.select({ id: pages.id, type: pages.type }).from(pages).where(and(eq(pages.storeId, storeId), inArray(pages.id, changed)))
        : [];
      // One content page changed: push that page. A theme or template change, several pages or a
      // deleted page re-render more than one URL; the home page then stands for the content set.
      const only = changedPages.length === 1 && changed.length === 1 && current.themeVersionId === previous.themeVersionId ? changedPages[0]! : null;
      if (only && (only.type === "home" || only.type === "page" || only.type === "landing")) return { type: "altyapi.content.updated", ref: only.id };
      const [home] = await tx.select({ id: pages.id }).from(pages).where(and(eq(pages.storeId, storeId), eq(pages.type, "home"))).limit(1);
      return home ? { type: "altyapi.content.updated", ref: home.id } : null;
    }
    default:
      return null;
  }
}

/**
 * Queues a push for every active link of the store whose peer may read the pushed data.
 * Runs inside the caller's transaction; a pending, not-yet-sent delivery of the same
 * (link, type, ref) absorbs the new change (coalescing).
 */
export async function queuePushTx(tx: DbExecutor, scope: Scope, target: PushTarget, occurredAt: Date, now: Date = new Date()): Promise<number> {
  const required = scopesForPushEvent(target.type);
  if (!required) return 0;
  const links = await tx
    .select({ id: ekosistemLinks.id, grantedScopes: ekosistemLinks.grantedScopes })
    .from(ekosistemLinks)
    .where(and(eq(ekosistemLinks.storeId, scope.storeId), eq(ekosistemLinks.status, "active")));
  const eligible = links.filter((l) => required.some((s) => l.grantedScopes.includes(s)));
  if (!eligible.length) return 0;
  const inserted = await tx
    .insert(ekosistemDeliveries)
    .values(
      eligible.map((l) => ({
        id: newId(),
        organizationId: scope.organizationId,
        storeId: scope.storeId,
        linkId: l.id,
        eventId: newId(),
        type: target.type,
        ref: target.ref,
        occurredAt,
        nextAttemptAt: new Date(now.getTime() + PUSH_COALESCE_MS),
      })),
    )
    .onConflictDoNothing()
    .returning({ id: ekosistemDeliveries.id });
  return inserted.length;
}

/** Worker handler: a domain event may cause pushes to the store's linked peers. */
export async function queuePushForDomainEvent(deps: Pick<EkosistemServerDeps, "db">, event: EventEnvelope): Promise<number> {
  if (!event.organizationId || !event.storeId) return 0;
  const scope = { organizationId: event.organizationId, storeId: event.storeId };
  return withTenantTx(deps.db, scope, async (tx) => {
    const target = await pushTargetFor(tx, event);
    if (!target) return 0;
    const occurredAt = Number.isNaN(Date.parse(event.occurredAt)) ? new Date() : new Date(event.occurredAt);
    return queuePushTx(tx, scope, target, occurredAt);
  });
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

type DeliveryRow = typeof ekosistemDeliveries.$inferSelect;

/** Leases due deliveries (SKIP LOCKED) so two senders never send the same one. */
async function leaseDueDeliveries(deps: Pick<EkosistemServerDeps, "db">, now: Date, limit: number): Promise<DeliveryRow[]> {
  return withPlatformTx(deps.db, async (tx) => {
    const due = await tx.execute<{ id: string }>(sql`
      select id from ekosistem_deliveries
       where status = 'pending' and next_attempt_at <= ${now.toISOString()}::timestamptz
         and (leased_until is null or leased_until <= ${now.toISOString()}::timestamptz)
       order by next_attempt_at
       limit ${limit}
       for update skip locked`);
    if (!due.length) return [];
    return tx
      .update(ekosistemDeliveries)
      .set({ leasedUntil: new Date(now.getTime() + PUSH_LEASE_MS) })
      .where(inArray(ekosistemDeliveries.id, due.map((d) => d.id)))
      .returning();
  });
}

function pushBackoffMs(attempts: number): number {
  return Math.min(PUSH_MAX_BACKOFF_MS, PUSH_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

/** Per-link send budget of 120 pushes a minute (§10); Redis problems never block sending. */
async function takeRateSlot(deps: EkosistemServerDeps, linkId: string, now: Date): Promise<boolean> {
  if (!deps.redis) return true;
  const key = `ekosistem:push-rate:${linkId}:${Math.floor(now.getTime() / 60_000)}`;
  try {
    const [[, count]] = (await deps.redis.multi().incr(key).expire(key, 120).exec()) as [[unknown, number], unknown];
    return Number(count) <= PUSH_RATE_PER_MINUTE;
  } catch {
    return true;
  }
}

export interface PushSendSummary {
  leased: number;
  delivered: number;
  failed: number;
  retried: number;
  deferred: number;
}

/**
 * Sends due pushes. A failed attempt is retried with backoff (1, 2, 4, 8 minutes, capped
 * at an hour) up to 5 attempts; link_invalid and contract errors end a delivery at once.
 * An open circuit breaker or the per-link rate limit defers without spending an attempt.
 */
export async function deliverDuePushes(deps: EkosistemServerDeps, now: Date = new Date(), limit = 100): Promise<PushSendSummary> {
  const summary: PushSendSummary = { leased: 0, delivered: 0, failed: 0, retried: 0, deferred: 0 };
  const due = await leaseDueDeliveries(deps, now, limit);
  summary.leased = due.length;
  if (!due.length) return summary;
  const linkIds = [...new Set(due.map((d) => d.linkId))];
  const links = new Map(
    (await withPlatformTx(deps.db, (tx) => tx.select().from(ekosistemLinks).where(inArray(ekosistemLinks.id, linkIds)))).map((l) => [l.id, l as LinkRow]),
  );
  const brokenLinks = new Set<string>();

  const finish = async (d: DeliveryRow, set: Partial<typeof ekosistemDeliveries.$inferInsert>) => {
    await withTenantTx(deps.db, { organizationId: d.organizationId, storeId: d.storeId }, (tx) => tx.update(ekosistemDeliveries).set(set).where(eq(ekosistemDeliveries.id, d.id)));
  };
  // Deferral keeps the row leased-once (leasedUntil set), so it never re-enters coalescing.
  const defer = (d: DeliveryRow, until: Date) => finish(d, { nextAttemptAt: until, leasedUntil: now });

  for (const d of due) {
    const link = links.get(d.linkId);
    if (!link || link.status !== "active") {
      await finish(d, { status: "failed", lastError: "link_inactive" });
      summary.failed++;
      continue;
    }
    if (brokenLinks.has(link.id) || (await deps.peers.circuitState(link.peerProduct, link.id)) === "open") {
      brokenLinks.add(link.id);
      await defer(d, new Date(now.getTime() + CIRCUIT_RETRY_MS));
      summary.deferred++;
      continue;
    }
    if (!(await takeRateSlot(deps, link.id, now))) {
      await defer(d, new Date((Math.floor(now.getTime() / 60_000) + 1) * 60_000));
      summary.deferred++;
      continue;
    }
    const attempts = d.attempts + 1;
    try {
      if (!deps.keys) throw new Error("ekosistem push needs a key provider to decrypt the link secret");
      await deps.peers.pushEvent(link.peerProduct, await linkCredentials(deps.keys, link), {
        id: d.eventId,
        type: d.type,
        occurredAt: d.occurredAt.toISOString(),
        data: { ref: d.ref },
      });
      await finish(d, { status: "delivered", attempts, deliveredAt: new Date(), lastError: null, leasedUntil: now });
      summary.delivered++;
    } catch (err) {
      const peerErr = err instanceof EkosistemPeerError ? err : null;
      if (peerErr?.circuitOpen) {
        brokenLinks.add(link.id);
        await defer(d, new Date(now.getTime() + CIRCUIT_RETRY_MS));
        summary.deferred++;
        continue;
      }
      const code = peerErr ? peerErr.code : err instanceof Error ? err.name : "error";
      if (peerErr?.code === "link_invalid") await recordLinkInvalid(deps, link, now);
      // Contract and link errors do not heal by retrying; transport problems do.
      const retryable = peerErr ? peerErr.retryable : true;
      if (!retryable || attempts >= PUSH_MAX_ATTEMPTS) {
        await finish(d, { status: "failed", attempts, lastError: code, leasedUntil: now });
        summary.failed++;
      } else {
        const wait = Math.max(pushBackoffMs(attempts), Math.min(PUSH_MAX_BACKOFF_MS, peerErr?.retryAfterMs ?? 0));
        await finish(d, { attempts, lastError: code, nextAttemptAt: new Date(now.getTime() + wait), leasedUntil: now });
        summary.retried++;
      }
      if (!peerErr) deps.logger.error({ err, deliveryId: d.id, linkId: link.id }, "ekosistem push failed");
      else if (peerErr.circuitOpen || peerErr.code === "unavailable") brokenLinks.add(link.id);
    }
  }
  return summary;
}
