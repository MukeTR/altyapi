import { sql } from "drizzle-orm";
import { bigint, boolean, char, check, index, integer, pgEnum, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamps, tstz } from "./_shared";
import { channels, stores } from "./tenancy";
import { productVariants } from "./catalog";
import { customerGroups } from "./customers";

export const priceListKind = pgEnum("price_list_kind", ["base", "sale", "customer_group", "channel", "scheduled"]);

/**
 * A set of prices in one currency. Applicability is narrowed by the link tables
 * (customer_group_prices, channel_prices, scheduled_prices); the resolver picks the
 * applicable list with the highest priority deterministically.
 */
export const priceLists = pgTable(
  "price_lists",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    name: text().notNull(),
    kind: priceListKind().notNull(),
    currency: char({ length: 3 }).notNull(),
    priority: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("price_lists_store_idx").on(t.storeId, t.currency),
    uniqueIndex("price_lists_one_base_uq").on(t.storeId, t.currency).where(sql`${t.kind} = 'base'`),
  ],
);

/** Integer minor-unit amounts. min_quantity > 1 expresses quantity (tier) pricing. */
export const moneyAmounts = pgTable(
  "money_amounts",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    priceListId: uuid()
      .notNull()
      .references(() => priceLists.id, { onDelete: "cascade" }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    currency: char({ length: 3 }).notNull(),
    amount: bigint({ mode: "bigint" }).notNull(),
    compareAtAmount: bigint({ mode: "bigint" }),
    minQuantity: integer().notNull().default(1),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("money_amounts_uq").on(t.priceListId, t.variantId, t.minQuantity),
    index("money_amounts_variant_idx").on(t.variantId),
    check("money_amounts_nonneg", sql`${t.amount} >= 0`),
    check("money_amounts_min_qty", sql`${t.minQuantity} >= 1`),
  ],
);

export const customerGroupPrices = pgTable(
  "customer_group_prices",
  {
    priceListId: uuid()
      .notNull()
      .references(() => priceLists.id, { onDelete: "cascade" }),
    customerGroupId: uuid()
      .notNull()
      .references(() => customerGroups.id, { onDelete: "cascade" }),
    storeId: uuid().notNull(),
    organizationId: uuid().notNull(),
  },
  (t) => [primaryKey({ columns: [t.priceListId, t.customerGroupId] })],
);

export const channelPrices = pgTable(
  "channel_prices",
  {
    priceListId: uuid()
      .notNull()
      .references(() => priceLists.id, { onDelete: "cascade" }),
    channelId: uuid()
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    storeId: uuid().notNull(),
    organizationId: uuid().notNull(),
  },
  (t) => [primaryKey({ columns: [t.priceListId, t.channelId] })],
);

export const scheduledPrices = pgTable(
  "scheduled_prices",
  {
    id: uuid().primaryKey(),
    priceListId: uuid()
      .notNull()
      .references(() => priceLists.id, { onDelete: "cascade" }),
    storeId: uuid().notNull(),
    organizationId: uuid().notNull(),
    startsAt: tstz().notNull(),
    endsAt: tstz(),
  },
  (t) => [index("scheduled_prices_list_idx").on(t.priceListId), check("scheduled_prices_window", sql`${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`)],
);

/**
 * Timeline of applied unit prices, the source of the "previous price" shown next to a
 * discounted price (Ticari Reklam Yönetmeliği: the previous price is derived from what was
 * actually charged, never typed). One row per period in which a price list entry for
 * quantity 1 was in effect; the open row (valid_to null) mirrors the current money_amounts
 * amount of an active list. Every write that changes such an amount closes the open row and
 * opens a new one in the same transaction (packages/pricing, syncPriceHistory); writes that
 * leave the amount unchanged (e.g. only compare_at_amount) add nothing.
 *
 * Every price lives in a price list (the base price in the store's base list), so
 * price_list_id is set on every row it opens. It is nullable only so the history outlives a
 * deleted list: a price that was charged still counts as a previous price afterwards.
 */
export const priceHistory = pgTable(
  "price_history",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    priceListId: uuid().references(() => priceLists.id, { onDelete: "set null" }),
    currency: char({ length: 3 }).notNull(),
    amountMinor: bigint({ mode: "bigint" }).notNull(),
    validFrom: tstz().notNull(),
    validTo: tstz(),
    /** What set the price: manual (panel), api, agent, import (catalog file imports), system (other jobs), backfill. */
    source: text().notNull(),
  },
  (t) => [
    index("price_history_lookup_idx").on(t.storeId, t.variantId, t.currency, t.validFrom),
    // At most one open period per list entry; also serializes concurrent writers.
    uniqueIndex("price_history_open_uq").on(t.priceListId, t.variantId).where(sql`${t.validTo} is null`),
    check("price_history_nonneg", sql`${t.amountMinor} >= 0`),
    check("price_history_period", sql`${t.validTo} is null or ${t.validTo} > ${t.validFrom}`),
  ],
);

/** Unit cost history; used by profit guard and the Kârmatik bridge. */
export const variantCosts = pgTable(
  "variant_costs",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    currency: char({ length: 3 }).notNull(),
    amount: bigint({ mode: "bigint" }).notNull(),
    /** Whether the amount includes VAT; null = unknown (consumers assume net, estimated). */
    taxIncluded: boolean(),
    /** VAT rate of the cost in basis points; null = unknown, never written as 0 by default. */
    taxRateBps: integer(),
    effectiveFrom: tstz().notNull().defaultNow(),
    source: text().notNull().default("manual"),
  },
  (t) => [index("variant_costs_variant_idx").on(t.variantId, t.effectiveFrom)],
);
