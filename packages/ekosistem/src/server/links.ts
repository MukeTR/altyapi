import { and, eq, ekosistemLinks, inArray, karmatikAlerts, karmatikProfitSnapshots, lt, ne, type DbExecutor, type EkosistemRevokeDelivery } from "@altyapi/database";
import { appendEvent, type DomainEventMap } from "@altyapi/events";
import { PENDING_LINK_TTL_SECONDS, REVOKE_DELIVERY_WINDOW_SECONDS, SELF_PRODUCT, type PeerProduct } from "../constants";
import { EkosistemError } from "../errors";
import type { LinkStatusResponse } from "../schemas";
import { ownAccount, type LinkRow, type StoreIdentity } from "./common";

/**
 * Link lifecycle helpers shared by the peer-facing endpoints, the admin API and the worker
 * (docs/ekosistem/v1.md §4). States: pending → awaiting_approval → active → revoked.
 */

export type LinkChange = DomainEventMap["ekosistem.link_changed"]["change"];

export function pendingExpiry(now: Date): Date {
  return new Date(now.getTime() + PENDING_LINK_TTL_SECONDS * 1000);
}

/** pending / awaiting_approval links older than 10 minutes serve nothing and count as deleted (§4.3). */
export function isExpiredPending(link: Pick<LinkRow, "status" | "pendingExpiresAt">, now: Date): boolean {
  return (link.status === "pending" || link.status === "awaiting_approval") && link.pendingExpiresAt !== null && link.pendingExpiresAt <= now;
}

/** A link that still exists for the peer: not revoked and not an expired pending link. */
export function isLive(link: Pick<LinkRow, "status" | "pendingExpiresAt">, now: Date): boolean {
  return link.status !== "revoked" && !isExpiredPending(link, now);
}

/** Removes this store's expired pending links to a peer so a new link can be made (one live link per pair, §4.1). */
export async function purgeExpiredPending(tx: DbExecutor, storeId: string, peer: PeerProduct, now: Date): Promise<void> {
  await tx
    .delete(ekosistemLinks)
    .where(
      and(
        eq(ekosistemLinks.storeId, storeId),
        eq(ekosistemLinks.peerProduct, peer),
        inArray(ekosistemLinks.status, ["pending", "awaiting_approval"]),
        lt(ekosistemLinks.pendingExpiresAt, now),
      ),
    );
}

/** The store's live (non-revoked, non-expired) link to a peer, if any. */
export async function findLiveLink(tx: DbExecutor, storeId: string, peer: PeerProduct, now: Date): Promise<LinkRow | null> {
  const rows = await tx
    .select()
    .from(ekosistemLinks)
    .where(and(eq(ekosistemLinks.storeId, storeId), eq(ekosistemLinks.peerProduct, peer), ne(ekosistemLinks.status, "revoked")));
  return rows.find((r) => isLive(r, now)) ?? null;
}

/** GET /ekosistem/v1/links/{linkId} answer: our own account and what we grant the peer (§4.4). */
export function linkStatusView(link: LinkRow, identity: StoreIdentity): LinkStatusResponse {
  // Revoked links are answered with 401 link_invalid before reaching a handler.
  if (link.status === "revoked") throw new EkosistemError("link_invalid");
  return {
    linkId: link.id,
    status: link.status,
    product: SELF_PRODUCT,
    account: ownAccount(identity),
    grants: [...link.grantedScopes],
  };
}

/** Admin view of a link. Secrets, nonce hashes and cursors are never returned. */
export function adminLinkView(link: LinkRow, now: Date = new Date()) {
  return {
    id: link.id,
    peerProduct: link.peerProduct,
    role: link.role,
    status: isExpiredPending(link, now) ? ("expired" as const) : link.status,
    peerAccount: link.peerAccount,
    /** What the peer may read from this store. */
    grantedScopes: link.grantedScopes,
    /** What this store may read from the peer. */
    peerScopes: link.peerScopes,
    pendingExpiresAt: link.pendingExpiresAt,
    approvedAt: link.approvedAt,
    revokedAt: link.revokedAt,
    revokeReason: link.revokeReason,
    revokeDelivery: link.revokeDelivery
      ? { attempts: link.revokeDelivery.attempts, deliveredAt: link.revokeDelivery.deliveredAt, lastError: link.revokeDelivery.lastError, giveUpAt: link.revokeDelivery.giveUpAt }
      : null,
    rotatedAt: link.rotatedAt,
    lastPullAt: link.lastPullAt,
    lastError: link.lastError,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  };
}

export type AdminLinkView = ReturnType<typeof adminLinkView>;

export async function emitLinkChanged(tx: DbExecutor, link: Pick<LinkRow, "id" | "organizationId" | "storeId" | "peerProduct">, change: LinkChange, grants?: string[]): Promise<void> {
  await appendEvent(tx, {
    type: "ekosistem.link_changed",
    organizationId: link.organizationId,
    storeId: link.storeId,
    aggregateType: "ekosistem_link",
    aggregateId: link.id,
    payload: { linkId: link.id, peerProduct: link.peerProduct, change, ...(grants ? { grants } : {}) },
  });
}

export interface RevokeOptions {
  reason: "user" | "rejected" | "peer_deleted" | "peer_unverified" | "peer_rejected" | "revoked_by_peer" | "store_closed";
  /** Queue DELETE {peer}/ekosistem/v1/links/{linkId}, retried for 72 hours (§4.4). */
  notifyPeer: boolean;
  now: Date;
}

/**
 * Revokes a link locally: it stops serving and pulling at once. Data read with profit:read
 * (profitability and the alerts derived from it) carries cost information and is deleted
 * immediately; the other read models are deleted by the worker within 30 days (§4.4).
 */
export async function revokeLinkTx(tx: DbExecutor, link: LinkRow, opts: RevokeOptions): Promise<LinkRow> {
  const delivery: EkosistemRevokeDelivery | null = opts.notifyPeer
    ? {
        attempts: 0,
        nextAttemptAt: opts.now.toISOString(),
        lastError: null,
        deliveredAt: null,
        giveUpAt: new Date(opts.now.getTime() + REVOKE_DELIVERY_WINDOW_SECONDS * 1000).toISOString(),
      }
    : null;
  const [row] = await tx
    .update(ekosistemLinks)
    .set({ status: "revoked", revokedAt: opts.now, revokeReason: opts.reason, pendingExpiresAt: null, revokeDelivery: delivery })
    .where(and(eq(ekosistemLinks.id, link.id), ne(ekosistemLinks.status, "revoked")))
    .returning();
  if (!row) {
    const [current] = await tx.select().from(ekosistemLinks).where(eq(ekosistemLinks.id, link.id));
    return current ?? link;
  }
  await tx.delete(karmatikProfitSnapshots).where(eq(karmatikProfitSnapshots.linkId, link.id));
  await tx.delete(karmatikAlerts).where(eq(karmatikAlerts.linkId, link.id));
  const change: LinkChange = opts.reason === "rejected" ? "rejected" : opts.reason === "revoked_by_peer" || opts.reason === "peer_deleted" ? "revoked_by_peer" : "revoked";
  await emitLinkChanged(tx, row, change);
  return row;
}
