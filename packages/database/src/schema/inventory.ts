import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamps, tstz } from "./_shared";
import { stores } from "./tenancy";
import { productVariants } from "./catalog";
import type { PostalAddress } from "./customers";

export const inventoryLocations = pgTable(
  "inventory_locations",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    code: text().notNull(),
    name: text().notNull(),
    address: jsonb().$type<Partial<PostalAddress>>(),
    isActive: boolean().notNull().default(true),
    fulfillsOnlineOrders: boolean().notNull().default(true),
    /** Lower number = preferred for allocation. */
    priority: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("inventory_locations_store_code_uq").on(t.storeId, t.code)],
);

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    sku: text(),
    ...timestamps,
  },
  (t) => [uniqueIndex("inventory_items_variant_uq").on(t.variantId)],
);

/**
 * Projection of the ledger per (item, location), updated in the same transaction as each
 * ledger entry under a row lock. The ledger is authoritative; this row makes reads O(1).
 */
export const inventoryLevels = pgTable(
  "inventory_levels",
  {
    inventoryItemId: uuid()
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    locationId: uuid()
      .notNull()
      .references(() => inventoryLocations.id, { onDelete: "cascade" }),
    storeId: uuid().notNull(),
    organizationId: uuid().notNull(),
    onHand: integer().notNull().default(0),
    reserved: integer().notNull().default(0),
    version: integer().notNull().default(0),
    updatedAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.inventoryItemId, t.locationId] }),
    check("inventory_levels_reserved_nonneg", sql`${t.reserved} >= 0`),
  ],
);

export const ledgerEntryType = pgEnum("ledger_entry_type", [
  "initial_stock",
  "manual_adjustment",
  "order_reserved",
  "reservation_released",
  "order_confirmed",
  "return_received",
  "transfer_in",
  "transfer_out",
]);

export const inventoryLedgerEntries = pgTable(
  "inventory_ledger_entries",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    inventoryItemId: uuid()
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    locationId: uuid()
      .notNull()
      .references(() => inventoryLocations.id, { onDelete: "restrict" }),
    type: ledgerEntryType().notNull(),
    onHandDelta: integer().notNull().default(0),
    reservedDelta: integer().notNull().default(0),
    /** Levels after applying this entry (audit convenience). */
    onHandAfter: integer().notNull(),
    reservedAfter: integer().notNull(),
    referenceType: text(),
    referenceId: text(),
    reason: text(),
    principalType: text(),
    principalId: uuid(),
    idempotencyKey: text(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    index("inventory_ledger_item_idx").on(t.inventoryItemId, t.createdAt),
    uniqueIndex("inventory_ledger_idempotency_uq").on(t.storeId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
  ],
);

export const reservationStatus = pgEnum("reservation_status", ["active", "released", "consumed", "expired"]);

export const stockReservations = pgTable(
  "stock_reservations",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    inventoryItemId: uuid()
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    locationId: uuid()
      .notNull()
      .references(() => inventoryLocations.id, { onDelete: "restrict" }),
    quantity: integer().notNull(),
    cartId: uuid(),
    orderId: uuid(),
    status: reservationStatus().notNull().default("active"),
    expiresAt: tstz().notNull(),
    ...timestamps,
  },
  (t) => [
    index("stock_reservations_expiry_idx").on(t.expiresAt).where(sql`${t.status} = 'active'`),
    index("stock_reservations_order_idx").on(t.orderId),
    index("stock_reservations_cart_idx").on(t.cartId),
  ],
);

export const transferStatus = pgEnum("transfer_status", ["draft", "in_transit", "received", "cancelled"]);

export const stockTransfers = pgTable(
  "stock_transfers",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    fromLocationId: uuid()
      .notNull()
      .references(() => inventoryLocations.id),
    toLocationId: uuid()
      .notNull()
      .references(() => inventoryLocations.id),
    status: transferStatus().notNull().default("draft"),
    note: text(),
    shippedAt: tstz(),
    receivedAt: tstz(),
    ...timestamps,
  },
  (t) => [index("stock_transfers_store_idx").on(t.storeId, t.createdAt)],
);

export const stockTransferLines = pgTable(
  "stock_transfer_lines",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    transferId: uuid()
      .notNull()
      .references(() => stockTransfers.id, { onDelete: "cascade" }),
    inventoryItemId: uuid()
      .notNull()
      .references(() => inventoryItems.id),
    quantity: integer().notNull(),
    receivedQuantity: integer().notNull().default(0),
  },
  (t) => [index("stock_transfer_lines_transfer_idx").on(t.transferId)],
);
