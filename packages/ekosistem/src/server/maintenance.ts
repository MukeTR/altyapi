import {
  and,
  eq,
  ekosistemCodes,
  ekosistemDeliveries,
  ekosistemEventReceipts,
  ekosistemLinks,
  ekosistemTombstones,
  inArray,
  lt,
  ne,
  sql,
  withPlatformTx,
  yanitVisibilitySnapshots,
  type EkosistemRevokeDelivery,
} from "@altyapi/database";
import { TOMBSTONE_RETENTION_DAYS } from "../constants";
import { EkosistemPeerError } from "../errors";
import { linkCredentials, type EkosistemServerDeps, type LinkRow } from "./common";
import { deleteReadModel, READ_MODEL_TABLES, type ReadModelName } from "./consume/read-models";

/**
 * Background upkeep of the bridge (worker): expiry of unapproved links, delivery of
 * revocations to peers, and retention of codes, receipts, tombstones and revoked links.
 * All of it is cross-tenant system work and runs in platform transactions.
 */

const DAY_MS = 86_400_000;
/** Revoked links (and, through the cascade, the read models pulled with them) are kept this long (§4.4). */
const REVOKED_LINK_RETENTION_DAYS = 30;
const RECEIPT_RETENTION_DAYS = 7;
/** Sent or abandoned pushes are kept a week for diagnosis. */
const DELIVERY_RETENTION_DAYS = 7;
/** Yanıt visibility history kept for trend views. */
const VISIBILITY_HISTORY_DAYS = 400;
const CODE_RETENTION_DAYS = 1;
/** Revocation retry backoff: 1, 2, 4 … minutes, at most 6 hours between attempts, for 72 hours. */
const REVOKE_BACKOFF_BASE_MS = 60_000;
const REVOKE_BACKOFF_MAX_MS = 6 * 3600_000;

/** pending / awaiting_approval links are deleted 10 minutes after they were created or confirmed (§4.3). */
export async function purgeExpiredPendingLinks(deps: Pick<EkosistemServerDeps, "db">, now: Date = new Date()): Promise<number> {
  const rows = await withPlatformTx(deps.db, (tx) =>
    tx
      .delete(ekosistemLinks)
      .where(and(inArray(ekosistemLinks.status, ["pending", "awaiting_approval"]), lt(ekosistemLinks.pendingExpiresAt, now)))
      .returning({ id: ekosistemLinks.id }),
  );
  return rows.length;
}

/** Retention: used/expired codes, push receipts, tombstones (30 days, orders 90) and revoked links after 30 days. */
export async function purgeEkosistemRetention(deps: Pick<EkosistemServerDeps, "db">, now: Date = new Date()): Promise<Record<string, number>> {
  return withPlatformTx(deps.db, async (tx) => {
    const codes = await tx.delete(ekosistemCodes).where(lt(ekosistemCodes.expiresAt, new Date(now.getTime() - CODE_RETENTION_DAYS * DAY_MS))).returning({ id: ekosistemCodes.id });
    const receipts = await tx
      .delete(ekosistemEventReceipts)
      .where(lt(ekosistemEventReceipts.receivedAt, new Date(now.getTime() - RECEIPT_RETENTION_DAYS * DAY_MS)))
      .returning({ id: ekosistemEventReceipts.id });
    let tombstones = 0;
    for (const [resource, days] of Object.entries(TOMBSTONE_RETENTION_DAYS) as Array<[keyof typeof TOMBSTONE_RETENTION_DAYS, number]>) {
      const r = await tx
        .delete(ekosistemTombstones)
        .where(and(eq(ekosistemTombstones.resource, resource), lt(ekosistemTombstones.deletedAt, new Date(now.getTime() - days * DAY_MS))))
        .returning({ id: ekosistemTombstones.id });
      tombstones += r.length;
    }
    const links = await tx
      .delete(ekosistemLinks)
      .where(
        and(
          eq(ekosistemLinks.status, "revoked"),
          lt(ekosistemLinks.revokedAt, new Date(now.getTime() - REVOKED_LINK_RETENTION_DAYS * DAY_MS)),
          sql`(${ekosistemLinks.revokeDelivery} is null or ${ekosistemLinks.revokeDelivery}->>'deliveredAt' is not null or (${ekosistemLinks.revokeDelivery}->>'giveUpAt')::timestamptz < ${now.toISOString()}::timestamptz)`,
        ),
      )
      .returning({ id: ekosistemLinks.id });
    const deliveries = await tx
      .delete(ekosistemDeliveries)
      .where(and(ne(ekosistemDeliveries.status, "pending"), lt(ekosistemDeliveries.updatedAt, new Date(now.getTime() - DELIVERY_RETENTION_DAYS * DAY_MS))))
      .returning({ id: ekosistemDeliveries.id });
    const visibility = await tx
      .delete(yanitVisibilitySnapshots)
      .where(lt(yanitVisibilitySnapshots.asOf, new Date(now.getTime() - VISIBILITY_HISTORY_DAYS * DAY_MS)))
      .returning({ id: yanitVisibilitySnapshots.id });
    return { codes: codes.length, receipts: receipts.length, tombstones, revokedLinks: links.length, deliveries: deliveries.length, visibilityHistory: visibility.length };
  });
}

/**
 * §4.4 data deletion for what altyapi consumed: read models pulled under a link are deleted
 * at the latest 30 days after the link was revoked (profitability and alerts, which carry
 * cost information, already went at revocation), even while the link row itself is kept.
 */
export async function purgeRevokedReadModels(deps: Pick<EkosistemServerDeps, "db">, now: Date = new Date()): Promise<number> {
  return withPlatformTx(deps.db, async (tx) => {
    const revoked = await tx
      .select({ id: ekosistemLinks.id })
      .from(ekosistemLinks)
      .where(and(eq(ekosistemLinks.status, "revoked"), lt(ekosistemLinks.revokedAt, new Date(now.getTime() - REVOKED_LINK_RETENTION_DAYS * DAY_MS))))
      .limit(200);
    let removed = 0;
    for (const link of revoked) {
      for (const model of Object.keys(READ_MODEL_TABLES) as ReadModelName[]) removed += await deleteReadModel(tx, link.id, model);
    }
    return removed;
  });
}

function nextDelivery(state: EkosistemRevokeDelivery, now: Date, error: string | null, delivered: boolean): EkosistemRevokeDelivery {
  if (delivered) return { ...state, attempts: state.attempts + 1, deliveredAt: now.toISOString(), nextAttemptAt: null, lastError: null };
  const attempts = state.attempts + 1;
  const wait = Math.min(REVOKE_BACKOFF_MAX_MS, REVOKE_BACKOFF_BASE_MS * 2 ** Math.min(attempts - 1, 20));
  const next = new Date(now.getTime() + wait);
  const giveUp = Date.parse(state.giveUpAt);
  return { ...state, attempts, lastError: error, nextAttemptAt: next.getTime() < giveUp ? next.toISOString() : null };
}

/**
 * Tells peers about local revocations: DELETE {peer}/ekosistem/v1/links/{linkId}, retried
 * with exponential backoff for 72 hours (§4.4). A peer that no longer knows the link
 * (link_invalid / not_found) counts as delivered.
 */
export async function deliverRevocations(deps: EkosistemServerDeps, now: Date = new Date(), limit = 20): Promise<number> {
  const due = await withPlatformTx(deps.db, (tx) =>
    tx
      .select()
      .from(ekosistemLinks)
      .where(
        and(
          eq(ekosistemLinks.status, "revoked"),
          sql`${ekosistemLinks.revokeDelivery} is not null`,
          sql`${ekosistemLinks.revokeDelivery}->>'deliveredAt' is null`,
          sql`${ekosistemLinks.revokeDelivery}->>'nextAttemptAt' is not null`,
          sql`(${ekosistemLinks.revokeDelivery}->>'nextAttemptAt')::timestamptz <= ${now.toISOString()}::timestamptz`,
        ),
      )
      .limit(limit),
  );
  if (!due.length || !deps.keys) return 0;
  let handled = 0;
  for (const link of due as LinkRow[]) {
    const state = link.revokeDelivery!;
    let delivered = false;
    let error: string | null = null;
    try {
      await deps.peers.deleteLink(link.peerProduct, await linkCredentials(deps.keys, link));
      delivered = true;
    } catch (err) {
      if (err instanceof EkosistemPeerError && (err.code === "link_invalid" || err.code === "not_found")) delivered = true;
      else error = err instanceof EkosistemPeerError ? err.code : err instanceof Error ? err.name : "error";
    }
    const next = nextDelivery(state, now, error, delivered);
    await withPlatformTx(deps.db, (tx) => tx.update(ekosistemLinks).set({ revokeDelivery: next }).where(eq(ekosistemLinks.id, link.id)));
    if (!delivered && next.nextAttemptAt === null) deps.logger.warn({ linkId: link.id, peer: link.peerProduct, attempts: next.attempts }, "ekosistem revocation could not be delivered within 72 hours");
    handled++;
  }
  return handled;
}
