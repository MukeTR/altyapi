import { z } from "zod";
import { AppError, currencySchema, invalid, newId, notFound } from "@altyapi/commerce-core";
import {
  and,
  cartAddresses,
  cartLines,
  carts,
  cartShippingMethods,
  cartTotals,
  channelListings,
  channels,
  eq,
  isNull,
  orders,
  productVariants,
  products,
  shippingRates,
  sql,
  stores,
  withTenantTx,
  type Database,
  type PostalAddress,
  type TouchPoint,
  type Transaction,
} from "@altyapi/database";
import { generateToken, sha256 } from "@altyapi/auth";
import { cancelUnpaidOrder } from "@altyapi/orders";
import { calculateCart, type CartCalculation, type CartRow } from "./calculate";
import type { DiscountEngine } from "./discounts";
import { availableRates, rateForCart } from "./shipping";

export interface StoreRef {
  organizationId: string;
  storeId: string;
}

export interface CartDeps {
  db: Database;
  discounts: DiscountEngine;
}

const MAX_LINE_QUANTITY = 999;
const MAX_LINES = 100;

async function storeInfo(tx: Transaction, storeId: string) {
  const s = await tx.query.stores.findFirst({ where: eq(stores.id, storeId) });
  if (!s) throw notFound("store", storeId);
  return s;
}

export async function loadCart(tx: Transaction, ref: StoreRef, token: string, lock = false): Promise<CartRow> {
  const q = tx.select().from(carts).where(and(eq(carts.tokenHash, sha256(token)), eq(carts.storeId, ref.storeId)));
  const [cart] = lock ? await q.for("update") : await q;
  if (!cart) throw new AppError("not_found", "errors.cart.not_found");
  return cart;
}

/**
 * Any change to a cart with an in-flight checkout voids that pending order (releasing its
 * reservations), so the shopper always pays for exactly what is in the cart.
 */
async function reopenIfCheckingOut(tx: Transaction, ref: StoreRef, cart: CartRow): Promise<void> {
  if (cart.status === "completed") throw new AppError("conflict", "errors.cart.completed");
  if (cart.status !== "checking_out") return;
  const pending = await tx.query.orders.findFirst({ where: and(eq(orders.cartId, cart.id), eq(orders.status, "awaiting_payment")) });
  if (pending) await cancelUnpaidOrder(tx, ref, pending.id, "cart_modified");
  await tx.update(carts).set({ status: "active" }).where(eq(carts.id, cart.id));
}

async function touch(tx: Transaction, cartId: string, patch: Partial<typeof carts.$inferInsert> = {}) {
  await tx
    .update(carts)
    .set({ ...patch, version: sql`${carts.version} + 1`, lastActivityAt: new Date(), abandonedAt: null })
    .where(eq(carts.id, cartId));
}

export const createCartSchema = z.object({
  currency: currencySchema.optional(),
  locale: z.string().regex(/^[a-z]{2}$/).optional(),
  anonymousId: z.string().max(64).optional(),
});

export async function createCart(db: Database, ref: StoreRef, input: z.infer<typeof createCartSchema>, customerId: string | null = null) {
  return withTenantTx(db, ref, async (tx) => {
    const store = await storeInfo(tx, ref.storeId);
    const currency = input.currency && store.supportedCurrencies.includes(input.currency) ? input.currency : store.defaultCurrency;
    const locale = input.locale && store.supportedLocales.includes(input.locale) ? input.locale : store.defaultLocale;
    const channel = await tx.query.channels.findFirst({ where: and(eq(channels.storeId, ref.storeId), eq(channels.isDefault, true)) });
    const token = generateToken(32);
    const [cart] = await tx
      .insert(carts)
      .values({ id: newId(), ...ref, tokenHash: sha256(token), currency, locale, channelId: channel?.id ?? null, customerId, anonymousId: input.anonymousId ?? null })
      .returning();
    return { cart: cart!, token };
  });
}

/** Recalculates and stores the totals projection; returns the full calculation. */
export async function viewCart(deps: CartDeps, ref: StoreRef, token: string): Promise<{ cart: CartRow; calc: CartCalculation }> {
  return withTenantTx(deps.db, ref, async (tx) => {
    const cart = await loadCart(tx, ref, token);
    const store = await storeInfo(tx, ref.storeId);
    const calc = await calculateCart(tx, cart, deps.discounts, { defaultLocale: store.defaultLocale });
    await tx
      .insert(cartTotals)
      .values({ cartId: cart.id, ...ref, currency: cart.currency, ...calc.totals })
      .onConflictDoUpdate({ target: cartTotals.cartId, set: { ...calc.totals, currency: cart.currency, computedAt: new Date() } });
    return { cart, calc };
  });
}

export const addLineSchema = z.object({
  variantId: z.uuid(),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
  properties: z.record(z.string().max(50), z.string().max(250)).default({}),
});

export async function addLine(deps: CartDeps, ref: StoreRef, token: string, input: z.infer<typeof addLineSchema>) {
  await withTenantTx(deps.db, ref, async (tx) => {
    const cart = await loadCart(tx, ref, token, true);
    await reopenIfCheckingOut(tx, ref, cart);
    const variant = await tx.query.productVariants.findFirst({
      where: and(eq(productVariants.id, input.variantId), eq(productVariants.storeId, ref.storeId), isNull(productVariants.archivedAt)),
    });
    if (!variant) throw notFound("variant", input.variantId);
    const product = await tx.query.products.findFirst({ where: eq(products.id, variant.productId) });
    if (!product || product.status !== "active") throw new AppError("unprocessable", "errors.cart.product_unavailable");
    if (cart.channelId) {
      const listing = await tx.query.channelListings.findFirst({ where: and(eq(channelListings.productId, product.id), eq(channelListings.channelId, cart.channelId)) });
      if (listing && (!listing.isVisible || !listing.availableForPurchase)) throw new AppError("unprocessable", "errors.cart.product_unavailable");
    }
    const lines = await tx.select().from(cartLines).where(eq(cartLines.cartId, cart.id));
    const same = lines.find((l) => l.variantId === input.variantId && JSON.stringify(l.properties) === JSON.stringify(input.properties));
    if (same) {
      await tx.update(cartLines).set({ quantity: Math.min(MAX_LINE_QUANTITY, same.quantity + input.quantity) }).where(eq(cartLines.id, same.id));
    } else {
      if (lines.length >= MAX_LINES) throw invalid("errors.cart.too_many_lines");
      await tx.insert(cartLines).values({ id: newId(), ...ref, cartId: cart.id, productId: product.id, variantId: variant.id, quantity: input.quantity, properties: input.properties });
    }
    await touch(tx, cart.id);
  });
  return viewCart(deps, ref, token);
}

export const updateLineSchema = z.object({ quantity: z.number().int().min(0).max(MAX_LINE_QUANTITY) });

export async function updateLine(deps: CartDeps, ref: StoreRef, token: string, lineId: string, input: z.infer<typeof updateLineSchema>) {
  await withTenantTx(deps.db, ref, async (tx) => {
    const cart = await loadCart(tx, ref, token, true);
    await reopenIfCheckingOut(tx, ref, cart);
    const line = await tx.query.cartLines.findFirst({ where: and(eq(cartLines.id, lineId), eq(cartLines.cartId, cart.id)) });
    if (!line) throw notFound("cart_line", lineId);
    if (input.quantity === 0) await tx.delete(cartLines).where(eq(cartLines.id, lineId));
    else await tx.update(cartLines).set({ quantity: input.quantity }).where(eq(cartLines.id, lineId));
    await touch(tx, cart.id);
  });
  return viewCart(deps, ref, token);
}

/** Turkish national id (TCKN) checksum; VKN (10 digits) is accepted for companies. */
export function validTurkishId(v: string): boolean {
  if (/^\d{10}$/.test(v)) return true;
  if (!/^[1-9]\d{10}$/.test(v)) return false;
  const d = v.split("").map(Number);
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const even = d[1]! + d[3]! + d[5]! + d[7]!;
  const d10 = (((odd * 7 - even) % 10) + 10) % 10;
  const d11 = d.slice(0, 10).reduce((s, x) => s + x, 0) % 10;
  return d10 === d[9] && d11 === d[10];
}

export const addressSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  company: z.string().trim().max(120).nullable().optional(),
  line1: z.string().trim().min(3).max(250),
  line2: z.string().trim().max(250).nullable().optional(),
  district: z.string().trim().max(80).nullable().optional(),
  city: z.string().trim().min(1).max(80),
  province: z.string().trim().max(80).nullable().optional(),
  postalCode: z.string().trim().max(20).nullable().optional(),
  countryCode: z.string().length(2).toUpperCase(),
  phone: z.string().trim().max(32).nullable().optional(),
  identityNumber: z
    .string()
    .trim()
    .refine(validTurkishId, "errors.address.invalid_identity_number")
    .nullable()
    .optional(),
  taxNumber: z.string().trim().max(20).nullable().optional(),
  taxOffice: z.string().trim().max(80).nullable().optional(),
});

export const setContactSchema = z.object({
  email: z.email().max(254).transform((e) => e.trim().toLowerCase()),
  phone: z.string().trim().min(7).max(32).nullable().optional(),
  acceptsMarketing: z.boolean().default(false),
  note: z.string().max(1000).nullable().optional(),
});

export async function setContact(deps: CartDeps, ref: StoreRef, token: string, input: z.infer<typeof setContactSchema>) {
  await withTenantTx(deps.db, ref, async (tx) => {
    const cart = await loadCart(tx, ref, token, true);
    await reopenIfCheckingOut(tx, ref, cart);
    await touch(tx, cart.id, { email: input.email, phone: input.phone ?? null, acceptsMarketing: input.acceptsMarketing, note: input.note ?? null });
  });
  return viewCart(deps, ref, token);
}

export const setAddressesSchema = z.object({
  shipping: addressSchema.nullable(),
  billing: addressSchema.nullable().optional(),
  billingSameAsShipping: z.boolean().default(true),
});

export async function setAddresses(deps: CartDeps, ref: StoreRef, token: string, input: z.infer<typeof setAddressesSchema>) {
  await withTenantTx(deps.db, ref, async (tx) => {
    const cart = await loadCart(tx, ref, token, true);
    await reopenIfCheckingOut(tx, ref, cart);
    await tx.delete(cartAddresses).where(eq(cartAddresses.cartId, cart.id));
    if (input.shipping) await tx.insert(cartAddresses).values({ cartId: cart.id, ...ref, type: "shipping", address: input.shipping as PostalAddress });
    const billing = input.billingSameAsShipping ? input.shipping : input.billing;
    if (billing) await tx.insert(cartAddresses).values({ cartId: cart.id, ...ref, type: "billing", address: billing as PostalAddress });
    await touch(tx, cart.id);
  });
  return viewCart(deps, ref, token);
}

export async function shippingOptions(deps: CartDeps, ref: StoreRef, token: string) {
  return withTenantTx(deps.db, ref, async (tx) => {
    const cart = await loadCart(tx, ref, token);
    const store = await storeInfo(tx, ref.storeId);
    const calc = await calculateCart(tx, cart, deps.discounts, { defaultLocale: store.defaultLocale });
    if (!calc.requiresShipping) return [];
    if (!calc.shippingAddress) throw new AppError("precondition_failed", "errors.cart.shipping_address_required");
    return availableRates(tx, cart, calc.lines, calc.shippingAddress);
  });
}

export async function selectShippingRate(deps: CartDeps, ref: StoreRef, token: string, rateId: string) {
  await withTenantTx(deps.db, ref, async (tx) => {
    const cart = await loadCart(tx, ref, token, true);
    await reopenIfCheckingOut(tx, ref, cart);
    const store = await storeInfo(tx, ref.storeId);
    const calc = await calculateCart(tx, cart, deps.discounts, { defaultLocale: store.defaultLocale });
    if (!calc.shippingAddress) throw new AppError("precondition_failed", "errors.cart.shipping_address_required");
    const rate = await tx.query.shippingRates.findFirst({ where: and(eq(shippingRates.id, rateId), eq(shippingRates.storeId, ref.storeId)) });
    if (!rate) throw notFound("shipping_rate", rateId);
    const priced = await rateForCart(tx, cart, calc.lines, calc.shippingAddress, rate);
    if (!priced) throw new AppError("unprocessable", "errors.cart.shipping_rate_not_applicable");
    await tx
      .insert(cartShippingMethods)
      .values({ cartId: cart.id, ...ref, shippingRateId: rate.id, name: priced.name, carrierCode: rate.carrierCode, amount: priced.amount, currency: cart.currency })
      .onConflictDoUpdate({ target: cartShippingMethods.cartId, set: { shippingRateId: rate.id, name: priced.name, carrierCode: rate.carrierCode, amount: priced.amount } });
    await touch(tx, cart.id);
  });
  return viewCart(deps, ref, token);
}

export const couponSchema = z.object({ code: z.string().trim().min(2).max(64).transform((c) => c.toUpperCase()) });

/** Adds a coupon; codes the campaign engine rejects are removed and reported. */
export async function applyCoupon(deps: CartDeps, ref: StoreRef, token: string, code: string) {
  await withTenantTx(deps.db, ref, async (tx) => {
    const cart = await loadCart(tx, ref, token, true);
    await reopenIfCheckingOut(tx, ref, cart);
    if (cart.couponCodes.includes(code)) return;
    if (cart.couponCodes.length >= 5) throw invalid("errors.cart.too_many_coupons");
    await touch(tx, cart.id, { couponCodes: [...cart.couponCodes, code] });
  });
  const view = await viewCart(deps, ref, token);
  const rejected = view.calc.rejectedCodes.find((r) => r.code === code);
  if (rejected) {
    await removeCoupon(deps, ref, token, code);
    throw new AppError("unprocessable", "errors.coupon.rejected", { code, reason: rejected.reason });
  }
  return view;
}

export async function removeCoupon(deps: CartDeps, ref: StoreRef, token: string, code: string) {
  await withTenantTx(deps.db, ref, async (tx) => {
    const cart = await loadCart(tx, ref, token, true);
    await reopenIfCheckingOut(tx, ref, cart);
    await touch(tx, cart.id, { couponCodes: cart.couponCodes.filter((c) => c !== code) });
  });
  return viewCart(deps, ref, token);
}

const touchSchema = z.object({
  at: z.iso.datetime(),
  utmSource: z.string().max(200).nullable().optional(),
  utmMedium: z.string().max(200).nullable().optional(),
  utmCampaign: z.string().max(200).nullable().optional(),
  utmContent: z.string().max(200).nullable().optional(),
  utmTerm: z.string().max(200).nullable().optional(),
  referrer: z.string().max(1000).nullable().optional(),
  landingPage: z.string().max(1000).nullable().optional(),
  clickIds: z.partialRecord(z.enum(["gclid", "gbraid", "wbraid", "fbclid", "ttclid", "msclkid"]), z.string().max(500)).optional(),
});

export const attributionSchema = z.object({
  firstTouch: touchSchema.nullable().optional(),
  lastTouch: touchSchema.nullable().optional(),
  affiliateCode: z.string().max(64).nullable().optional(),
  consent: z.object({ analytics: z.boolean(), marketing: z.boolean() }).optional(),
  // Malformed browser cookies are dropped rather than failing the request.
  identifiers: z
    .object({
      fbp: z.string().max(200).regex(/^fb\.\d\.\d+\.\d+$/).nullable().optional().catch(null),
      fbc: z.string().max(500).regex(/^fb\.\d\.\d+\.[\w-]+$/).nullable().optional().catch(null),
      ttp: z.string().max(200).regex(/^[\w.-]+$/).nullable().optional().catch(null),
      ttclid: z.string().max(500).regex(/^[\w.-]+$/).nullable().optional().catch(null),
      gaClientId: z.string().max(100).regex(/^\d+\.\d+$/).nullable().optional().catch(null),
    })
    .optional(),
});

/**
 * Stores attribution sent by the storefront. Consent decides what is kept: browser
 * identifiers for ad platforms need marketing consent, the GA client id needs analytics
 * consent, and withdrawing consent clears what was stored before.
 */
export async function setAttribution(deps: CartDeps, ref: StoreRef, token: string, input: z.infer<typeof attributionSchema>) {
  await withTenantTx(deps.db, ref, async (tx) => {
    const cart = await loadCart(tx, ref, token, true);
    const current = cart.attribution;
    const consent = input.consent ?? current.consent ?? { analytics: false, marketing: false };
    const tracked = consent.marketing || consent.analytics;
    const ids = { ...(current.identifiers ?? {}), ...(input.identifiers ?? {}) };
    await tx
      .update(carts)
      .set({
        attribution: {
          firstTouch: tracked ? (current.firstTouch ?? (input.firstTouch as TouchPoint | null | undefined) ?? null) : null,
          lastTouch: tracked ? ((input.lastTouch as TouchPoint | null | undefined) ?? current.lastTouch ?? null) : null,
          affiliateCode: input.affiliateCode ?? current.affiliateCode ?? null,
          couponCode: current.couponCode ?? null,
          consent,
          identifiers: {
            fbp: consent.marketing ? (ids.fbp ?? null) : null,
            fbc: consent.marketing ? (ids.fbc ?? null) : null,
            ttp: consent.marketing ? (ids.ttp ?? null) : null,
            ttclid: consent.marketing ? (ids.ttclid ?? null) : null,
            gaClientId: consent.analytics ? (ids.gaClientId ?? null) : null,
          },
        },
      })
      .where(eq(carts.id, cart.id));
  });
}
