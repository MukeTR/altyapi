import { sql } from "drizzle-orm";
import { bigint, boolean, char, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamps, tstz } from "./_shared";
import { stores } from "./tenancy";

/**
 * External commerce systems (marketplace integrators such as StockMount or Dopigo,
 * marketplaces read directly, XML/CSV exports). None of them offer webhooks, so every
 * connection is polled; cursors make the polling incremental where the API allows it.
 */

export interface EncryptedEnvelope {
  ciphertext: string;
  iv: string;
  authTag: string;
  encryptedDataKey: string;
  keyId: string;
}

export const integrationKind = pgEnum("integration_kind", ["integrator", "marketplace", "feed"]);
export const integrationStatus = pgEnum("integration_status", ["active", "paused", "error"]);

export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    provider: text().notNull(),
    kind: integrationKind().notNull(),
    name: text().notNull(),
    status: integrationStatus().notNull().default("active"),
    /** Merchant's own credentials for the external system, envelope-encrypted. */
    credentials: jsonb().$type<EncryptedEnvelope>().notNull(),
    /** Non-secret settings (seller id, store ids, feed URL and column mapping, ...). */
    settings: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** Encrypted session state (API tokens obtained with the credentials). */
    session: jsonb().$type<EncryptedEnvelope>(),
    /** Per-resource sync cursors, e.g. { orders: {...}, listings: {...} }. */
    cursors: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    pollIntervalMinutes: integer().notNull().default(15),
    nextSyncAt: tstz().notNull().defaultNow(),
    lastSyncAt: tstz(),
    lastSuccessAt: tstz(),
    lastError: text(),
    consecutiveFailures: integer().notNull().default(0),
    createdByPrincipalId: uuid(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("integration_connections_name_uq").on(t.storeId, t.provider, t.name),
    index("integration_connections_due_idx").on(t.status, t.nextSyncAt),
  ],
);

export const syncRunStatus = pgEnum("integration_sync_run_status", ["running", "succeeded", "partial", "failed"]);

export const integrationSyncRuns = pgTable(
  "integration_sync_runs",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    connectionId: uuid()
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    resource: text().notNull(),
    status: syncRunStatus().notNull().default("running"),
    fetched: integer().notNull().default(0),
    changed: integer().notNull().default(0),
    unchanged: integer().notNull().default(0),
    /** True when the page budget ran out and the next run continues from the cursor. */
    hasMore: boolean().notNull().default(false),
    error: text(),
    startedAt: tstz().notNull().defaultNow(),
    finishedAt: tstz(),
  },
  (t) => [index("integration_sync_runs_connection_idx").on(t.connectionId, t.startedAt)],
);

/** Lifecycle vocabulary shared by every channel; raw statuses are kept next to it. */
export const externalOrderStatus = pgEnum("external_order_status", [
  "pending_payment",
  "awaiting_approval",
  "processing",
  "ready_to_ship",
  "shipped",
  "delivered",
  "undelivered",
  "cancelled",
  "returned",
  "unknown",
]);

export interface ExternalOrderLine {
  externalId: string | null;
  sku: string | null;
  barcode: string | null;
  name: string;
  quantity: number;
  /** Unit price in minor units (string: JSON has no bigint). */
  unitPrice: string | null;
  rawStatus: string | null;
  /** Normalized line status where the channel tracks lines separately. */
  status?: string | null;
}

/**
 * Orders seen on external channels. Personal data is minimised (KVKK): identity numbers,
 * tax numbers, phone numbers, e-mail and street addresses are never stored.
 */
export const externalOrders = pgTable(
  "external_orders",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    connectionId: uuid()
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    provider: text().notNull(),
    externalId: text().notNull(),
    externalNumber: text(),
    /** Sales channel as reported (Trendyol, n11, Hepsiburada, ...). */
    channel: text(),
    rawStatus: text(),
    status: externalOrderStatus().notNull().default("unknown"),
    currency: char({ length: 3 }).notNull(),
    total: bigint({ mode: "bigint" }),
    itemCount: integer().notNull().default(0),
    lines: jsonb().$type<ExternalOrderLine[]>().notNull().default([]),
    shipping: jsonb().$type<{ carrier: string | null; trackingNumber: string | null }>(),
    customer: jsonb().$type<{ name: string | null; city: string | null; district: string | null }>(),
    orderedAt: tstz(),
    externalUpdatedAt: tstz(),
    payloadHash: text().notNull(),
    firstSeenAt: tstz().notNull().defaultNow(),
    lastSeenAt: tstz().notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("external_orders_uq").on(t.connectionId, t.externalId),
    index("external_orders_store_idx").on(t.storeId, t.orderedAt),
    index("external_orders_status_idx").on(t.storeId, t.status),
  ],
);

/** Stock and price per SKU as each external system reports it. */
export const externalListings = pgTable(
  "external_listings",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    connectionId: uuid()
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    provider: text().notNull(),
    externalId: text().notNull(),
    sku: text(),
    barcode: text(),
    title: text(),
    stock: integer(),
    price: bigint({ mode: "bigint" }),
    listPrice: bigint({ mode: "bigint" }),
    currency: char({ length: 3 }),
    active: boolean(),
    /** Matched altyapi variant (by SKU, then barcode). */
    variantId: uuid(),
    externalUpdatedAt: tstz(),
    payloadHash: text().notNull(),
    lastSeenAt: tstz().notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("external_listings_uq").on(t.connectionId, t.externalId),
    index("external_listings_sku_idx").on(t.storeId, t.sku),
    index("external_listings_barcode_idx").on(t.storeId, t.barcode),
    index("external_listings_variant_idx").on(t.variantId),
  ],
);

export const ownershipDomain = pgEnum("data_ownership_domain", ["stock", "price", "content", "order_fulfillment"]);

/**
 * Which system owns each kind of data for a store. Reads come from anywhere; writes go only
 * through the owner. owner_connection_id null means altyapi itself owns the data.
 */
export const dataOwnership = pgTable(
  "data_ownership",
  {
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    domain: ownershipDomain().notNull(),
    ownerConnectionId: uuid().references(() => integrationConnections.id, { onDelete: "set null" }),
    /** Owner outside every connection (e.g. an ERP the merchant runs), for display. */
    externalOwnerLabel: text(),
    updatedByPrincipalId: uuid(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.storeId, t.domain] })],
);

export const discrepancyStatus = pgEnum("integration_discrepancy_status", ["open", "acknowledged", "resolved"]);

export interface DiscrepancyValue {
  source: string;
  label: string;
  value: string | null;
  owner: boolean;
}

/**
 * The same fact differs between systems (e.g. stock 10 in the ERP, 12 in the integrator).
 * Shown to the merchant as a signal; never "fixed" automatically against the owner.
 */
export const integrationDiscrepancies = pgTable(
  "integration_discrepancies",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    variantId: uuid(),
    sku: text().notNull(),
    field: text().notNull(),
    values: jsonb().$type<DiscrepancyValue[]>().notNull(),
    status: discrepancyStatus().notNull().default("open"),
    detectedAt: tstz().notNull().defaultNow(),
    lastCheckedAt: tstz().notNull().defaultNow(),
    resolvedAt: tstz(),
  },
  (t) => [
    uniqueIndex("integration_discrepancies_open_uq").on(t.storeId, t.sku, t.field).where(sql`${t.status} <> 'resolved'`),
    index("integration_discrepancies_store_idx").on(t.storeId, t.status, t.detectedAt),
  ],
);
