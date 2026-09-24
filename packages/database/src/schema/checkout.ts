import { sql } from "drizzle-orm";
import { bigint, boolean, char, index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamps, tstz } from "./_shared";
import { stores } from "./tenancy";
import { customers, type PostalAddress } from "./customers";
import { productVariants, products, taxClasses } from "./catalog";

export interface AttributionSnapshot {
  firstTouch?: TouchPoint | null;
  lastTouch?: TouchPoint | null;
  couponCode?: string | null;
  affiliateCode?: string | null;
  /** Consent state at the time attribution was captured. */
  consent?: { analytics: boolean; marketing: boolean } | null;
  /** Browser identifiers for conversion APIs (only stored with marketing consent). */
  identifiers?: { fbp?: string | null; fbc?: string | null; ttp?: string | null; ttclid?: string | null; gaClientId?: string | null } | null;
  /** Checkout request context for conversion APIs (only with marketing consent). */
  client?: { ip?: string | null; userAgent?: string | null; pageUrl?: string | null } | null;
}

export interface TouchPoint {
  at: string;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  referrer?: string | null;
  landingPage?: string | null;
  clickIds?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Shipping configuration
// ---------------------------------------------------------------------------

export const shippingZones = pgTable(
  "shipping_zones",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    name: text().notNull(),
    countryCodes: text().array().notNull(),
    /** Optional province/city restriction (e.g. Turkish il names); empty = whole countries. */
    provinces: text().array().notNull().default(sql`ARRAY[]::text[]`),
    ...timestamps,
  },
  (t) => [index("shipping_zones_store_idx").on(t.storeId)],
);

export const shippingRateType = pgEnum("shipping_rate_type", ["flat", "weight_based", "price_based"]);

export const shippingRates = pgTable(
  "shipping_rates",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    zoneId: uuid()
      .notNull()
      .references(() => shippingZones.id, { onDelete: "cascade" }),
    name: jsonb().$type<Record<string, string>>().notNull(),
    type: shippingRateType().notNull(),
    currency: char({ length: 3 }).notNull(),
    amount: bigint({ mode: "bigint" }).notNull(),
    /** Condition window: cart subtotal (price_based) or total weight in grams (weight_based). */
    minValue: bigint({ mode: "bigint" }),
    maxValue: bigint({ mode: "bigint" }),
    freeOverAmount: bigint({ mode: "bigint" }),
    carrierCode: text(),
    minDeliveryDays: integer(),
    maxDeliveryDays: integer(),
    taxClassId: uuid().references(() => taxClasses.id, { onDelete: "set null" }),
    isActive: boolean().notNull().default(true),
    position: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [index("shipping_rates_zone_idx").on(t.zoneId)],
);

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

export const cartStatus = pgEnum("cart_status", ["active", "checking_out", "completed", "abandoned", "merged"]);

export const carts = pgTable(
  "carts",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    /** SHA-256 of the bearer token kept in the shopper's cookie. */
    tokenHash: text().notNull(),
    customerId: uuid().references(() => customers.id, { onDelete: "set null" }),
    email: text(),
    phone: text(),
    currency: char({ length: 3 }).notNull(),
    locale: text().notNull(),
    channelId: uuid(),
    status: cartStatus().notNull().default("active"),
    note: text(),
    couponCodes: text().array().notNull().default(sql`ARRAY[]::text[]`),
    attribution: jsonb().$type<AttributionSnapshot>().notNull().default({}),
    acceptsMarketing: boolean().notNull().default(false),
    anonymousId: text(),
    version: integer().notNull().default(1),
    lastActivityAt: tstz().notNull().defaultNow(),
    abandonedAt: tstz(),
    abandonedNotifiedAt: tstz(),
    completedOrderId: uuid(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("carts_token_uq").on(t.tokenHash),
    index("carts_store_activity_idx").on(t.storeId, t.status, t.lastActivityAt),
    index("carts_customer_idx").on(t.customerId),
  ],
);

export const cartLines = pgTable(
  "cart_lines",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    cartId: uuid()
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    quantity: integer().notNull(),
    properties: jsonb().$type<Record<string, string>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [index("cart_lines_cart_idx").on(t.cartId), uniqueIndex("cart_lines_variant_uq").on(t.cartId, t.variantId, sql`md5(${t.properties}::text)`)],
);

export const cartDiscounts = pgTable(
  "cart_discounts",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    cartId: uuid()
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    campaignId: uuid(),
    code: text(),
    cartLineId: uuid(),
    target: text().notNull(),
    amount: bigint({ mode: "bigint" }).notNull(),
    description: text().notNull(),
  },
  (t) => [index("cart_discounts_cart_idx").on(t.cartId)],
);

export const cartAddresses = pgTable(
  "cart_addresses",
  {
    cartId: uuid()
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    type: text().notNull(),
    address: jsonb().$type<PostalAddress>().notNull(),
  },
  (t) => [uniqueIndex("cart_addresses_pk").on(t.cartId, t.type)],
);

export const cartShippingMethods = pgTable("cart_shipping_methods", {
  cartId: uuid()
    .primaryKey()
    .references(() => carts.id, { onDelete: "cascade" }),
  organizationId: uuid().notNull(),
  storeId: uuid().notNull(),
  shippingRateId: uuid().notNull(),
  name: text().notNull(),
  carrierCode: text(),
  amount: bigint({ mode: "bigint" }).notNull(),
  currency: char({ length: 3 }).notNull(),
});

export const cartTaxLines = pgTable(
  "cart_tax_lines",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    cartId: uuid()
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    cartLineId: uuid(),
    source: text().notNull(),
    rateBps: integer().notNull(),
    amount: bigint({ mode: "bigint" }).notNull(),
    included: boolean().notNull(),
  },
  (t) => [index("cart_tax_lines_cart_idx").on(t.cartId)],
);

/** Last computed totals (projection; always recomputed before checkout). */
export const cartTotals = pgTable("cart_totals", {
  cartId: uuid()
    .primaryKey()
    .references(() => carts.id, { onDelete: "cascade" }),
  organizationId: uuid().notNull(),
  storeId: uuid().notNull(),
  currency: char({ length: 3 }).notNull(),
  subtotal: bigint({ mode: "bigint" }).notNull(),
  discountTotal: bigint({ mode: "bigint" }).notNull(),
  shippingTotal: bigint({ mode: "bigint" }).notNull(),
  taxTotal: bigint({ mode: "bigint" }).notNull(),
  total: bigint({ mode: "bigint" }).notNull(),
  computedAt: tstz().notNull().defaultNow(),
});
