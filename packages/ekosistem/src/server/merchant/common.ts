import { z } from "zod";
import { AppError } from "@altyapi/commerce-core";
import {
  and,
  channels,
  desc,
  ekosistemLinks,
  eq,
  inArray,
  productTranslations,
  productVariants,
  withTenantTx,
  type Transaction,
} from "@altyapi/database";
import { resolvePrices } from "@altyapi/pricing";
import { tenantScope, type StoreContext } from "@altyapi/tenancy";
import type { PeerProduct } from "../../constants";
import { wireMoney, type WireMoney } from "../../money";
import type { EkosistemServerDeps, LinkRow } from "../common";
import { RESOURCE_DEFS, readResourceState, resourceAllowed, resourcesOf } from "../consume/resources";
import { resourceDueAt } from "../pull";
import { adminLinkView } from "../links";

/**
 * Helpers shared by the merchant views of Kârmatik and Yanıt data: the store's link to a
 * peer, freshness of each pulled resource, local variant details and list paging.
 */

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

/** The store's active link to a peer, or null. */
export async function activeLink(deps: Pick<EkosistemServerDeps, "db">, ctx: StoreContext, peer: PeerProduct): Promise<LinkRow | null> {
  const [row] = await withTenantTx(deps.db, tenantScope(ctx), (tx) =>
    tx
      .select()
      .from(ekosistemLinks)
      .where(and(eq(ekosistemLinks.storeId, ctx.storeId), eq(ekosistemLinks.peerProduct, peer), eq(ekosistemLinks.status, "active")))
      .limit(1),
  );
  return row ?? null;
}

/** For writes that need a working link. */
export async function requireActiveLink(deps: Pick<EkosistemServerDeps, "db">, ctx: StoreContext, peer: PeerProduct): Promise<LinkRow> {
  const link = await activeLink(deps, ctx, peer);
  if (!link) throw new AppError("precondition_failed", "errors.ekosistem.no_active_link", { peerProduct: peer });
  return link;
}

/** The newest link in any state (pending, or revoked with its reason), for status display. */
export async function latestLink(deps: Pick<EkosistemServerDeps, "db">, ctx: StoreContext, peer: PeerProduct): Promise<LinkRow | null> {
  const [row] = await withTenantTx(deps.db, tenantScope(ctx), (tx) =>
    tx
      .select()
      .from(ekosistemLinks)
      .where(and(eq(ekosistemLinks.storeId, ctx.storeId), eq(ekosistemLinks.peerProduct, peer)))
      .orderBy(desc(ekosistemLinks.createdAt))
      .limit(1),
  );
  return row ?? null;
}

export interface ResourceFreshness {
  resource: string;
  endpoint: string;
  /** The peer granted a scope for it. */
  allowed: boolean;
  pulledAt: string | null;
  asOf: string | null;
  nextDueAt: string | null;
  error: string | null;
  errorAt: string | null;
}

/** How fresh each pulled resource of a link is. */
export function freshness(link: LinkRow, now: Date = new Date()): ResourceFreshness[] {
  return resourcesOf(link.peerProduct).map((resource) => {
    const state = readResourceState(link, resource);
    const allowed = resourceAllowed(link, resource);
    return {
      resource,
      endpoint: `/ekosistem/v1/${RESOURCE_DEFS[resource].key}`,
      allowed,
      pulledAt: state.pulledAt,
      asOf: state.asOf,
      nextDueAt: allowed ? resourceDueAt(state, now).toISOString() : null,
      error: state.error,
      errorAt: state.errorAt,
    };
  });
}

export async function linkStatusBlock(deps: EkosistemServerDeps, ctx: StoreContext, peer: PeerProduct) {
  const link = (await activeLink(deps, ctx, peer)) ?? (await latestLink(deps, ctx, peer));
  const now = new Date();
  return {
    link,
    view: link ? adminLinkView(link, now) : null,
    configured: deps.peers.isConfigured(peer),
    circuit: link && link.status === "active" ? await deps.peers.circuitState(peer, link.id) : null,
    freshness: link && link.status === "active" ? freshness(link, now) : [],
    nextPullAt: link?.nextPullAt ?? null,
  };
}

export const money = (amount: bigint | null | undefined, currency: string | null | undefined): WireMoney | null =>
  amount === null || amount === undefined || !currency ? null : wireMoney(amount, currency);

export interface LocalVariant {
  variantId: string;
  productId: string;
  sku: string | null;
  barcode: string | null;
  productTitle: string | null;
  archived: boolean;
  /** Current storefront price (online store channel, no customer group). */
  price: WireMoney | null;
}

/** Local details of matched variants, with their current storefront price. */
export async function loadLocalVariants(tx: Transaction, ctx: StoreContext, variantIds: readonly (string | null)[]): Promise<Map<string, LocalVariant>> {
  const ids = [...new Set(variantIds.filter((v): v is string => !!v))];
  const out = new Map<string, LocalVariant>();
  if (!ids.length) return out;
  const variants = await tx
    .select({ id: productVariants.id, productId: productVariants.productId, sku: productVariants.sku, barcode: productVariants.barcode, archivedAt: productVariants.archivedAt })
    .from(productVariants)
    .where(and(eq(productVariants.storeId, ctx.storeId), inArray(productVariants.id, ids)));
  const productIds = [...new Set(variants.map((v) => v.productId))];
  const titles = productIds.length
    ? await tx
        .select({ productId: productTranslations.productId, locale: productTranslations.locale, title: productTranslations.title })
        .from(productTranslations)
        .where(inArray(productTranslations.productId, productIds))
    : [];
  const [channel] = await tx
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.storeId, ctx.storeId), eq(channels.isDefault, true)));
  const currency = ctx.store.defaultCurrency;
  const prices = await resolvePrices(
    tx,
    { storeId: ctx.storeId, currency, channelId: channel?.id ?? null, customerGroupIds: [], at: new Date() },
    variants.map((v) => ({ variantId: v.id })),
  );
  for (const v of variants) {
    const own = titles.filter((t) => t.productId === v.productId);
    const title = own.find((t) => t.locale === ctx.store.defaultLocale) ?? own[0];
    const price = prices.get(v.id);
    out.set(v.id, {
      variantId: v.id,
      productId: v.productId,
      sku: v.sku,
      barcode: v.barcode,
      productTitle: title?.title ?? null,
      archived: v.archivedAt !== null,
      price: price ? wireMoney(price.amount, currency) : null,
    });
  }
  return out;
}
