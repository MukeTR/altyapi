import { randomUUID } from "node:crypto";
import { and, eq, ekosistemEventReceipts, ekosistemLinks, inArray, isNull, lte, sql, withPlatformTx, withTenantTx, type Transaction } from "@altyapi/database";
import { enqueueJob } from "@altyapi/events";
import { INCREMENTAL_MAX_LIMIT, LINK_INVALID_MIN_INTERVAL_SECONDS, LINK_INVALID_REVOKE_THRESHOLD, PULL_MIN_INTERVAL_MS, SINCE_OVERLAP_MS } from "../constants";
import { EkosistemPeerError, type PeerErrorCode } from "../errors";
import type { IncrementalParams, IncrementalResult, PeerLinkCredentials } from "../peer-client";
import type { Tombstone } from "../schemas";
import { hasAnyScope } from "../scopes";
import { linkCredentials, type EkosistemServerDeps, type LinkRow } from "./common";
import {
  deleteReadModel,
  deleteTombstoned,
  recordVisibility,
  replaceCitations,
  replaceGaps,
  storeAlerts,
  storeCompetitorPrices,
  storeOpportunities,
  storeProfit,
  storeSuggestions,
  type IncrementalReadModel,
} from "./consume/read-models";
import { RESOURCE_DEFS, readResourceState, resourceAllowed, resourcesOf, type PullResource, type ResourceState } from "./consume/resources";
import { revokeLinkTx } from "./links";
import { loadLinkById } from "./links-peer";
import { PULL_JOB_TYPE, pushTypesFor } from "./receiver";

/**
 * Pulls peer data into altyapi's read models (§7.5). Incremental resources keep
 * `since` = previous asOf − 10 minutes and resume from their cursor when a run stops at the
 * page cap; each page is stored together with its cursor, so a crash resumes exactly there.
 * Snapshot resources replace the stored set. Every resource is pulled at most hourly on
 * schedule (or after the peer's Cache-Control max-age, whichever is longer); push events
 * trigger an earlier pull of the pushed resource.
 */

const MAX_PAGES_PER_RUN = 25;
/** Wait after a retryable failure (unavailable, rate_limited, timestamp_skew). */
const RETRY_AFTER_FAILURE_MS = 5 * 60_000;
/**
 * The peer's user has not approved the link yet (409 link_pending). As acceptor altyapi is
 * active right after confirm, usually before the issuing user approves; an unapproved link
 * expires after 10 minutes (§4.3), so checking again every minute costs at most ten calls
 * and the first data arrives right after the approval instead of up to 10 minutes later.
 */
const RETRY_AFTER_PENDING_MS = 60_000;
/** The circuit breaker is open for 60 s. */
const RETRY_AFTER_CIRCUIT_MS = 60_000;
/** Scheduler lease: a crashed run makes the link due again after this. */
export const PULL_LEASE_MS = 15 * 60_000;
/** Never look at a link more often than this. */
const MIN_RESCHEDULE_MS = 60_000;
const PULL_LOCK_MS = 10 * 60_000;

export type PullOutcome =
  | { status: "done"; resource: PullResource; upserted: number; deleted: number; invalid: number; events: number; more: boolean }
  | { status: "skipped"; resource: PullResource; reason: "unknown_link" | "wrong_peer" | "not_active" | "scope_missing" | "not_configured" | "busy" }
  | { status: "failed"; resource: PullResource; code: PeerErrorCode; retryable: boolean; circuitOpen: boolean; linkInvalid: boolean; revoked: boolean };

interface PassResult {
  upserted: number;
  deleted: number;
  invalid: number;
  events: number;
  more: boolean;
  state: ResourceState;
}

const tenant = (link: Pick<LinkRow, "organizationId" | "storeId">) => ({ organizationId: link.organizationId, storeId: link.storeId });

/** The link was revoked, or lost the resource's scope, while a pass was running. */
class LinkNoLongerReadable extends Error {
  constructor(readonly reason: "not_active" | "scope_missing") {
    super(`ekosistem link ${reason} during pull`);
  }
}

type ProfitMode = "full" | "summary";

const profitMode = (link: Pick<LinkRow, "peerScopes">): ProfitMode => (hasAnyScope(link.peerScopes, "profit:read") ? "full" : "summary");

/**
 * Re-reads the link inside a store transaction and keeps it locked (FOR SHARE) until that
 * transaction ends. A revocation or a scope change updates the row, so it either waits for
 * the page being stored and then removes it, or commits first and the pass stops here: a
 * running pull never writes read models for a link that may no longer read them.
 */
async function lockReadableLink(tx: Transaction, linkId: string, resource: PullResource, mode: ProfitMode | null): Promise<void> {
  const [row] = await tx.select().from(ekosistemLinks).where(eq(ekosistemLinks.id, linkId)).for("share");
  if (!row || row.status !== "active") throw new LinkNoLongerReadable("not_active");
  if (!resourceAllowed(row, resource) || (mode !== null && profitMode(row) !== mode)) throw new LinkNoLongerReadable("scope_missing");
}

/** Merges one resource's state into link.cursors without touching the other resources. */
function mergeStateSql(resource: PullResource, state: ResourceState) {
  return sql`${ekosistemLinks.cursors} || ${JSON.stringify({ [RESOURCE_DEFS[resource].key]: state })}::jsonb`;
}

// ---------------------------------------------------------------------------
// link_invalid bookkeeping (§4.4)
// ---------------------------------------------------------------------------

/**
 * Three link_invalid answers at least 10 minutes apart mean the peer removed the link:
 * it becomes revoked (reason revoked_by_peer) and the owner is notified (§4.4).
 */
export async function recordLinkInvalid(deps: EkosistemServerDeps, link: LinkRow, now: Date = new Date()): Promise<boolean> {
  if (link.lastLinkInvalidAt && now.getTime() - link.lastLinkInvalidAt.getTime() < LINK_INVALID_MIN_INTERVAL_SECONDS * 1000) return false;
  return withTenantTx(deps.db, tenant(link), async (tx) => {
    // Re-read under lock: the pull, push and decision senders may all see link_invalid at once.
    const [current] = await tx.select().from(ekosistemLinks).where(eq(ekosistemLinks.id, link.id)).for("update");
    if (!current || current.status === "revoked") return current?.status === "revoked";
    if (current.lastLinkInvalidAt && now.getTime() - current.lastLinkInvalidAt.getTime() < LINK_INVALID_MIN_INTERVAL_SECONDS * 1000) return false;
    const count = current.consecutiveLinkInvalid + 1;
    await tx.update(ekosistemLinks).set({ consecutiveLinkInvalid: count, lastLinkInvalidAt: now, lastError: "link_invalid" }).where(eq(ekosistemLinks.id, link.id));
    if (count < LINK_INVALID_REVOKE_THRESHOLD) return false;
    await revokeLinkTx(tx, current, { reason: "revoked_by_peer", notifyPeer: false, now });
    return true;
  });
}

// ---------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------

async function incrementalPass<T>(
  deps: EkosistemServerDeps,
  link: LinkRow,
  resource: PullResource,
  state: ResourceState,
  fetch: (params: IncrementalParams) => Promise<IncrementalResult<T>>,
  store: (tx: Transaction, items: T[], tombstones: Tombstone[], detectNew: boolean) => Promise<{ upserted: number; deleted: number; events: number }>,
): Promise<PassResult> {
  const out: PassResult = { upserted: 0, deleted: 0, invalid: 0, events: 0, more: false, state: { ...state } };
  // The very first full pass is existing state, not change: it raises no internal events.
  const detectNew = state.since !== null;
  let cursor = state.cursor;
  for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
    const result = await fetch({ since: state.since ?? undefined, cursor: cursor ?? undefined, limit: INCREMENTAL_MAX_LIMIT });
    if (result.invalid.length) {
      out.invalid += result.invalid.length;
      deps.logger.warn({ linkId: link.id, resource, invalid: result.invalid.slice(0, 5) }, "ekosistem records outside the contract were skipped");
    }
    cursor = result.nextCursor;
    const next: ResourceState = cursor
      ? { ...out.state, cursor }
      : { ...out.state, cursor: null, since: new Date(Date.parse(result.asOf) - SINCE_OVERLAP_MS).toISOString(), asOf: result.asOf };
    await withTenantTx(deps.db, tenant(link), async (tx) => {
      await lockReadableLink(tx, link.id, resource, resource === "profit" ? profitMode(link) : null);
      const r = await store(tx, result.items, result.tombstones, detectNew);
      out.upserted += r.upserted;
      out.deleted += r.deleted;
      out.events += r.events;
      // The cursor is saved with the page it belongs to.
      await tx.update(ekosistemLinks).set({ cursors: mergeStateSql(resource, next) }).where(eq(ekosistemLinks.id, link.id));
    });
    out.state = next;
    if (!cursor) return out;
  }
  out.more = true;
  return out;
}

/** Store step of a resource without internal events: upsert the items, delete the tombstoned refs. */
function withTombstones<T>(link: LinkRow, model: IncrementalReadModel, upsert: (tx: Transaction, link: LinkRow, items: T[]) => Promise<number>) {
  return async (tx: Transaction, items: T[], tombstones: Tombstone[]) => ({
    upserted: await upsert(tx, link, items),
    deleted: await deleteTombstoned(tx, link, model, tombstones),
    events: 0,
  });
}

async function runPass(deps: EkosistemServerDeps, link: LinkRow, resource: PullResource, creds: PeerLinkCredentials, state: ResourceState): Promise<PassResult> {
  const peers = deps.peers;
  switch (resource) {
    case "profit": {
      const full = hasAnyScope(link.peerScopes, "profit:read");
      if (full) {
        return incrementalPass(deps, link, resource, state, (p) => peers.karmatikProfitVariants(creds, p), async (tx, items, tombstones, detectNew) => {
          const r = await storeProfit(tx, link, items.map((item) => ({ kind: "full" as const, item })), { detectNew });
          return { upserted: r.upserted, deleted: await deleteTombstoned(tx, link, "profit", tombstones), events: r.breaches };
        });
      }
      return incrementalPass(deps, link, resource, state, (p) => peers.karmatikProfitSummaries(creds, p), async (tx, items, tombstones, detectNew) => {
        const r = await storeProfit(tx, link, items.map((item) => ({ kind: "summary" as const, item })), { detectNew });
        return { upserted: r.upserted, deleted: await deleteTombstoned(tx, link, "profit", tombstones), events: r.breaches };
      });
    }
    case "suggestions":
      return incrementalPass(deps, link, resource, state, (p) => peers.karmatikSuggestions(creds, p), withTombstones(link, "suggestions", storeSuggestions));
    case "competitors":
      return incrementalPass(deps, link, resource, state, (p) => peers.karmatikCompetitorPrices(creds, p), withTombstones(link, "competitors", storeCompetitorPrices));
    case "alerts":
      return incrementalPass(deps, link, resource, state, (p) => peers.karmatikAlerts(creds, p), withTombstones(link, "alerts", storeAlerts));
    case "opportunities":
      return incrementalPass(deps, link, resource, state, (p) => peers.yanitOpportunities(creds, p), withTombstones(link, "opportunities", storeOpportunities));
    case "visibility": {
      const out: PassResult = { upserted: 0, deleted: 0, invalid: 0, events: 0, more: false, state: { ...state } };
      let asOf: string | null = null;
      let maxAge: number | null = null;
      for (const windowDays of [7, 30] as const) {
        const { summary, maxAgeSeconds } = await peers.yanitVisibilitySummary(creds, windowDays);
        if (summary.windowDays !== windowDays) throw new EkosistemPeerError("invalid_response", 200, `summary for windowDays=${windowDays} answered windowDays=${summary.windowDays}`);
        const r = await withTenantTx(deps.db, tenant(link), async (tx) => {
          await lockReadableLink(tx, link.id, resource, null);
          return recordVisibility(tx, link, summary);
        });
        out.upserted += r.inserted ? 1 : 0;
        out.events += r.changed ? 1 : 0;
        asOf = summary.asOf;
        maxAge = maxAgeSeconds === null ? maxAge : Math.max(maxAge ?? 0, maxAgeSeconds);
      }
      out.state = { ...out.state, asOf, maxAgeSeconds: maxAge };
      return out;
    }
    case "gaps": {
      const snap = await peers.yanitGaps(creds);
      if (snap.invalid.length) deps.logger.warn({ linkId: link.id, resource, invalid: snap.invalid.slice(0, 5) }, "ekosistem records outside the contract were skipped");
      const r = await withTenantTx(deps.db, tenant(link), async (tx) => {
        await lockReadableLink(tx, link.id, resource, null);
        return replaceGaps(tx, link, snap.items, new Date(snap.asOf));
      });
      return { upserted: r.upserted, deleted: r.deleted, invalid: snap.invalid.length, events: 0, more: false, state: { ...state, asOf: snap.asOf, maxAgeSeconds: snap.maxAgeSeconds } };
    }
    case "citations": {
      const windowDays = 30;
      const snap = await peers.yanitCitations(creds, windowDays);
      if (snap.invalid.length) deps.logger.warn({ linkId: link.id, resource, invalid: snap.invalid.slice(0, 5) }, "ekosistem records outside the contract were skipped");
      const r = await withTenantTx(deps.db, tenant(link), async (tx) => {
        await lockReadableLink(tx, link.id, resource, null);
        return replaceCitations(tx, link, windowDays, snap.items, new Date(snap.asOf));
      });
      return { upserted: r.upserted, deleted: r.deleted, invalid: snap.invalid.length, events: 0, more: false, state: { ...state, asOf: snap.asOf, maxAgeSeconds: snap.maxAgeSeconds } };
    }
  }
}

// ---------------------------------------------------------------------------
// One resource
// ---------------------------------------------------------------------------

async function acquireLock(deps: EkosistemServerDeps, key: string): Promise<(() => Promise<void>) | null> {
  if (!deps.redis) return async () => undefined;
  const token = randomUUID();
  try {
    if ((await deps.redis.set(key, token, "PX", PULL_LOCK_MS, "NX")) !== "OK") return null;
  } catch (err) {
    deps.logger.warn({ err }, "ekosistem pull lock unavailable; pulling without it");
    return async () => undefined;
  }
  return async () => {
    try {
      await deps.redis!.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, key, token);
    } catch {
      // The lock expires on its own.
    }
  };
}

/** Removes what a link pulled for a resource it may no longer read, and forgets its pull state. */
export async function dropResource(deps: EkosistemServerDeps, link: LinkRow, resource: PullResource): Promise<number> {
  return withTenantTx(deps.db, tenant(link), async (tx) => {
    const n = await deleteReadModel(tx, link.id, RESOURCE_DEFS[resource].readModel);
    await tx
      .update(ekosistemLinks)
      .set({ cursors: sql`${ekosistemLinks.cursors} - ${RESOURCE_DEFS[resource].key}::text` })
      .where(eq(ekosistemLinks.id, link.id));
    return n;
  });
}

/**
 * Runs one pass of a resource for a link. Failures are recorded in the resource state and
 * returned (never thrown); link_invalid is counted towards revoked_by_peer.
 */
export async function pullResource(deps: EkosistemServerDeps, link: LinkRow, resource: PullResource, now: Date = new Date()): Promise<PullOutcome> {
  const def = RESOURCE_DEFS[resource];
  if (link.peerProduct !== def.peer) return { status: "skipped", resource, reason: "wrong_peer" };
  if (link.status !== "active") return { status: "skipped", resource, reason: "not_active" };
  if (!resourceAllowed(link, resource)) return { status: "skipped", resource, reason: "scope_missing" };
  if (!deps.peers.isConfigured(link.peerProduct)) return { status: "skipped", resource, reason: "not_configured" };
  if (!deps.keys) throw new Error("ekosistem pull needs a key provider to decrypt the link secret");

  let state = readResourceState(link, resource);
  if (resource === "profit") {
    // profit:read and profit:summary return different shapes: a scope change restarts the resource.
    const mode = profitMode(link);
    if (state.mode !== null && state.mode !== mode) {
      await dropResource(deps, link, resource);
      state = readResourceState({ cursors: {} }, resource);
    }
    state.mode = mode;
  }

  const release = await acquireLock(deps, `ekosistem:pull:${link.id}:${resource}`);
  if (!release) return { status: "skipped", resource, reason: "busy" };
  try {
    const creds = await linkCredentials(deps.keys, link);
    let pass: PassResult;
    try {
      pass = await runPass(deps, link, resource, creds, state);
    } catch (err) {
      if (err instanceof LinkNoLongerReadable) return { status: "skipped", resource, reason: err.reason };
      if (!(err instanceof EkosistemPeerError)) throw err;
      return await recordFailure(deps, link, resource, state, err, now);
    }
    const finished: ResourceState = pass.more
      ? { ...pass.state, retryAt: null, error: null, errorAt: null }
      : { ...pass.state, cursor: null, pulledAt: now.toISOString(), retryAt: null, error: null, errorAt: null };
    try {
      await withTenantTx(deps.db, tenant(link), async (tx) => {
        await lockReadableLink(tx, link.id, resource, resource === "profit" ? profitMode(link) : null);
        await tx
          .update(ekosistemLinks)
          .set({ cursors: mergeStateSql(resource, finished), lastPullAt: now, lastError: null, consecutiveLinkInvalid: 0, lastLinkInvalidAt: null })
          .where(eq(ekosistemLinks.id, link.id));
        const types = pushTypesFor(resource);
        if (!pass.more && types.length) {
          await tx
            .update(ekosistemEventReceipts)
            .set({ processedAt: now })
            .where(and(eq(ekosistemEventReceipts.linkId, link.id), inArray(ekosistemEventReceipts.type, types), isNull(ekosistemEventReceipts.processedAt), lte(ekosistemEventReceipts.receivedAt, now)));
        }
      });
    } catch (err) {
      if (err instanceof LinkNoLongerReadable) return { status: "skipped", resource, reason: err.reason };
      throw err;
    }
    return { status: "done", resource, upserted: pass.upserted, deleted: pass.deleted, invalid: pass.invalid, events: pass.events, more: pass.more };
  } finally {
    await release();
  }
}

async function recordFailure(deps: EkosistemServerDeps, link: LinkRow, resource: PullResource, state: ResourceState, err: EkosistemPeerError, now: Date): Promise<PullOutcome> {
  const base = { status: "failed" as const, resource, code: err.code, retryable: err.retryable, circuitOpen: err.circuitOpen, linkInvalid: false, revoked: false };
  if (err.code === "link_invalid") {
    const revoked = await recordLinkInvalid(deps, link, now);
    return { ...base, linkInvalid: true, revoked };
  }
  if (err.code === "signature_invalid" || err.code === "timestamp_skew") deps.logger.warn({ linkId: link.id, resource, code: err.code }, "ekosistem peer rejected our signature");
  const wait = err.circuitOpen
    ? RETRY_AFTER_CIRCUIT_MS
    : err.code === "link_pending"
      ? RETRY_AFTER_PENDING_MS
      : err.retryable
        ? Math.max(RETRY_AFTER_FAILURE_MS, err.retryAfterMs ?? 0)
        : PULL_MIN_INTERVAL_MS;
  const failed: ResourceState = { ...state, retryAt: new Date(now.getTime() + wait).toISOString(), error: err.code, errorAt: now.toISOString() };
  await withTenantTx(deps.db, tenant(link), (tx) =>
    tx
      .update(ekosistemLinks)
      .set({ cursors: mergeStateSql(resource, failed), lastError: `${RESOURCE_DEFS[resource].key}: ${err.code}`.slice(0, 500) })
      .where(eq(ekosistemLinks.id, link.id)),
  );
  deps.logger.warn({ linkId: link.id, resource, code: err.code, peerRequestId: err.requestId }, "ekosistem pull failed");
  return base;
}

// ---------------------------------------------------------------------------
// Push-triggered pulls (job ekosistem.pull)
// ---------------------------------------------------------------------------

/**
 * Job entry point for a pull triggered by a peer push (§10). A pass that stopped at the page
 * cap enqueues its continuation.
 */
export async function pullLinkResource(deps: EkosistemServerDeps, linkId: string, resource: PullResource, now: Date = new Date()): Promise<PullOutcome> {
  const link = await loadLinkById(deps, linkId);
  if (!link) return { status: "skipped", resource, reason: "unknown_link" };
  const outcome = await pullResource(deps, link, resource, now);
  if (outcome.status === "done" && outcome.more && deps.queue) {
    await enqueueJob(deps.queue, { type: PULL_JOB_TYPE, payload: { linkId: link.id, resource }, organizationId: link.organizationId, storeId: link.storeId });
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Scheduled pulls (job ekosistem.pull-link)
// ---------------------------------------------------------------------------

export const PULL_LINK_JOB_TYPE = "ekosistem.pull-link";

/** When a resource is due again: resume at once, else after a failure's retryAt, else hourly (or max-age). */
export function resourceDueAt(state: ResourceState, now: Date): Date {
  if (state.cursor) return now;
  if (state.retryAt) return new Date(state.retryAt);
  if (!state.pulledAt) return now;
  const interval = Math.max(PULL_MIN_INTERVAL_MS, (state.maxAgeSeconds ?? 0) * 1000);
  return new Date(Date.parse(state.pulledAt) + interval);
}

/**
 * Atomically leases active links whose next pull is due (SKIP LOCKED), so two workers never
 * pull the same link. The lease moves nextPullAt forward; runLinkPull sets the real value.
 */
export async function claimDueLinks(deps: Pick<EkosistemServerDeps, "db">, limit = 20): Promise<Array<Pick<LinkRow, "id" | "organizationId" | "storeId" | "peerProduct">>> {
  return withPlatformTx(deps.db, async (tx) => {
    const due = await tx.execute<{ id: string }>(sql`
      select id from ekosistem_links
       where status = 'active' and (next_pull_at is null or next_pull_at <= now())
       order by next_pull_at nulls first
       limit ${limit}
       for update skip locked`);
    if (!due.length) return [];
    return tx
      .update(ekosistemLinks)
      .set({ nextPullAt: sql`now() + ${`${PULL_LEASE_MS} milliseconds`}::interval` })
      .where(inArray(ekosistemLinks.id, due.map((d) => d.id)))
      .returning({ id: ekosistemLinks.id, organizationId: ekosistemLinks.organizationId, storeId: ekosistemLinks.storeId, peerProduct: ekosistemLinks.peerProduct });
  });
}

export interface LinkPullSummary {
  linkId: string;
  outcomes: PullOutcome[];
  nextPullAt: Date | null;
}

async function setNextPull(deps: EkosistemServerDeps, link: LinkRow, at: Date): Promise<void> {
  await withTenantTx(deps.db, tenant(link), (tx) =>
    tx.update(ekosistemLinks).set({ nextPullAt: at }).where(and(eq(ekosistemLinks.id, link.id), eq(ekosistemLinks.status, "active"))),
  );
}

/**
 * Scheduled pull of one link: every resource the peer granted and that is due. Resources the
 * link may no longer read are dropped. Stops early when the link is gone, not approved at
 * the peer yet, or its circuit breaker is open.
 */
export async function runLinkPull(deps: EkosistemServerDeps, linkId: string, now: Date = new Date()): Promise<LinkPullSummary> {
  const link = await loadLinkById(deps, linkId);
  const summary: LinkPullSummary = { linkId, outcomes: [], nextPullAt: null };
  if (!link || link.status !== "active") return summary;
  const minNext = new Date(now.getTime() + MIN_RESCHEDULE_MS);

  if (!deps.peers.isConfigured(link.peerProduct)) {
    summary.nextPullAt = new Date(now.getTime() + PULL_MIN_INTERVAL_MS);
    await setNextPull(deps, link, summary.nextPullAt);
    return summary;
  }
  if ((await deps.peers.circuitState(link.peerProduct, link.id)) === "open") {
    summary.nextPullAt = new Date(now.getTime() + RETRY_AFTER_CIRCUIT_MS);
    await setNextPull(deps, link, summary.nextPullAt);
    return summary;
  }

  let stopUntil: Date | null = null;
  for (const resource of resourcesOf(link.peerProduct)) {
    // Re-read before each resource: the link may have been revoked or narrowed meanwhile.
    const current = await loadLinkById(deps, linkId);
    if (!current || current.status !== "active") return summary;
    const state = readResourceState(current, resource);
    if (!resourceAllowed(current, resource)) {
      // The peer narrowed its grants: data read under the lost scope goes away (§4.4).
      if (Object.hasOwn(current.cursors, RESOURCE_DEFS[resource].key)) {
        const removed = await dropResource(deps, current, resource);
        deps.logger.info({ linkId, resource, removed }, "ekosistem read model dropped after scope change");
      }
      continue;
    }
    if (resourceDueAt(state, now) > now) continue;
    const outcome = await pullResource(deps, current, resource, now);
    summary.outcomes.push(outcome);
    if (outcome.status !== "failed") continue;
    if (outcome.linkInvalid) return summary;
    if (outcome.circuitOpen) stopUntil = new Date(now.getTime() + RETRY_AFTER_CIRCUIT_MS);
    else if (outcome.code === "link_pending") stopUntil = new Date(now.getTime() + RETRY_AFTER_PENDING_MS);
    if (stopUntil) break;
  }

  const fresh = await loadLinkById(deps, linkId);
  if (!fresh || fresh.status !== "active") return summary;
  let next: Date;
  if (stopUntil) next = stopUntil;
  else {
    const dues = resourcesOf(fresh.peerProduct)
      .filter((r) => resourceAllowed(fresh, r))
      .map((r) => resourceDueAt(readResourceState(fresh, r), now).getTime());
    next = new Date(dues.length ? Math.min(...dues) : now.getTime() + PULL_MIN_INTERVAL_MS);
  }
  summary.nextPullAt = next < minNext ? minNext : next;
  await setNextPull(deps, fresh, summary.nextPullAt);
  return summary;
}
