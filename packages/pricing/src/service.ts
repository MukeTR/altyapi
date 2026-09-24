import { z } from "zod";
import { AppError, conflict, currencySchema, invalid, newId, notFound } from "@altyapi/commerce-core";
import {
  and,
  channelPrices,
  channels,
  customerGroupPrices,
  customerGroups,
  desc,
  eq,
  inArray,
  moneyAmounts,
  priceLists,
  productVariants,
  scheduledPrices,
  sql,
  variantCosts,
  withTenantTx,
  type Database,
  type Transaction,
} from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { appendEvent } from "@altyapi/events";
import { assertCan, type StoreContext } from "@altyapi/tenancy";
import { closePriceListHistory, priceSourceFromContext, syncPriceHistory } from "./history";
import { resolvePrices, type PriceContext } from "./resolver";

type Scope = { organizationId: string; storeId: string };
const scopeOf = (ctx: StoreContext): Scope => ({ organizationId: ctx.organizationId, storeId: ctx.storeId });

const minor = z.union([z.bigint().nonnegative(), z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v));

export async function ensureBasePriceList(tx: Transaction, scope: Scope, currency: string): Promise<string> {
  const existing = await tx.query.priceLists.findFirst({
    where: and(eq(priceLists.storeId, scope.storeId), eq(priceLists.currency, currency), eq(priceLists.kind, "base")),
  });
  if (existing) return existing.id;
  const id = newId();
  await tx.insert(priceLists).values({ id, ...scope, name: `Liste fiyatı (${currency})`, kind: "base", currency, priority: 0 });
  return id;
}

export const createPriceListSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["sale", "customer_group", "channel", "scheduled"]),
  currency: currencySchema,
  priority: z.number().int().min(-1000).max(1000).default(10),
  channelIds: z.array(z.uuid()).default([]),
  customerGroupIds: z.array(z.uuid()).default([]),
  schedule: z
    .array(z.object({ startsAt: z.coerce.date(), endsAt: z.coerce.date().nullable().default(null) }))
    .max(20)
    .default([]),
});

export async function listPriceLists(db: Database, ctx: StoreContext) {
  assertCan(ctx, "pricing:read");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const lists = await tx.select().from(priceLists).where(eq(priceLists.storeId, ctx.storeId)).orderBy(desc(priceLists.priority));
    const ids = lists.map((l) => l.id);
    if (!ids.length) return [];
    const [ch, gr, win] = await Promise.all([
      tx.select().from(channelPrices).where(inArray(channelPrices.priceListId, ids)),
      tx.select().from(customerGroupPrices).where(inArray(customerGroupPrices.priceListId, ids)),
      tx.select().from(scheduledPrices).where(inArray(scheduledPrices.priceListId, ids)),
    ]);
    return lists.map((l) => ({
      ...l,
      channelIds: ch.filter((c) => c.priceListId === l.id).map((c) => c.channelId),
      customerGroupIds: gr.filter((g) => g.priceListId === l.id).map((g) => g.customerGroupId),
      schedule: win.filter((w) => w.priceListId === l.id).map((w) => ({ startsAt: w.startsAt, endsAt: w.endsAt })),
    }));
  });
}

export async function createPriceList(db: Database, ctx: StoreContext, input: z.infer<typeof createPriceListSchema>) {
  assertCan(ctx, "pricing:write");
  if (!ctx.store.supportedCurrencies.includes(input.currency)) throw invalid("errors.pricing.currency_not_enabled");
  if (input.kind === "channel" && !input.channelIds.length) throw invalid("errors.pricing.channel_required");
  if (input.kind === "customer_group" && !input.customerGroupIds.length) throw invalid("errors.pricing.group_required");
  if (input.kind === "scheduled" && !input.schedule.length) throw invalid("errors.pricing.schedule_required");
  for (const w of input.schedule) if (w.endsAt && w.endsAt <= w.startsAt) throw invalid("errors.pricing.invalid_window");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    if (input.channelIds.length) {
      const found = await tx.select({ id: channels.id }).from(channels).where(and(eq(channels.storeId, ctx.storeId), inArray(channels.id, input.channelIds)));
      if (found.length !== input.channelIds.length) throw notFound("channel");
    }
    if (input.customerGroupIds.length) {
      const found = await tx.select({ id: customerGroups.id }).from(customerGroups).where(and(eq(customerGroups.storeId, ctx.storeId), inArray(customerGroups.id, input.customerGroupIds)));
      if (found.length !== input.customerGroupIds.length) throw notFound("customer_group");
    }
    const id = newId();
    await tx.insert(priceLists).values({ id, ...scopeOf(ctx), name: input.name, kind: input.kind, currency: input.currency, priority: input.priority });
    for (const channelId of input.channelIds) await tx.insert(channelPrices).values({ priceListId: id, channelId, ...scopeOf(ctx) });
    for (const customerGroupId of input.customerGroupIds) await tx.insert(customerGroupPrices).values({ priceListId: id, customerGroupId, ...scopeOf(ctx) });
    for (const w of input.schedule) await tx.insert(scheduledPrices).values({ id: newId(), priceListId: id, ...scopeOf(ctx), startsAt: w.startsAt, endsAt: w.endsAt });
    await recordAudit(tx, { action: "price_list.created", resourceType: "price_list", resourceId: id, after: input });
    return tx.query.priceLists.findFirst({ where: eq(priceLists.id, id) });
  });
}

export const setPricesSchema = z.object({
  entries: z
    .array(
      z.object({
        variantId: z.uuid(),
        amount: minor,
        compareAtAmount: minor.nullable().optional(),
        minQuantity: z.number().int().min(1).default(1),
      }),
    )
    .min(1)
    .max(1000),
  /** Remove entries not present in this request (for the listed variants). */
  replaceVariantTiers: z.boolean().default(false),
});

/**
 * Upserts prices into a list. Price changes are audited with before/after values and
 * recorded in price_history (the source of the lawful previous price).
 */
export async function setPrices(db: Database, ctx: StoreContext, priceListId: string, input: z.infer<typeof setPricesSchema>) {
  assertCan(ctx, "pricing:write");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const list = await tx.query.priceLists.findFirst({ where: and(eq(priceLists.id, priceListId), eq(priceLists.storeId, ctx.storeId)) });
    if (!list) throw notFound("price_list", priceListId);
    await upsertPriceEntries(tx, scopeOf(ctx), list, input.entries, input.replaceVariantTiers);
    return { updated: input.entries.length };
  });
}

export async function upsertPriceEntries(
  tx: Transaction,
  scope: Scope,
  list: { id: string; currency: string },
  entries: { variantId: string; amount: bigint; compareAtAmount?: bigint | null; minQuantity: number }[],
  replaceVariantTiers = false,
  /** price_history source; defaults to the principal of the running operation. */
  source: string = priceSourceFromContext(),
): Promise<void> {
  const variantIds = [...new Set(entries.map((e) => e.variantId))];
  const variants = await tx
    .select({ id: productVariants.id, productId: productVariants.productId })
    .from(productVariants)
    .where(and(eq(productVariants.storeId, scope.storeId), inArray(productVariants.id, variantIds)));
  if (variants.length !== variantIds.length) throw notFound("variant");
  for (const e of entries) {
    if (e.compareAtAmount !== undefined && e.compareAtAmount !== null && e.compareAtAmount <= e.amount) {
      throw invalid("errors.pricing.compare_at_not_higher", { variantId: e.variantId });
    }
  }
  const before = await tx.select().from(moneyAmounts).where(and(eq(moneyAmounts.priceListId, list.id), inArray(moneyAmounts.variantId, variantIds)));
  if (replaceVariantTiers) {
    await tx.delete(moneyAmounts).where(and(eq(moneyAmounts.priceListId, list.id), inArray(moneyAmounts.variantId, variantIds)));
  }
  for (const e of entries) {
    await tx
      .insert(moneyAmounts)
      .values({
        id: newId(),
        ...scope,
        priceListId: list.id,
        variantId: e.variantId,
        currency: list.currency,
        amount: e.amount,
        compareAtAmount: e.compareAtAmount ?? null,
        minQuantity: e.minQuantity,
      })
      .onConflictDoUpdate({
        target: [moneyAmounts.priceListId, moneyAmounts.variantId, moneyAmounts.minQuantity],
        set: { amount: e.amount, compareAtAmount: e.compareAtAmount ?? null, updatedAt: new Date() },
      });
  }
  // Same transaction: a changed (or removed, with replaceVariantTiers) unit price closes its
  // open period and opens the next one; unchanged amounts add nothing.
  await syncPriceHistory(tx, scope, list.id, variantIds, source);
  // Price-based collection rules, feeds and Kârmatik consume product.updated.
  for (const productId of new Set(variants.map((v) => v.productId))) {
    await appendEvent(tx, {
      type: "product.updated",
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      aggregateType: "product",
      aggregateId: productId,
      payload: { productId, fields: ["prices"] },
    });
  }
  await tx.execute(sql`update stores set content_version = content_version + 1 where id = ${scope.storeId}`);
  await recordAudit(tx, {
    organizationId: scope.organizationId,
    storeId: scope.storeId,
    action: "prices.updated",
    resourceType: "price_list",
    resourceId: list.id,
    before: before.map((b) => ({ variantId: b.variantId, amount: b.amount, compareAt: b.compareAtAmount, minQuantity: b.minQuantity })),
    after: entries.map((e) => ({ variantId: e.variantId, amount: e.amount, compareAt: e.compareAtAmount ?? null, minQuantity: e.minQuantity })),
  });
}

export async function deletePriceList(db: Database, ctx: StoreContext, priceListId: string) {
  assertCan(ctx, "pricing:write");
  await withTenantTx(db, scopeOf(ctx), async (tx) => {
    const list = await tx.query.priceLists.findFirst({ where: and(eq(priceLists.id, priceListId), eq(priceLists.storeId, ctx.storeId)) });
    if (!list) throw notFound("price_list", priceListId);
    if (list.kind === "base") throw conflict("errors.pricing.base_list_permanent");
    // Its prices stop applying now; the closed periods outlive the list in price_history.
    await closePriceListHistory(tx, priceListId);
    // The served price of every variant in the list falls back to another list. Its prices go
    // with the list (cascade), so the variants' updated_at moves instead: incremental readers
    // (ekosistem catalog export) see the change, and product.updated announces it like any
    // other price change (collection rules, feeds, ekosistem pushes).
    const touched = await tx.execute<{ product_id: string }>(sql`
      update product_variants v set updated_at = now()
        from (select distinct ma.variant_id from money_amounts ma where ma.price_list_id = ${priceListId}) m
       where v.id = m.variant_id and v.store_id = ${ctx.storeId}
      returning v.product_id`);
    await tx.delete(priceLists).where(eq(priceLists.id, priceListId));
    const productIds = new Set([...touched].map((r) => r.product_id));
    for (const productId of productIds) {
      await appendEvent(tx, {
        type: "product.updated",
        organizationId: ctx.organizationId,
        storeId: ctx.storeId,
        aggregateType: "product",
        aggregateId: productId,
        payload: { productId, fields: ["prices"] },
      });
    }
    if (productIds.size) await tx.execute(sql`update stores set content_version = content_version + 1 where id = ${ctx.storeId}`);
    await recordAudit(tx, { action: "price_list.deleted", resourceType: "price_list", resourceId: priceListId, before: { name: list.name } });
  });
}

export const setCostSchema = z.object({
  currency: currencySchema,
  amount: minor,
  source: z.string().max(40).default("manual"),
  /** null = unknown; omitted = keep the tax treatment of the previous cost. */
  taxIncluded: z.boolean().nullable().optional(),
  taxRateBps: z.number().int().min(0).max(10_000).nullable().optional(),
});

export interface SetVariantCostInput {
  currency: string;
  amount: bigint;
  source?: string;
  /** Whether the cost includes VAT; null = unknown, undefined = unchanged from the previous cost. */
  taxIncluded?: boolean | null;
  /** VAT rate of the cost in basis points; null = unknown, undefined = unchanged. */
  taxRateBps?: number | null;
}

export async function setVariantCost(tx: Transaction, scope: Scope, variantId: string, input: SetVariantCostInput) {
  const latest = await tx.query.variantCosts.findFirst({
    where: and(eq(variantCosts.variantId, variantId), eq(variantCosts.currency, input.currency)),
    orderBy: desc(variantCosts.effectiveFrom),
  });
  // Tax treatment rarely changes with the amount, so it carries over unless the caller states it.
  const taxIncluded = input.taxIncluded !== undefined ? input.taxIncluded : (latest?.taxIncluded ?? null);
  const taxRateBps = input.taxRateBps !== undefined ? input.taxRateBps : (latest?.taxRateBps ?? null);
  if (latest && latest.amount === input.amount && latest.taxIncluded === taxIncluded && latest.taxRateBps === taxRateBps) return;
  await tx
    .insert(variantCosts)
    .values({ id: newId(), ...scope, variantId, currency: input.currency, amount: input.amount, taxIncluded, taxRateBps, source: input.source ?? "manual" });
}

export async function latestCosts(tx: Transaction, storeId: string, variantIds: string[], currency: string): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  if (!variantIds.length) return out;
  const rows = await tx
    .select()
    .from(variantCosts)
    .where(and(eq(variantCosts.storeId, storeId), eq(variantCosts.currency, currency), inArray(variantCosts.variantId, variantIds)))
    .orderBy(desc(variantCosts.effectiveFrom));
  for (const r of rows) if (!out.has(r.variantId)) out.set(r.variantId, r.amount);
  return out;
}

export const priceQuerySchema = z.object({
  variantIds: z.array(z.uuid()).min(1).max(500),
  currency: currencySchema.optional(),
  channelId: z.uuid().optional(),
  customerGroupIds: z.array(z.uuid()).max(20).optional(),
  quantity: z.number().int().min(1).optional(),
  at: z.coerce.date().optional(),
});

export async function getPrices(db: Database, ctx: StoreContext, input: z.infer<typeof priceQuerySchema>) {
  assertCan(ctx, "pricing:read");
  const priceCtx: PriceContext = {
    storeId: ctx.storeId,
    currency: input.currency ?? ctx.store.defaultCurrency,
    channelId: input.channelId ?? null,
    customerGroupIds: input.customerGroupIds ?? [],
    ...(input.at ? { at: input.at } : {}),
  };
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const prices = await resolvePrices(tx, priceCtx, input.variantIds.map((variantId) => ({ variantId, quantity: input.quantity ?? 1 })));
    const costs = await latestCosts(tx, ctx.storeId, input.variantIds, priceCtx.currency);
    return input.variantIds.map((variantId) => {
      const p = prices.get(variantId);
      const cost = costs.get(variantId) ?? null;
      return {
        variantId,
        currency: priceCtx.currency,
        price: p ?? null,
        cost,
        // Margin in basis points of the (tax-inclusive) selling price; computed without floats.
        marginBps: p && cost !== null && p.amount > 0n ? Number(((p.amount - cost) * 10000n) / p.amount) : null,
      };
    });
  });
}

export function assertCurrencyEnabled(ctx: StoreContext, currency: string) {
  if (!ctx.store.supportedCurrencies.includes(currency)) throw new AppError("validation_failed", "errors.pricing.currency_not_enabled", { currency });
}
