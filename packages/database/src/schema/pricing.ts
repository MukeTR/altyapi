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
    effectiveFrom: tstz().notNull().defaultNow(),
    source: text().notNull().default("manual"),
  },
  (t) => [index("variant_costs_variant_idx").on(t.variantId, t.effectiveFrom)],
);
