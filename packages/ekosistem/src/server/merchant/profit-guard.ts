import { z } from "zod";
import { notFound } from "@altyapi/commerce-core";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  karmatikProfitSnapshots,
  lte,
  paymentProviderConnections,
  products,
  productVariants,
  taxClasses,
  variantCosts,
  withTenantTx,
} from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { assertCan, can, tenantScope, type StoreContext } from "@altyapi/tenancy";
import { EkosistemPeerError } from "../../errors";
import type { CostObject, ProfitQuoteResponse } from "../../schemas";
import { hasAnyScope } from "../../scopes";
import { linkCredentials, type EkosistemServerDeps } from "../common";
import { activeLink, loadLocalVariants, money } from "./common";
import { loadEkosistemSettings, type ProfitGuardPolicy } from "./settings";

/**
 * Profit check for admin actions (§1, §8.7): before a campaign, discount or price change is
 * saved, the proposed discounted unit prices are compared with Kârmatik's floor price. The
 * cached §8.2 snapshot is used first; lines without a cached floor are quoted synchronously
 * (profit:quote, 1500 ms) when the link allows it. The store policy (block | warn | ignore)
 * turns the result into a decision. Never called from customer flows: carts and checkout
 * are never blocked by the peer.
 */

const minor = z.string().regex(/^\d{1,15}$/, "errors.ekosistem.invalid_price");

export const profitCheckSchema = z.object({
  /** What is being saved; informational, recorded with an override. */
  action: z.enum(["campaign", "discount", "price_change"]).default("price_change"),
  lines: z
    .array(
      z.object({
        variantId: z.uuid(),
        quantity: z.number().int().min(1).max(10_000).default(1),
        /** Proposed unit price after the discount, tax-inclusive like storefront prices (minor units). */
        unitPrice: minor,
      }),
    )
    .min(1)
    .max(100),
  payment: z
    .object({
      provider: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
      method: z.enum(["card", "transfer", "cod"]),
      installments: z.number().int().min(1).max(36).default(1),
    })
    .optional(),
  /** With policy block, a user holding campaigns:approve may save anyway by writing a reason. */
  justification: z.string().trim().min(10).max(1000).optional(),
});
export type ProfitCheckInput = z.infer<typeof profitCheckSchema>;

export type ProfitCheckDecision = "allow" | "warn" | "block";
export type ProfitCheckResult = Awaited<ReturnType<typeof profitCheck>>;
type LineStatus = "ok" | "below_minimum" | "unavailable" | "unknown";

const costSource = (source: string): CostObject["source"] =>
  source === "manual" || source === "import" || source === "karmatik" ? source : source.startsWith("integration") ? "integration" : "store";

export async function profitCheck(deps: EkosistemServerDeps, ctx: StoreContext, raw: z.input<typeof profitCheckSchema>) {
  assertCan(ctx, "karmatik:read");
  const input = profitCheckSchema.parse(raw);
  const currency = ctx.store.defaultCurrency;
  const variantIds = [...new Set(input.lines.map((l) => l.variantId))];
  const now = new Date();

  const link = await activeLink(deps, ctx, "karmatik");
  // What the merchant granted Kârmatik also bounds what a quote may carry (§3): costs only
  // with costs:read (otherwise unitCost is null and Kârmatik uses its own cost, §8.7),
  // SKU and barcode only with catalog:read (the variant is still identified by sourceRef).
  const shareCosts = link !== null && hasAnyScope(link.grantedScopes, "costs:read");
  const shareCatalog = link !== null && hasAnyScope(link.grantedScopes, "catalog:read");
  const loaded = await withTenantTx(deps.db, tenantScope(ctx), async (tx) => {
    const settings = await loadEkosistemSettings(tx, ctx.storeId);
    const variants = await tx
      .select({ id: productVariants.id, sku: productVariants.sku, barcode: productVariants.barcode, taxClassId: productVariants.taxClassId, productTaxClassId: products.taxClassId })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(productVariants.storeId, ctx.storeId), inArray(productVariants.id, variantIds)));
    if (variants.length !== variantIds.length) throw notFound("variant");
    const taxes = await tx.select().from(taxClasses).where(eq(taxClasses.storeId, ctx.storeId));
    const costs = shareCosts
      ? await tx
          .select()
          .from(variantCosts)
          .where(and(eq(variantCosts.storeId, ctx.storeId), eq(variantCosts.currency, currency), inArray(variantCosts.variantId, variantIds), lte(variantCosts.effectiveFrom, now)))
          .orderBy(desc(variantCosts.effectiveFrom))
      : [];
    const cached = link
      ? await tx
          .select()
          .from(karmatikProfitSnapshots)
          .where(
            and(
              eq(karmatikProfitSnapshots.linkId, link.id),
              inArray(karmatikProfitSnapshots.variantId, variantIds),
              eq(karmatikProfitSnapshots.channel, "web"),
              eq(karmatikProfitSnapshots.summaryOnly, false),
              eq(karmatikProfitSnapshots.currency, currency),
              isNotNull(karmatikProfitSnapshots.floorPrice),
            ),
          )
          .orderBy(desc(karmatikProfitSnapshots.peerUpdatedAt))
      : [];
    const [payment] = await tx
      .select({ provider: paymentProviderConnections.provider })
      .from(paymentProviderConnections)
      .where(and(eq(paymentProviderConnections.storeId, ctx.storeId), eq(paymentProviderConnections.status, "active")))
      .orderBy(desc(paymentProviderConnections.priority))
      .limit(1);
    const locals = await loadLocalVariants(tx, ctx, variantIds);
    return { settings, variants, taxes, costs, cached, payment: payment?.provider ?? null, locals };
  });

  const policy: ProfitGuardPolicy = loaded.settings.profitGuard;
  const defaultTax = loaded.taxes.find((t) => t.isDefault) ?? null;
  const variantById = new Map(loaded.variants.map((v) => [v.id, v]));
  const latestCost = new Map<string, (typeof loaded.costs)[number]>();
  for (const c of loaded.costs) if (!latestCost.has(c.variantId)) latestCost.set(c.variantId, c);
  const floorByVariant = new Map<string, (typeof loaded.cached)[number]>();
  for (const c of loaded.cached) if (c.variantId && !floorByVariant.has(c.variantId)) floorByVariant.set(c.variantId, c);

  const lines = input.lines.map((l) => {
    const local = loaded.locals.get(l.variantId);
    const current = local?.price ? BigInt(local.price.amount) : null;
    const proposed = BigInt(l.unitPrice);
    const snap = floorByVariant.get(l.variantId);
    const floor = snap?.floorPrice ?? null;
    const below = floor === null ? null : proposed < floor;
    return {
      variantId: l.variantId,
      sku: local?.sku ?? null,
      barcode: local?.barcode ?? null,
      productTitle: local?.productTitle ?? null,
      quantity: l.quantity,
      currentPrice: money(current, currency),
      proposedPrice: money(proposed, currency),
      discountBps: current && current > 0n ? Number(((current - proposed) * 10_000n) / current) : null,
      floorPrice: money(floor, currency),
      safeDiscountBps: snap?.safeDiscountBps ?? null,
      marginBps: snap?.marginBps ?? null,
      netProfit: null as ReturnType<typeof money>,
      belowMinimum: below,
      source: (snap ? "cached" : "none") as "cached" | "quote" | "none",
      basis: snap?.basis ?? null,
      missing: snap?.missing ?? [],
      status: (below === null ? "unknown" : below ? "below_minimum" : "ok") as LineStatus,
    };
  });

  let unavailable = false;
  let quote: { total: ProfitQuoteResponse["total"]; asOf: string } | null = null;
  const needQuote = lines.filter((l) => l.source === "none");
  if (link && policy !== "ignore" && needQuote.length && hasAnyScope(link.peerScopes, "profit:quote") && deps.peers.isConfigured("karmatik") && deps.keys) {
    try {
      const request = {
        currency,
        channel: "web",
        lines: needQuote.map((l) => {
          const v = variantById.get(l.variantId)!;
          const tax = loaded.taxes.find((t) => t.id === (v.taxClassId ?? v.productTaxClassId)) ?? defaultTax;
          const cost = shareCosts ? latestCost.get(l.variantId) : undefined;
          return {
            sourceRef: l.variantId,
            barcode: shareCatalog ? v.barcode : null,
            sku: shareCatalog ? v.sku : null,
            quantity: l.quantity,
            unitPrice: l.proposedPrice!.amount,
            discount: "0",
            taxRateBps: tax ? tax.rateBps : null,
            // Unresolved tax class: storefront prices are charged tax-inclusive, as checkout does.
            taxIncluded: tax ? tax.pricesIncludeTax : true,
            unitCost: cost
              ? { amount: cost.amount.toString(), currency: cost.currency, taxIncluded: cost.taxIncluded, taxRateBps: cost.taxRateBps, source: costSource(cost.source), effectiveFrom: cost.effectiveFrom.toISOString() }
              : null,
          };
        }),
        shipping: { charged: "0", cost: null },
        payment: input.payment ?? { provider: loaded.payment ?? "unknown", method: "card" as const, installments: 1 },
      };
      const answer = await deps.peers.karmatikProfitQuote(await linkCredentials(deps.keys, link), request);
      quote = { total: answer.total, asOf: answer.asOf };
      needQuote.forEach((l, idx) => {
        const q = answer.lines.find((a) => a.sourceRef === l.variantId) ?? answer.lines[idx];
        if (!q) return;
        const floor = q.floorPrice && q.floorPrice.currency === currency ? BigInt(q.floorPrice.amount) : null;
        const below = q.belowMinimum ?? (floor === null ? null : BigInt(l.proposedPrice!.amount) < floor);
        l.source = "quote";
        l.floorPrice = money(floor, currency);
        l.marginBps = q.marginBps;
        l.netProfit = q.netProfit === null ? null : money(BigInt(q.netProfit), currency);
        l.belowMinimum = below;
        l.basis = q.basis;
        l.missing = q.missing;
        l.status = below === null ? "unknown" : below ? "below_minimum" : "ok";
      });
    } catch (err) {
      if (!(err instanceof EkosistemPeerError)) throw err;
      // Timeout, 429, 5xx or an open breaker: the check is unavailable, never a failure of the action.
      unavailable = true;
      for (const l of needQuote) l.status = "unavailable";
      deps.logger.warn({ code: err.code, circuitOpen: err.circuitOpen }, "ekosistem profit quote unavailable");
    }
  }

  const below = lines.some((l) => l.status === "below_minimum");
  const incomplete = lines.some((l) => l.status === "unavailable" || l.status === "unknown");
  let decision: ProfitCheckDecision;
  let requiresConfirmation = false;
  if (!link || policy === "ignore") decision = "allow";
  else if (policy === "warn") decision = below || incomplete ? "warn" : "allow";
  else if (below) decision = "block";
  else if (incomplete) {
    // §8.7: when the check cannot be made, even `block` only warns and asks for confirmation.
    decision = "warn";
    requiresConfirmation = true;
  } else decision = "allow";

  let overridden = false;
  if (decision === "block" && input.justification) {
    assertCan(ctx, "campaigns:approve");
    overridden = true;
    decision = "allow";
    await withTenantTx(deps.db, tenantScope(ctx), (tx) =>
      recordAudit(tx, {
        action: "ekosistem.profit_guard_overridden",
        resourceType: "store",
        resourceId: ctx.storeId,
        after: {
          action: input.action,
          justification: input.justification,
          lines: lines.filter((l) => l.status === "below_minimum").map((l) => ({ variantId: l.variantId, proposedPrice: l.proposedPrice, floorPrice: l.floorPrice })),
        },
      }),
    );
  }

  return {
    decision,
    policy,
    linked: link !== null,
    unavailable,
    requiresConfirmation,
    overridden,
    /** A user who may override a block (campaigns:approve with a justification). */
    canOverride: decision === "block" && can(ctx, "campaigns:approve", ctx.storeId),
    lines,
    quote,
    checkedAt: now.toISOString(),
  };
}
