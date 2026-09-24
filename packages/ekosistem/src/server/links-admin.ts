import { z } from "zod";
import { AppError, conflict, invalid, newId, notFound } from "@altyapi/commerce-core";
import { and, desc, eq, ekosistemCodes, ekosistemLinks, gt, isNull, withTenantTx } from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import type { Permission } from "@altyapi/auth";
import { assertCan, can, tenantScope, type StoreContext } from "@altyapi/tenancy";
import { CODE_TTL_SECONDS, PEER_PRODUCTS, SELF_PRODUCT, type PeerProduct } from "../constants";
import { generateClaimNonce, generateEkosistemCode, hashClaimNonce, hashEkosistemCode, parseEkosistemCode } from "../codes";
import { EkosistemPeerError } from "../errors";
import type { ClaimResponse } from "../schemas";
import { EXPLICIT_CONSENT_SCOPES, allowedGrants, defaultGrants, implicitGrants, validateGrants } from "../scopes";
import { encryptLinkSecret, linkCredentials, loadStoreIdentity, ownAccount, requireKeysForAdmin, type EkosistemServerDeps, type LinkRow } from "./common";
import { adminLinkView, emitLinkChanged, findLiveLink, isExpiredPending, pendingExpiry, purgeExpiredPending, revokeLinkTx } from "./links";

/**
 * Merchant side of the link lifecycle (docs/ekosistem/v1.md §4). A store links to Kârmatik
 * or Yanıt either by issuing a code (altyapi = issuer) or by entering the peer's code
 * (altyapi = acceptor). Only karmatik:manage / yanit:manage may create, approve or remove.
 */

const peerProductSchema = z.enum(PEER_PRODUCTS);
const grantListSchema = z.array(z.string().max(40)).max(20);

const managePermission = (peer: PeerProduct) => `${peer}:manage` as Permission;
const readPermission = (peer: PeerProduct) => `${peer}:read` as Permission;

/**
 * Scopes this store grants the peer. Omitted grants mean the pair's defaults without the
 * explicit-consent scopes (§3: costs:read and orders:read only when listed one by one).
 */
function checkOwnGrants(peer: PeerProduct, grants: readonly string[] | undefined): string[] {
  if (grants === undefined) return implicitGrants(SELF_PRODUCT, peer);
  const checked = validateGrants(SELF_PRODUCT, peer, grants);
  if (!checked.ok) throw invalid("errors.ekosistem.invalid_grants", { invalid: checked.invalid, allowed: allowedGrants(SELF_PRODUCT, peer) });
  return checked.grants;
}

/** Scopes in either direction that the user must have ticked explicitly (§3). */
function explicitConsent(grants: readonly string[]): string[] {
  return grants.filter((g) => (EXPLICIT_CONSENT_SCOPES as readonly string[]).includes(g));
}

async function loadOwnedLink(deps: EkosistemServerDeps, ctx: StoreContext, linkId: string): Promise<LinkRow> {
  const [row] = await withTenantTx(deps.db, tenantScope(ctx), (tx) =>
    tx.select().from(ekosistemLinks).where(and(eq(ekosistemLinks.id, linkId), eq(ekosistemLinks.storeId, ctx.storeId))),
  );
  if (!row) throw notFound("ekosistem_link", linkId);
  return row;
}

// ---------------------------------------------------------------------------
// Issuer: codes
// ---------------------------------------------------------------------------

export const createCodeSchema = z.object({
  peerProduct: peerProductSchema,
  /**
   * Scopes this store grants the peer (narrowing of the §3 set only). When omitted, the §3
   * defaults without costs:read and orders:read, which must be listed explicitly.
   */
  grants: grantListSchema.optional(),
});

/**
 * Issues a one-time code (§4.2) the merchant enters in Kârmatik or Yanıt. The code is shown
 * once; only its SHA-256 is stored. Earlier unused codes for the same peer stop working.
 */
export async function createLinkCode(deps: EkosistemServerDeps, ctx: StoreContext, input: z.infer<typeof createCodeSchema>) {
  const peer = input.peerProduct;
  assertCan(ctx, managePermission(peer));
  const grants = checkOwnGrants(peer, input.grants);
  if (!grants.length) throw invalid("errors.ekosistem.grants_required");
  const now = new Date();
  const code = generateEkosistemCode(SELF_PRODUCT);
  const expiresAt = new Date(now.getTime() + CODE_TTL_SECONDS * 1000);
  return withTenantTx(deps.db, tenantScope(ctx), async (tx) => {
    await purgeExpiredPending(tx, ctx.storeId, peer, now);
    if (await findLiveLink(tx, ctx.storeId, peer, now)) throw conflict("errors.ekosistem.link_exists", { peerProduct: peer });
    await tx
      .update(ekosistemCodes)
      .set({ expiresAt: now })
      .where(and(eq(ekosistemCodes.storeId, ctx.storeId), eq(ekosistemCodes.peerProduct, peer), isNull(ekosistemCodes.usedAt), gt(ekosistemCodes.expiresAt, now)));
    const id = newId();
    await tx.insert(ekosistemCodes).values({
      id,
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      peerProduct: peer,
      codeHash: hashEkosistemCode(code),
      grants,
      expiresAt,
      createdByUserId: ctx.principal.userId,
    });
    await recordAudit(tx, { action: "ekosistem.code_created", resourceType: "ekosistem_code", resourceId: id, after: { peerProduct: peer, grants, expiresAt } });
    // The code itself is returned once and never stored or logged.
    return { code, peerProduct: peer, grants, explicitConsent: explicitConsent(grants), expiresAt };
  });
}

// ---------------------------------------------------------------------------
// Acceptor: entering a peer's code
// ---------------------------------------------------------------------------

export const acceptCodeSchema = z.object({
  code: z.string().trim().min(1).max(100),
  /**
   * Scopes this store grants the peer (narrowing of the §3 set only). When omitted, the §3
   * defaults without costs:read and orders:read, which must be listed explicitly.
   */
  grants: grantListSchema.optional(),
});

async function claimWithRetry(deps: EkosistemServerDeps, peer: PeerProduct, body: Parameters<EkosistemServerDeps["peers"]["claim"]>[1]): Promise<ClaimResponse> {
  try {
    return await deps.peers.claim(peer, body);
  } catch (err) {
    // The same code + claimNonce gets the same answer, so one retry after a lost response is safe.
    if (err instanceof EkosistemPeerError && err.code === "unavailable") return deps.peers.claim(peer, body);
    throw err;
  }
}

/**
 * The merchant entered a code issued by Kârmatik or Yanıt. altyapi claims it at the issuer
 * (fixed base address from the code's issuer letter), stores the link as `pending` and
 * returns the issuer's verified identity and both scope lists for the user to confirm.
 */
export async function acceptLinkCode(deps: EkosistemServerDeps, ctx: StoreContext, input: z.infer<typeof acceptCodeSchema>) {
  const parsed = parseEkosistemCode(input.code);
  if (!parsed) throw invalid("errors.ekosistem.code_malformed");
  if (parsed.issuer === SELF_PRODUCT) throw invalid("errors.ekosistem.own_code");
  const peer = parsed.issuer as PeerProduct;
  assertCan(ctx, managePermission(peer));
  if (!deps.peers.isConfigured(peer)) throw new AppError("dependency_unavailable", "errors.ekosistem.peer_not_configured", { peerProduct: peer });
  const keys = requireKeysForAdmin(deps.keys);
  const grants = checkOwnGrants(peer, input.grants);
  const now = new Date();

  const identity = await withTenantTx(deps.db, tenantScope(ctx), async (tx) => {
    await purgeExpiredPending(tx, ctx.storeId, peer, now);
    if (await findLiveLink(tx, ctx.storeId, peer, now)) throw conflict("errors.ekosistem.link_exists", { peerProduct: peer });
    return loadStoreIdentity(tx, ctx.storeId, deps.storeRootDomain);
  });
  if (!identity) throw notFound("store", ctx.storeId);

  const claimNonce = generateClaimNonce();
  let claim: ClaimResponse;
  try {
    claim = await claimWithRetry(deps, peer, { code: parsed.normalized, product: SELF_PRODUCT, claimNonce, account: ownAccount(identity), grants });
  } catch (err) {
    if (err instanceof EkosistemPeerError) throw err.toAppError();
    throw err;
  }
  if (claim.product !== peer) throw new AppError("dependency_unavailable", "errors.ekosistem.peer_error", { reason: "product_mismatch" });
  // Keep only scopes the peer may grant altyapi; anything else is outside the contract.
  const allowedFromPeer = allowedGrants(peer, SELF_PRODUCT) as readonly string[];
  const peerScopes = claim.grants.filter((g) => allowedFromPeer.includes(g));
  const linkId = claim.linkId.toLowerCase();

  const row = await withTenantTx(deps.db, tenantScope(ctx), async (tx) => {
    const [existing] = await tx.select({ id: ekosistemLinks.id }).from(ekosistemLinks).where(eq(ekosistemLinks.id, linkId));
    if (existing) throw conflict("errors.ekosistem.link_exists", { peerProduct: peer });
    const [inserted] = await tx
      .insert(ekosistemLinks)
      .values({
        id: linkId,
        organizationId: ctx.organizationId,
        storeId: ctx.storeId,
        peerProduct: peer,
        role: "acceptor",
        status: "pending",
        secret: await encryptLinkSecret(keys, ctx.storeId, linkId, claim.secret),
        grantedScopes: grants,
        peerScopes,
        peerAccount: claim.account,
        claimNonceHash: hashClaimNonce(claimNonce),
        pendingExpiresAt: pendingExpiry(now),
        createdByUserId: ctx.principal.userId,
      })
      .returning();
    await recordAudit(tx, {
      action: "ekosistem.code_accepted",
      resourceType: "ekosistem_link",
      resourceId: linkId,
      after: { peerProduct: peer, peerAccount: claim.account, grantedScopes: grants, peerScopes },
    });
    return inserted!;
  });

  return {
    link: adminLinkView(row, now),
    peer: { product: peer, account: claim.account },
    grants: { toPeer: grants, fromPeer: peerScopes },
    explicitConsent: explicitConsent([...grants, ...peerScopes]),
  };
}

export const confirmLinkSchema = z.object({
  /** Optional further narrowing of what this store grants the peer before confirming. */
  grants: grantListSchema.optional(),
});

/**
 * The merchant approved a link created by entering a peer's code: altyapi confirms it at
 * the issuer (which proves altyapi by calling back GET /links/{linkId}). Our side becomes
 * active as soon as the issuer answers 2xx; the issuer's data endpoints answer 409
 * link_pending until the issuing user approves there as well.
 */
export async function confirmAcceptedLink(deps: EkosistemServerDeps, ctx: StoreContext, linkId: string, input: z.infer<typeof confirmLinkSchema>) {
  const link = await loadOwnedLink(deps, ctx, linkId);
  const peer = link.peerProduct;
  assertCan(ctx, managePermission(peer));
  const now = new Date();
  if (link.role !== "acceptor") throw new AppError("precondition_failed", "errors.ekosistem.not_acceptor");
  if (link.status !== "pending" || isExpiredPending(link, now)) throw new AppError("precondition_failed", "errors.ekosistem.link_not_pending", { status: adminLinkView(link, now).status });
  let grants = link.grantedScopes;
  if (input.grants) {
    const narrowed = input.grants.filter((g) => link.grantedScopes.includes(g));
    if (narrowed.length !== input.grants.length) throw invalid("errors.ekosistem.invalid_grants", { invalid: input.grants.filter((g) => !link.grantedScopes.includes(g)) });
    grants = link.grantedScopes.filter((g) => narrowed.includes(g));
  }
  const keys = requireKeysForAdmin(deps.keys);

  const identity = await withTenantTx(deps.db, tenantScope(ctx), async (tx) => {
    // Stored before calling the issuer so its proof call (GET /links/{linkId}) sees the confirmed grants.
    if (grants.join(" ") !== link.grantedScopes.join(" ")) await tx.update(ekosistemLinks).set({ grantedScopes: grants }).where(eq(ekosistemLinks.id, link.id));
    return loadStoreIdentity(tx, ctx.storeId, deps.storeRootDomain);
  });
  if (!identity) throw notFound("store", ctx.storeId);

  try {
    await deps.peers.confirm(peer, await linkCredentials(keys, link), { account: ownAccount(identity), grants });
  } catch (err) {
    if (!(err instanceof EkosistemPeerError)) throw err;
    if (!err.retryable && err.code !== "not_configured") {
      // The issuer refused the link (unverified, unknown or expired): it can never become active.
      await withTenantTx(deps.db, tenantScope(ctx), async (tx) => {
        await revokeLinkTx(tx, link, { reason: "peer_rejected", notifyPeer: false, now: new Date() });
        await recordAudit(tx, { action: "ekosistem.link_rejected_by_peer", resourceType: "ekosistem_link", resourceId: link.id, metadata: { peerProduct: peer, peerCode: err.code } });
      });
    }
    throw err.toAppError();
  }

  return withTenantTx(deps.db, tenantScope(ctx), async (tx) => {
    const [row] = await tx
      .update(ekosistemLinks)
      .set({ status: "active", approvedByUserId: ctx.principal.userId, approvedAt: new Date(), pendingExpiresAt: null })
      .where(and(eq(ekosistemLinks.id, link.id), eq(ekosistemLinks.status, "pending")))
      .returning();
    if (!row) throw conflict("errors.ekosistem.link_changed");
    await recordAudit(tx, { action: "ekosistem.link_activated", resourceType: "ekosistem_link", resourceId: link.id, after: { role: "acceptor", grantedScopes: grants, peerScopes: row.peerScopes } });
    await emitLinkChanged(tx, row, "activated");
    return { link: adminLinkView(row) };
  });
}

// ---------------------------------------------------------------------------
// Issuer: approval of a confirmed link
// ---------------------------------------------------------------------------

/** The user who issued the code approves the peer's verified request (§4.3 step 4). */
export async function approveLink(deps: EkosistemServerDeps, ctx: StoreContext, linkId: string) {
  const link = await loadOwnedLink(deps, ctx, linkId);
  assertCan(ctx, managePermission(link.peerProduct));
  const now = new Date();
  if (link.role !== "issuer") throw new AppError("precondition_failed", "errors.ekosistem.not_issuer");
  if (link.status !== "awaiting_approval" || isExpiredPending(link, now)) {
    throw new AppError("precondition_failed", "errors.ekosistem.link_not_awaiting_approval", { status: adminLinkView(link, now).status });
  }
  return withTenantTx(deps.db, tenantScope(ctx), async (tx) => {
    const [row] = await tx
      .update(ekosistemLinks)
      .set({ status: "active", approvedByUserId: ctx.principal.userId, approvedAt: now, pendingExpiresAt: null })
      .where(and(eq(ekosistemLinks.id, link.id), eq(ekosistemLinks.status, "awaiting_approval")))
      .returning();
    if (!row) throw conflict("errors.ekosistem.link_changed");
    await recordAudit(tx, {
      action: "ekosistem.link_activated",
      resourceType: "ekosistem_link",
      resourceId: link.id,
      after: { role: "issuer", peerAccount: row.peerAccount, grantedScopes: row.grantedScopes, peerScopes: row.peerScopes },
    });
    await emitLinkChanged(tx, row, "activated");
    return { link: adminLinkView(row, now) };
  });
}

/**
 * The user declines a link that is not active yet (either role). The peer is told with a
 * DELETE, retried in the background (§4.3 step 3).
 */
export async function rejectLink(deps: EkosistemServerDeps, ctx: StoreContext, linkId: string) {
  const link = await loadOwnedLink(deps, ctx, linkId);
  assertCan(ctx, managePermission(link.peerProduct));
  if (link.status !== "pending" && link.status !== "awaiting_approval") throw new AppError("precondition_failed", "errors.ekosistem.link_not_pending", { status: link.status });
  return withTenantTx(deps.db, tenantScope(ctx), async (tx) => {
    const row = await revokeLinkTx(tx, link, { reason: "rejected", notifyPeer: true, now: new Date() });
    await recordAudit(tx, { action: "ekosistem.link_rejected", resourceType: "ekosistem_link", resourceId: link.id, metadata: { peerProduct: link.peerProduct, role: link.role } });
    return { link: adminLinkView(row) };
  });
}

/**
 * Removes a link. Local revocation is immediate (serving and pulling stop); the peer is
 * told with DELETE {peer}/ekosistem/v1/links/{linkId}, retried for 72 hours by the worker.
 */
export async function revokeLink(deps: EkosistemServerDeps, ctx: StoreContext, linkId: string) {
  const link = await loadOwnedLink(deps, ctx, linkId);
  assertCan(ctx, managePermission(link.peerProduct));
  if (link.status === "revoked") return { link: adminLinkView(link) };
  return withTenantTx(deps.db, tenantScope(ctx), async (tx) => {
    const row = await revokeLinkTx(tx, link, { reason: "user", notifyPeer: true, now: new Date() });
    await recordAudit(tx, { action: "ekosistem.link_revoked", resourceType: "ekosistem_link", resourceId: link.id, before: { status: link.status }, metadata: { peerProduct: link.peerProduct } });
    return { link: adminLinkView(row) };
  });
}

/** Links of the store for the peers the user may see (karmatik:read / yanit:read), newest first. */
export async function listLinks(deps: EkosistemServerDeps, ctx: StoreContext) {
  const visible = PEER_PRODUCTS.filter((p) => can(ctx, readPermission(p), ctx.storeId));
  if (!visible.length) assertCan(ctx, readPermission("karmatik"));
  const rows = await withTenantTx(deps.db, tenantScope(ctx), (tx) =>
    tx.select().from(ekosistemLinks).where(eq(ekosistemLinks.storeId, ctx.storeId)).orderBy(desc(ekosistemLinks.createdAt)).limit(100),
  );
  const now = new Date();
  return {
    items: rows.filter((r) => (visible as readonly string[]).includes(r.peerProduct)).map((r) => adminLinkView(r, now)),
    peers: Object.fromEntries(
      PEER_PRODUCTS.map((p) => [
        p,
        {
          configured: deps.peers.isConfigured(p),
          /** Pre-ticked scopes; explicitConsentGrants are offered unticked (§3). */
          defaultGrants: implicitGrants(SELF_PRODUCT, p),
          explicitConsentGrants: explicitConsent(defaultGrants(SELF_PRODUCT, p)),
          peerDefaultGrants: defaultGrants(p, SELF_PRODUCT),
        },
      ]),
    ),
  };
}
