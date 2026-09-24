import { allocate, money, percentageOf } from "@altyapi/commerce-core";
import {
  and,
  cartAddresses,
  cartLines,
  carts,
  cartShippingMethods,
  contentAssets,
  customerGroupMembers,
  eq,
  inArray,
  productCollections,
  productMedia,
  products,
  productTags,
  productTranslations,
  productVariants,
  productOptionValues,
  shippingRates,
  sql,
  tags,
  taxClasses,
  type PostalAddress,
  type Transaction,
} from "@altyapi/database";
import { getStockForVariants } from "@altyapi/inventory";
import { latestCosts, resolvePrices } from "@altyapi/pricing";
import type { DiscountEngine, DiscountResult } from "./discounts";
import { rateForCart } from "./shipping";

export type CartRow = typeof carts.$inferSelect;

export interface CalculatedLine {
  id: string;
  productId: string;
  variantId: string;
  title: string;
  variantTitle: string | null;
  handle: string | null;
  sku: string | null;
  imageObjectKey: string | null;
  quantity: number;
  unitPrice: bigint;
  compareAtUnitPrice: bigint | null;
  unitCost: bigint | null;
  subtotal: bigint;
  discount: bigint;
  total: bigint;
  taxRateBps: number;
  taxAmount: bigint;
  taxIncluded: boolean;
  requiresShipping: boolean;
  properties: Record<string, string>;
  available: boolean;
  availableQuantity: number | null;
  issues: string[];
}

export interface CartCalculation {
  cartId: string;
  currency: string;
  lines: CalculatedLine[];
  discounts: DiscountResult["discounts"];
  appliedCodes: string[];
  rejectedCodes: DiscountResult["rejectedCodes"];
  shipping: { rateId: string; name: string; carrierCode: string | null; amount: bigint; discount: bigint; taxAmount: bigint; taxRateBps: number } | null;
  requiresShipping: boolean;
  shippingAddress: PostalAddress | null;
  billingAddress: PostalAddress | null;
  totals: { subtotal: bigint; discountTotal: bigint; shippingTotal: bigint; taxTotal: bigint; total: bigint };
  issues: string[];
  itemCount: number;
}

/** Tax contained in a tax-inclusive gross amount, rounded half-up: G·r / (10000 + r). */
export function includedTax(gross: bigint, rateBps: number): bigint {
  if (rateBps <= 0 || gross <= 0n) return 0n;
  const num = gross * BigInt(rateBps);
  const den = BigInt(10000 + rateBps);
  return (num * 2n + den) / (den * 2n);
}

/**
 * Deterministic cart pricing: list prices (customer/channel aware) → campaign discounts →
 * shipping → taxes. Prices are never taken from the client; every call re-reads catalog,
 * price lists and stock.
 */
export async function calculateCart(tx: Transaction, cart: CartRow, engine: DiscountEngine, opts: { defaultLocale: string }): Promise<CartCalculation> {
  const lines = await tx.select().from(cartLines).where(eq(cartLines.cartId, cart.id));
  const variantIds = lines.map((l) => l.variantId);
  const productIds = [...new Set(lines.map((l) => l.productId))];

  const groupIds = cart.customerId
    ? (await tx.select({ id: customerGroupMembers.groupId }).from(customerGroupMembers).where(eq(customerGroupMembers.customerId, cart.customerId))).map((g) => g.id)
    : [];

  const [variants, prods, titles, prices, stock, costs, media, tagRows, colRows] = await Promise.all([
    variantIds.length ? tx.select().from(productVariants).where(inArray(productVariants.id, variantIds)) : Promise.resolve([]),
    productIds.length ? tx.select().from(products).where(inArray(products.id, productIds)) : Promise.resolve([]),
    productIds.length
      ? tx.select().from(productTranslations).where(and(inArray(productTranslations.productId, productIds), inArray(productTranslations.locale, [cart.locale, opts.defaultLocale])))
      : Promise.resolve([]),
    resolvePrices(tx, { storeId: cart.storeId, currency: cart.currency, channelId: cart.channelId, customerGroupIds: groupIds }, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity }))),
    getStockForVariants(tx, { organizationId: cart.organizationId, storeId: cart.storeId }, variantIds),
    latestCosts(tx, cart.storeId, variantIds, cart.currency),
    productIds.length
      ? tx
          .select({ productId: productMedia.productId, position: productMedia.position, variantIds: productMedia.variantIds, objectKey: contentAssets.objectKey })
          .from(productMedia)
          .innerJoin(contentAssets, eq(contentAssets.id, productMedia.assetId))
          .where(inArray(productMedia.productId, productIds))
      : Promise.resolve([]),
    productIds.length
      ? tx.select({ productId: productTags.productId, name: tags.name }).from(productTags).innerJoin(tags, eq(tags.id, productTags.tagId)).where(inArray(productTags.productId, productIds))
      : Promise.resolve([]),
    productIds.length ? tx.select().from(productCollections).where(inArray(productCollections.productId, productIds)) : Promise.resolve([]),
  ]);
  const valueIds = [...new Set(variants.flatMap((v) => v.optionValueIds))];
  const values = valueIds.length ? await tx.select().from(productOptionValues).where(inArray(productOptionValues.id, valueIds)) : [];
  const taxRows = await tx.select().from(taxClasses).where(eq(taxClasses.storeId, cart.storeId));
  const defaultTax = taxRows.find((t) => t.isDefault) ?? null;

  const calc: CalculatedLine[] = lines.map((l) => {
    const v = variants.find((x) => x.id === l.variantId);
    const p = prods.find((x) => x.id === l.productId);
    const tr = titles.find((t) => t.productId === l.productId && t.locale === cart.locale) ?? titles.find((t) => t.productId === l.productId);
    const price = prices.get(l.variantId);
    const s = stock.get(l.variantId);
    const issues: string[] = [];
    const sellable = Boolean(v && p && !v.archivedAt && p.status === "active");
    if (!sellable) issues.push("unavailable");
    if (!price) issues.push("not_sellable_in_currency");
    const unlimited = !s || !s.tracked || s.allowBackorder;
    const availableQuantity = unlimited ? null : Math.max(0, s!.available);
    if (availableQuantity !== null && l.quantity > availableQuantity) issues.push("insufficient_stock");
    const tax = taxRows.find((t) => t.id === (v?.taxClassId ?? p?.taxClassId)) ?? defaultTax;
    const img =
      media.filter((m) => m.productId === l.productId && m.variantIds.includes(l.variantId)).sort((a, b) => a.position - b.position)[0] ??
      media.filter((m) => m.productId === l.productId).sort((a, b) => a.position - b.position)[0];
    const variantTitle = v?.optionValueIds.length
      ? v.optionValueIds
          .map((id) => values.find((x) => x.id === id))
          .map((x) => (x ? x.value[cart.locale] ?? x.value[opts.defaultLocale] ?? Object.values(x.value)[0] : ""))
          .join(" / ")
      : null;
    const unitPrice = price?.amount ?? 0n;
    return {
      id: l.id,
      productId: l.productId,
      variantId: l.variantId,
      title: tr?.title ?? "",
      variantTitle,
      handle: tr?.handle ?? null,
      sku: v?.sku ?? null,
      imageObjectKey: img?.objectKey ?? null,
      quantity: l.quantity,
      unitPrice,
      compareAtUnitPrice: price?.compareAtAmount ?? null,
      unitCost: costs.get(l.variantId) ?? null,
      subtotal: unitPrice * BigInt(l.quantity),
      discount: 0n,
      total: unitPrice * BigInt(l.quantity),
      taxRateBps: tax?.rateBps ?? 0,
      taxAmount: 0n,
      taxIncluded: tax?.pricesIncludeTax ?? true,
      requiresShipping: v?.requiresShipping ?? true,
      properties: l.properties,
      available: sellable && Boolean(price) && !issues.includes("insufficient_stock"),
      availableQuantity,
      issues,
    };
  });

  const subtotal = calc.reduce((s, l) => s + l.subtotal, 0n);
  const requiresShipping = calc.some((l) => l.requiresShipping);
  const addresses = await tx.select().from(cartAddresses).where(eq(cartAddresses.cartId, cart.id));
  const shippingAddress = addresses.find((a) => a.type === "shipping")?.address ?? null;
  const billingAddress = addresses.find((a) => a.type === "billing")?.address ?? shippingAddress;

  // Shipping: re-validate the selected rate against the current cart (zone, weight, subtotal).
  const selected = await tx.query.cartShippingMethods.findFirst({ where: eq(cartShippingMethods.cartId, cart.id) });
  let shipping: CartCalculation["shipping"] = null;
  const cartIssues: string[] = [];
  if (requiresShipping && selected) {
    const rate = await tx.query.shippingRates.findFirst({ where: and(eq(shippingRates.id, selected.shippingRateId), eq(shippingRates.isActive, true)) });
    const priced = rate && shippingAddress ? await rateForCart(tx, cart, calc, shippingAddress, rate) : null;
    if (!priced) {
      cartIssues.push("shipping_method_unavailable");
    } else {
      const tax = taxRows.find((t) => t.id === rate!.taxClassId) ?? defaultTax;
      shipping = { rateId: rate!.id, name: priced.name, carrierCode: rate!.carrierCode, amount: priced.amount, discount: 0n, taxAmount: 0n, taxRateBps: tax?.rateBps ?? 0 };
    }
  }

  // Campaigns
  const lineCollections = (productId: string) => colRows.filter((c) => c.productId === productId).map((c) => c.collectionId);
  const discountResult = await engine.evaluate(tx, {
    storeId: cart.storeId,
    organizationId: cart.organizationId,
    currency: cart.currency,
    channelId: cart.channelId,
    customer: { id: cart.customerId, email: cart.email, groupIds, isFirstOrder: await isFirstOrder(tx, cart) },
    lines: calc
      .filter((l) => l.available)
      .map((l) => ({
        lineId: l.id,
        productId: l.productId,
        variantId: l.variantId,
        collectionIds: lineCollections(l.productId),
        tags: tagRows.filter((t) => t.productId === l.productId).map((t) => t.name),
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        lineSubtotal: l.subtotal,
        unitCost: l.unitCost,
      })),
    subtotal,
    shipping: shipping ? { rateId: shipping.rateId, amount: shipping.amount } : null,
    couponCodes: cart.couponCodes,
    at: new Date(),
  });
  for (const d of discountResult.discounts) {
    for (const la of d.lineAmounts) {
      const line = calc.find((l) => l.id === la.lineId);
      if (line) line.discount += la.amount;
    }
    if (shipping) shipping.discount += d.shippingAmount;
  }
  for (const l of calc) {
    if (l.discount > l.subtotal) l.discount = l.subtotal;
    l.total = l.subtotal - l.discount;
    l.taxAmount = l.taxIncluded ? includedTax(l.total, l.taxRateBps) : percentageOf(money(l.total, cart.currency), l.taxRateBps).amount;
  }
  if (shipping) {
    if (shipping.discount > shipping.amount) shipping.discount = shipping.amount;
    shipping.taxAmount = includedTax(shipping.amount - shipping.discount, shipping.taxRateBps);
  }

  const sellable = calc.filter((l) => l.available);
  const discountTotal = sellable.reduce((s, l) => s + l.discount, 0n) + (shipping?.discount ?? 0n);
  const shippingTotal = shipping ? shipping.amount : 0n;
  const exclusiveTax = sellable.filter((l) => !l.taxIncluded).reduce((s, l) => s + l.taxAmount, 0n);
  const taxTotal = sellable.reduce((s, l) => s + l.taxAmount, 0n) + (shipping?.taxAmount ?? 0n);
  const sellableSubtotal = sellable.reduce((s, l) => s + l.subtotal, 0n);
  const total = sellableSubtotal - discountTotal + shippingTotal + exclusiveTax;

  if (calc.some((l) => !l.available)) cartIssues.push("unavailable_lines");
  if (requiresShipping && !selected) cartIssues.push("shipping_method_required");
  return {
    cartId: cart.id,
    currency: cart.currency,
    lines: calc,
    discounts: discountResult.discounts,
    appliedCodes: discountResult.appliedCodes,
    rejectedCodes: discountResult.rejectedCodes,
    shipping,
    requiresShipping,
    shippingAddress,
    billingAddress,
    totals: { subtotal: sellableSubtotal, discountTotal, shippingTotal, taxTotal, total },
    issues: cartIssues,
    itemCount: calc.reduce((s, l) => s + l.quantity, 0),
  };
}

async function isFirstOrder(tx: Transaction, cart: CartRow): Promise<boolean> {
  if (!cart.customerId && !cart.email) return true;
  const rows = await tx.execute<{ n: number }>(
    cart.customerId
      ? sql`select count(*)::int as n from orders where store_id = ${cart.storeId} and customer_id = ${cart.customerId} and payment_status in ('paid','partially_refunded','refunded')`
      : sql`select count(*)::int as n from orders where store_id = ${cart.storeId} and lower(email) = lower(${cart.email}) and payment_status in ('paid','partially_refunded','refunded')`,
  );
  return (rows[0]?.n ?? 0) === 0;
}

/** Distributes an order-level amount across lines proportionally to their subtotals. */
export function allocateAcrossLines(amount: bigint, lines: { lineId: string; lineSubtotal: bigint }[], currency: string) {
  const parts = allocate(money(amount, currency), lines.map((l) => l.lineSubtotal));
  return lines.map((l, i) => ({ lineId: l.lineId, amount: parts[i]!.amount }));
}

