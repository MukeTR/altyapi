import { z } from "zod";
import { currencySchema, invalid, newId, notFound } from "@altyapi/commerce-core";
import {
  and,
  asc,
  eq,
  inArray,
  productVariants,
  products,
  shippingRates,
  shippingZones,
  withTenantTx,
  type Database,
  type PostalAddress,
  type Transaction,
} from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { assertCan, type StoreContext } from "@altyapi/tenancy";
import type { CalculatedLine, CartRow } from "./calculate";

type RateRow = typeof shippingRates.$inferSelect;

const minor = z.union([z.bigint(), z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v));

export const zoneSchema = z.object({
  name: z.string().trim().min(1).max(100),
  countryCodes: z.array(z.string().length(2).toUpperCase()).min(1).max(250),
  provinces: z.array(z.string().trim().min(1).max(60)).max(100).default([]),
  rates: z
    .array(
      z.object({
        id: z.uuid().optional(),
        name: z.record(z.string(), z.string().min(1).max(80)),
        type: z.enum(["flat", "weight_based", "price_based"]),
        currency: currencySchema,
        amount: minor,
        minValue: minor.nullable().optional(),
        maxValue: minor.nullable().optional(),
        freeOverAmount: minor.nullable().optional(),
        carrierCode: z.string().max(40).nullable().optional(),
        minDeliveryDays: z.number().int().min(0).max(60).nullable().optional(),
        maxDeliveryDays: z.number().int().min(0).max(90).nullable().optional(),
        taxClassId: z.uuid().nullable().optional(),
        isActive: z.boolean().default(true),
      }),
    )
    .max(30),
});

const normalizeProvince = (s: string) => s.toLocaleLowerCase("tr").trim();

function zoneMatches(zone: typeof shippingZones.$inferSelect, address: PostalAddress): boolean {
  if (!zone.countryCodes.includes(address.countryCode.toUpperCase())) return false;
  if (!zone.provinces.length) return true;
  const target = normalizeProvince(address.province ?? address.city);
  return zone.provinces.some((p) => normalizeProvince(p) === target);
}

async function cartWeightGrams(tx: Transaction, lines: CalculatedLine[]): Promise<number> {
  const shippable = lines.filter((l) => l.requiresShipping && l.available);
  if (!shippable.length) return 0;
  const variants = await tx.select().from(productVariants).where(inArray(productVariants.id, shippable.map((l) => l.variantId)));
  const prods = await tx.select().from(products).where(inArray(products.id, [...new Set(shippable.map((l) => l.productId))]));
  return shippable.reduce((sum, l) => {
    const v = variants.find((x) => x.id === l.variantId);
    const p = prods.find((x) => x.id === l.productId);
    return sum + (v?.weightGrams ?? p?.weightGrams ?? 0) * l.quantity;
  }, 0);
}

/**
 * Prices a rate for a cart, or null if the rate does not apply (zone, currency, weight or
 * subtotal window). Free-shipping thresholds compare the subtotal after line discounts.
 */
export async function rateForCart(tx: Transaction, cart: CartRow, lines: CalculatedLine[], address: PostalAddress, rate: RateRow): Promise<{ name: string; amount: bigint } | null> {
  if (!rate.isActive || rate.currency !== cart.currency) return null;
  const zone = await tx.query.shippingZones.findFirst({ where: eq(shippingZones.id, rate.zoneId) });
  if (!zone || !zoneMatches(zone, address)) return null;
  const subtotal = lines.filter((l) => l.available).reduce((s, l) => s + l.subtotal - l.discount, 0n);
  const value = rate.type === "weight_based" ? BigInt(await cartWeightGrams(tx, lines)) : rate.type === "price_based" ? subtotal : null;
  if (value !== null) {
    if (rate.minValue !== null && value < rate.minValue) return null;
    if (rate.maxValue !== null && value > rate.maxValue) return null;
  }
  const amount = rate.freeOverAmount !== null && subtotal >= rate.freeOverAmount ? 0n : rate.amount;
  return { name: rate.name[cart.locale] ?? Object.values(rate.name)[0] ?? "", amount };
}

export async function availableRates(tx: Transaction, cart: CartRow, lines: CalculatedLine[], address: PostalAddress) {
  const rates = await tx
    .select()
    .from(shippingRates)
    .where(and(eq(shippingRates.storeId, cart.storeId), eq(shippingRates.isActive, true)))
    .orderBy(asc(shippingRates.position), asc(shippingRates.amount));
  const out: { id: string; name: string; amount: bigint; carrierCode: string | null; minDeliveryDays: number | null; maxDeliveryDays: number | null }[] = [];
  for (const r of rates) {
    const priced = await rateForCart(tx, cart, lines, address, r);
    if (priced) out.push({ id: r.id, name: priced.name, amount: priced.amount, carrierCode: r.carrierCode, minDeliveryDays: r.minDeliveryDays, maxDeliveryDays: r.maxDeliveryDays });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Admin configuration
// ---------------------------------------------------------------------------

export async function listShippingZones(db: Database, ctx: StoreContext) {
  assertCan(ctx, "settings:read");
  return withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, async (tx) => {
    const zones = await tx.select().from(shippingZones).where(eq(shippingZones.storeId, ctx.storeId)).orderBy(asc(shippingZones.name));
    const rates = zones.length ? await tx.select().from(shippingRates).where(inArray(shippingRates.zoneId, zones.map((z) => z.id))).orderBy(asc(shippingRates.position)) : [];
    return zones.map((z) => ({ ...z, rates: rates.filter((r) => r.zoneId === z.id) }));
  });
}

export async function saveShippingZone(db: Database, ctx: StoreContext, input: z.infer<typeof zoneSchema>, zoneId?: string) {
  assertCan(ctx, "settings:write");
  for (const r of input.rates) {
    if (!ctx.store.supportedCurrencies.includes(r.currency)) throw invalid("errors.pricing.currency_not_enabled", { currency: r.currency });
    if (r.minValue != null && r.maxValue != null && r.minValue > r.maxValue) throw invalid("errors.shipping.invalid_window");
  }
  const scope = { organizationId: ctx.organizationId, storeId: ctx.storeId };
  return withTenantTx(db, scope, async (tx) => {
    const id = zoneId ?? newId();
    if (zoneId) {
      const [z] = await tx
        .update(shippingZones)
        .set({ name: input.name, countryCodes: input.countryCodes, provinces: input.provinces })
        .where(and(eq(shippingZones.id, zoneId), eq(shippingZones.storeId, ctx.storeId)))
        .returning();
      if (!z) throw notFound("shipping_zone", zoneId);
    } else {
      await tx.insert(shippingZones).values({ id, ...scope, name: input.name, countryCodes: input.countryCodes, provinces: input.provinces });
    }
    const keep = input.rates.map((r) => r.id).filter((x): x is string => !!x);
    const existing = await tx.select().from(shippingRates).where(eq(shippingRates.zoneId, id));
    for (const e of existing) if (!keep.includes(e.id)) await tx.update(shippingRates).set({ isActive: false }).where(eq(shippingRates.id, e.id));
    for (const [position, r] of input.rates.entries()) {
      const values = {
        name: r.name,
        type: r.type,
        currency: r.currency,
        amount: r.amount,
        minValue: r.minValue ?? null,
        maxValue: r.maxValue ?? null,
        freeOverAmount: r.freeOverAmount ?? null,
        carrierCode: r.carrierCode ?? null,
        minDeliveryDays: r.minDeliveryDays ?? null,
        maxDeliveryDays: r.maxDeliveryDays ?? null,
        taxClassId: r.taxClassId ?? null,
        isActive: r.isActive,
        position,
      };
      if (r.id && existing.some((e) => e.id === r.id)) await tx.update(shippingRates).set(values).where(eq(shippingRates.id, r.id));
      else await tx.insert(shippingRates).values({ id: newId(), ...scope, zoneId: id, ...values });
    }
    await recordAudit(tx, { action: "shipping_zone.saved", resourceType: "shipping_zone", resourceId: id, after: { name: input.name, rates: input.rates.length } });
    return id;
  });
}
