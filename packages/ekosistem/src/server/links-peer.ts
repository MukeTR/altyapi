import { newId } from "@altyapi/commerce-core";
import { and, eq, ekosistemCodes, ekosistemLinks, gt, isNull, sql, withPlatformTx, withTenantTx } from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { CLAIM_REPLAY_WINDOW_SECONDS, PREVIOUS_SECRET_GRACE_SECONDS, SELF_PRODUCT, isPeerProduct, type PeerProduct } from "../constants";
import { hashClaimNonce, parseEkosistemCode } from "../codes";
import { EkosistemError, EkosistemPeerError } from "../errors";
import type { ClaimRequest, ClaimResponse, ConfirmRequest, LinkStatusResponse } from "../schemas";
import { validateGrants } from "../scopes";
import { generateLinkSecret, sha256Hex } from "../signing";
import {
  decryptLinkSecret,
  encryptLinkSecret,
  linkCredentials,
  loadStoreIdentity,
  ownAccount,
  requireKeysForPeer,
  type EkosistemServerDeps,
  type LinkRow,
} from "./common";
import { deleteReadModel } from "./consume/read-models";
import { RESOURCE_DEFS, resourceAllowed, resourcesOf } from "./consume/resources";
import { emitLinkChanged, findLiveLink, linkStatusView, pendingExpiry, purgeExpiredPending, revokeLinkTx } from "./links";

/**
 * Endpoints the peer calls on altyapi's link resources (docs/ekosistem/v1.md §4.3, §4.4).
 * Every function except claim receives a link whose signature was already verified.
 */

const tenant = (link: Pick<LinkRow, "organizationId" | "storeId">) => ({ organizationId: link.organizationId, storeId: link.storeId });

async function identityFor(deps: EkosistemServerDeps, link: LinkRow) {
  const identity = await withTenantTx(deps.db, tenant(link), (tx) => loadStoreIdentity(tx, link.storeId, deps.storeRootDomain));
  if (!identity) throw new EkosistemError("link_invalid");
  return identity;
}

// ---------------------------------------------------------------------------
// POST /ekosistem/v1/links/claim (unsigned)
// ---------------------------------------------------------------------------

/**
 * Consumes an altyapi-issued code atomically and creates the link in `pending`. Invalid,
 * expired, used or product-mismatched codes all answer 404 code_invalid; a product
 * mismatch does not consume the code. The same code + claimNonce within 10 minutes gets
 * the same answer (network retries), a different nonce gets 404.
 */
export async function claimLinkCode(deps: EkosistemServerDeps, input: ClaimRequest, now: Date = new Date()): Promise<ClaimResponse> {
  const parsed = parseEkosistemCode(input.code);
  if (!parsed || parsed.issuer !== SELF_PRODUCT || !isPeerProduct(input.product)) throw new EkosistemError("code_invalid");
  const peer: PeerProduct = input.product;
  const nonceHash = hashClaimNonce(input.claimNonce);
  const keys = requireKeysForPeer(deps.keys);

  return withPlatformTx(deps.db, async (tx) => {
    // A repeated claim (same code, same nonce, within 10 minutes) receives the original answer.
    const [previous] = await tx.select().from(ekosistemCodes).where(eq(ekosistemCodes.codeHash, parsed.hash));
    if (previous?.usedAt) {
      const withinWindow = previous.usedAt.getTime() > now.getTime() - CLAIM_REPLAY_WINDOW_SECONDS * 1000;
      if (!withinWindow || previous.claimNonceHash !== nonceHash || !previous.linkId || previous.peerProduct !== peer) throw new EkosistemError("code_invalid");
      const [link] = await tx.select().from(ekosistemLinks).where(eq(ekosistemLinks.id, previous.linkId));
      if (!link || link.status === "revoked") throw new EkosistemError("code_invalid");
      const identity = await loadStoreIdentity(tx, link.storeId, deps.storeRootDomain);
      if (!identity) throw new EkosistemError("code_invalid");
      return {
        linkId: link.id,
        product: SELF_PRODUCT,
        secret: await decryptLinkSecret(keys, link.storeId, link.id, link.secret),
        account: ownAccount(identity),
        grants: [...link.grantedScopes],
      };
    }

    // Atomic consumption; the product condition keeps a mismatched claim from using the code up.
    const [code] = await tx
      .update(ekosistemCodes)
      .set({ usedAt: now, claimNonceHash: nonceHash })
      .where(and(eq(ekosistemCodes.codeHash, parsed.hash), isNull(ekosistemCodes.usedAt), gt(ekosistemCodes.expiresAt, now), eq(ekosistemCodes.peerProduct, peer)))
      .returning();
    if (!code) throw new EkosistemError("code_invalid");
    // Checked after the code so a mismatched product answers code_invalid; throwing rolls the
    // consumption back, so a rejected claim never uses the code up.
    const grants = validateGrants(peer, SELF_PRODUCT, input.grants);
    if (!grants.ok) throw new EkosistemError("validation_failed", `Geçersiz kapsamlar: ${grants.invalid.join(", ")}`);

    const identity = await loadStoreIdentity(tx, code.storeId, deps.storeRootDomain);
    if (!identity || identity.status === "closed") throw new EkosistemError("code_invalid");
    await purgeExpiredPending(tx, code.storeId, peer, now);
    // One live link per store and peer (§4.1): the code cannot be used while another exists.
    // Throwing rolls the transaction back, so the code is not consumed.
    if (await findLiveLink(tx, code.storeId, peer, now)) throw new EkosistemError("code_invalid");

    const linkId = newId();
    const linkSecret = generateLinkSecret();
    const envelope = await encryptLinkSecret(keys, code.storeId, linkId, linkSecret);
    const [link] = await tx
      .insert(ekosistemLinks)
      .values({
        id: linkId,
        organizationId: code.organizationId,
        storeId: code.storeId,
        peerProduct: peer,
        role: "issuer",
        status: "pending",
        secret: envelope,
        grantedScopes: code.grants,
        peerScopes: grants.grants,
        peerAccount: input.account,
        claimNonceHash: nonceHash,
        pendingExpiresAt: pendingExpiry(now),
        createdByUserId: code.createdByUserId,
      })
      .returning();
    await tx.update(ekosistemCodes).set({ linkId }).where(eq(ekosistemCodes.id, code.id));
    await recordAudit(tx, {
      organizationId: code.organizationId,
      storeId: code.storeId,
      action: "ekosistem.link_claimed",
      resourceType: "ekosistem_link",
      resourceId: linkId,
      after: { peerProduct: peer, peerAccount: input.account, grantedScopes: code.grants, peerScopes: grants.grants },
    });
    return { linkId: link!.id, product: SELF_PRODUCT, secret: linkSecret, account: ownAccount(identity), grants: [...code.grants] };
  });
}

// ---------------------------------------------------------------------------
// GET /ekosistem/v1/links/{linkId}
// ---------------------------------------------------------------------------

export async function peerLinkStatus(deps: EkosistemServerDeps, link: LinkRow): Promise<LinkStatusResponse> {
  return linkStatusView(link, await identityFor(deps, link));
}

// ---------------------------------------------------------------------------
// POST /ekosistem/v1/links/{linkId}/confirm
// ---------------------------------------------------------------------------

/**
 * The acceptor confirms a claimed link (§4.3 step 3). altyapi then proves the peer by
 * calling GET {peer}/ekosistem/v1/links/{linkId} signed with the new secret: only the peer
 * that really stored the link answers 200 with the same account id. On success the link
 * waits for the approval of the user who issued the code.
 */
export async function handlePeerConfirm(deps: EkosistemServerDeps, link: LinkRow, body: ConfirmRequest, now: Date = new Date()): Promise<LinkStatusResponse> {
  if (link.role !== "issuer") throw new EkosistemError("not_found", "Bu bağlantı için onay beklenmiyor.");
  const peer = link.peerProduct;
  if (body.account.id !== link.peerAccount.id) {
    // A pending link confirmed for another account can never become active; it is removed at
    // once (committed before the answer) so it does not hold the store's slot for this peer.
    if (link.status === "pending") {
      await withTenantTx(deps.db, tenant(link), async (tx) => {
        await revokeLinkTx(tx, link, { reason: "peer_unverified", notifyPeer: false, now });
        await recordAudit(tx, { ...tenant(link), action: "ekosistem.link_peer_unverified", resourceType: "ekosistem_link", resourceId: link.id, metadata: { peerProduct: peer, reason: "account_mismatch" } });
      });
    }
    throw new EkosistemError("peer_unverified", "Onaydaki hesap, kodu kullanan hesapla aynı değil.");
  }
  if (link.status === "awaiting_approval" || link.status === "active") return peerLinkStatus(deps, link);

  const grants = validateGrants(peer, SELF_PRODUCT, body.grants);
  if (!grants.ok) throw new EkosistemError("validation_failed", `Geçersiz kapsamlar: ${grants.invalid.join(", ")}`);

  const keys = requireKeysForPeer(deps.keys);
  let proofOk = false;
  try {
    const answer = await deps.peers.getLink(peer, await linkCredentials(keys, link));
    proofOk = answer.linkId.toLowerCase() === link.id && answer.product === peer && answer.account.id === link.peerAccount.id;
  } catch (err) {
    if (err instanceof EkosistemPeerError && (err.retryable || err.code === "not_configured")) {
      deps.logger.warn({ linkId: link.id, peer, code: err.code }, "ekosistem peer proof could not be performed");
      throw new EkosistemError("unavailable", "Eş ürün doğrulaması şu anda yapılamıyor; lütfen tekrar deneyin.");
    }
    deps.logger.warn({ linkId: link.id, peer, code: err instanceof EkosistemPeerError ? err.code : "error" }, "ekosistem peer proof failed");
  }

  if (!proofOk) {
    // The revocation must commit before the error is returned.
    await withTenantTx(deps.db, tenant(link), async (tx) => {
      await revokeLinkTx(tx, link, { reason: "peer_unverified", notifyPeer: false, now });
      await recordAudit(tx, { ...tenant(link), action: "ekosistem.link_peer_unverified", resourceType: "ekosistem_link", resourceId: link.id, metadata: { peerProduct: peer } });
    });
    throw new EkosistemError("peer_unverified");
  }

  return withTenantTx(deps.db, tenant(link), async (tx) => {
    const [row] = await tx
      .update(ekosistemLinks)
      .set({ status: "awaiting_approval", peerAccount: body.account, peerScopes: grants.grants, pendingExpiresAt: pendingExpiry(now) })
      .where(and(eq(ekosistemLinks.id, link.id), eq(ekosistemLinks.status, "pending")))
      .returning();
    const updated = row ?? (await tx.select().from(ekosistemLinks).where(eq(ekosistemLinks.id, link.id)))[0]!;
    if (row) {
      await recordAudit(tx, {
        ...tenant(link),
        action: "ekosistem.link_confirmed_by_peer",
        resourceType: "ekosistem_link",
        resourceId: link.id,
        after: { status: "awaiting_approval", peerAccount: body.account, peerScopes: grants.grants },
      });
      await emitLinkChanged(tx, updated, "awaiting_approval", grants.grants);
    }
    const identity = await loadStoreIdentity(tx, link.storeId, deps.storeRootDomain);
    if (!identity) throw new EkosistemError("link_invalid");
    return linkStatusView(updated, identity);
  });
}

// ---------------------------------------------------------------------------
// DELETE /ekosistem/v1/links/{linkId}
// ---------------------------------------------------------------------------

/** The peer removed the link: stop serving and pulling at once; nothing is sent back. */
export async function handlePeerRevoke(deps: EkosistemServerDeps, link: LinkRow, now: Date = new Date()): Promise<void> {
  await withTenantTx(deps.db, tenant(link), async (tx) => {
    await revokeLinkTx(tx, link, { reason: "peer_deleted", notifyPeer: false, now });
    await recordAudit(tx, { ...tenant(link), action: "ekosistem.link_revoked_by_peer", resourceType: "ekosistem_link", resourceId: link.id, metadata: { peerProduct: link.peerProduct } });
  });
}

// ---------------------------------------------------------------------------
// POST /ekosistem/v1/links/{linkId}/rotate
// ---------------------------------------------------------------------------

/**
 * Key rotation (§4.4). The new secret is returned once; the previous one stays valid for 24
 * hours on both sides. A repeated call with the same nonce returns the same new secret.
 * Only the current secret may start a rotation; a request signed with the previous secret
 * is accepted only as the retry of the rotation that replaced it (same nonce), checked
 * again here under the row lock.
 */
export async function handlePeerRotate(
  deps: EkosistemServerDeps,
  link: LinkRow,
  nonce: string,
  opts: { signedWithPrevious: boolean },
  now: Date = new Date(),
): Promise<{ secret: string }> {
  const keys = requireKeysForPeer(deps.keys);
  const nonceHash = sha256Hex(nonce);
  return withTenantTx(deps.db, tenant(link), async (tx) => {
    const [current] = await tx.select().from(ekosistemLinks).where(eq(ekosistemLinks.id, link.id)).for("update");
    if (!current || current.status === "revoked") throw new EkosistemError("link_invalid");
    if (current.rotateNonceHash === nonceHash) return { secret: await decryptLinkSecret(keys, current.storeId, current.id, current.secret) };
    // Another rotation happened since verification: the previous secret no longer rotates anything.
    if (opts.signedWithPrevious) throw new EkosistemError("signature_invalid", "Anahtar yenileme mevcut anahtarla imzalanmalıdır.");
    const linkSecret = generateLinkSecret();
    await tx
      .update(ekosistemLinks)
      .set({
        secret: await encryptLinkSecret(keys, current.storeId, current.id, linkSecret),
        previousSecret: current.secret,
        previousSecretValidUntil: new Date(now.getTime() + PREVIOUS_SECRET_GRACE_SECONDS * 1000),
        rotateNonceHash: nonceHash,
        rotatedAt: now,
      })
      .where(eq(ekosistemLinks.id, current.id));
    await recordAudit(tx, { ...tenant(link), action: "ekosistem.link_secret_rotated", resourceType: "ekosistem_link", resourceId: link.id, metadata: { by: link.peerProduct } });
    return { secret: linkSecret };
  });
}

// ---------------------------------------------------------------------------
// PATCH /ekosistem/v1/links/{linkId}
// ---------------------------------------------------------------------------

/** The peer changed what it grants altyapi (§4.4); the owner is notified through the outbox. */
export async function handlePeerPatch(deps: EkosistemServerDeps, link: LinkRow, grants: string[]): Promise<void> {
  const checked = validateGrants(link.peerProduct, SELF_PRODUCT, grants);
  if (!checked.ok) throw new EkosistemError("validation_failed", `Geçersiz kapsamlar: ${checked.invalid.join(", ")}`);
  await withTenantTx(deps.db, tenant(link), async (tx) => {
    const [row] = await tx.update(ekosistemLinks).set({ peerScopes: checked.grants }).where(eq(ekosistemLinks.id, link.id)).returning();
    if (!row) throw new EkosistemError("link_invalid");
    const changed = link.peerScopes.join(" ") !== checked.grants.join(" ");
    if (!changed) return;
    // Data read under a scope the peer took back is removed at once; its pull state is reset.
    const lost = resourcesOf(link.peerProduct).filter((r) => resourceAllowed(link, r) && !resourceAllowed(row, r));
    for (const resource of lost) {
      await deleteReadModel(tx, link.id, RESOURCE_DEFS[resource].readModel);
      await tx.update(ekosistemLinks).set({ cursors: sql`${ekosistemLinks.cursors} - ${RESOURCE_DEFS[resource].key}::text` }).where(eq(ekosistemLinks.id, link.id));
    }
    await recordAudit(tx, {
      ...tenant(link),
      action: "ekosistem.peer_grants_changed",
      resourceType: "ekosistem_link",
      resourceId: link.id,
      before: { peerScopes: link.peerScopes },
      after: { peerScopes: checked.grants },
    });
    await emitLinkChanged(tx, row, "peer_grants_changed", checked.grants);
  });
}

/** Loads a link for signature verification (tenant unknown until the row is read). */
export async function loadLinkById(deps: Pick<EkosistemServerDeps, "db">, linkId: string): Promise<LinkRow | null> {
  const [row] = await withPlatformTx(deps.db, (tx) => tx.select().from(ekosistemLinks).where(eq(ekosistemLinks.id, linkId)));
  return row ?? null;
}

/** Store status gate for serving: a closed store serves nothing. */
export async function storeIsOpen(deps: Pick<EkosistemServerDeps, "db">, link: LinkRow): Promise<boolean> {
  const rows = await withPlatformTx(deps.db, (tx) => tx.execute<{ status: string }>(sql`select status from stores where id = ${link.storeId}`));
  return rows[0]?.status !== undefined && rows[0].status !== "closed";
}
