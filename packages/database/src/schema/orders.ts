import { sql } from "drizzle-orm";
import { bigint, boolean, char, index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamps, tstz } from "./_shared";
import { stores } from "./tenancy";
import { customers, type PostalAddress } from "./customers";
import { inventoryLocations } from "./inventory";
import type { AttributionSnapshot } from "./checkout";

export const orderStatus = pgEnum("order_status", [
  "draft",
  "awaiting_payment",
  "confirmed",
  "processing",
  "partially_fulfilled",
  "fulfilled",
  "cancelled",
  "returned",
]);

export const orderPaymentStatus = pgEnum("order_payment_status", [
  "unpaid",
  "pending",
  "paid",
  "partially_refunded",
  "refunded",
  "failed",
  "voided",
]);

export const fulfillmentStatusSummary = pgEnum("order_fulfillment_status", ["unfulfilled", "partially_fulfilled", "fulfilled", "returned", "partially_returned"]);

/** Per-store display number sequence (the internal id stays a UUID). */
export const orderNumberSequences = pgTable("order_number_sequences", {
  storeId: uuid()
    .primaryKey()
    .references(() => stores.id, { onDelete: "cascade" }),
  organizationId: uuid().notNull(),
  prefix: text().notNull().default(""),
  nextValue: integer().notNull().default(1001),
});

export const orders = pgTable(
  "orders",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    /** Customer-facing number, unique per store (e.g. 1001). */
    number: text().notNull(),
    cartId: uuid(),
    customerId: uuid().references(() => customers.id, { onDelete: "set null" }),
    email: text(),
    phone: text(),
    status: orderStatus().notNull().default("draft"),
    paymentStatus: orderPaymentStatus().notNull().default("unpaid"),
    fulfillmentStatus: fulfillmentStatusSummary().notNull().default("unfulfilled"),
    currency: char({ length: 3 }).notNull(),
    subtotal: bigint({ mode: "bigint" }).notNull(),
    discountTotal: bigint({ mode: "bigint" }).notNull(),
    shippingTotal: bigint({ mode: "bigint" }).notNull(),
    taxTotal: bigint({ mode: "bigint" }).notNull(),
    total: bigint({ mode: "bigint" }).notNull(),
    refundedTotal: bigint({ mode: "bigint" }).notNull().default(sql`0`),
    locale: text().notNull(),
    channelId: uuid(),
    note: text(),
    tags: text().array().notNull().default(sql`ARRAY[]::text[]`),
    /** Immutable attribution captured at checkout. */
    attribution: jsonb().$type<AttributionSnapshot>().notNull().default({}),
    couponCodes: text().array().notNull().default(sql`ARRAY[]::text[]`),
    shippingMethod: jsonb().$type<{ rateId: string; name: string; carrierCode: string | null; amount: string }>(),
    source: text().notNull().default("storefront"),
    placedAt: tstz(),
    confirmedAt: tstz(),
    cancelledAt: tstz(),
    cancelReason: text(),
    /** Customer-facing status token for the order status page (hash). */
    accessTokenHash: text(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("orders_store_number_uq").on(t.storeId, t.number),
    index("orders_store_created_idx").on(t.storeId, t.createdAt),
    index("orders_store_status_idx").on(t.storeId, t.status),
    index("orders_customer_idx").on(t.customerId),
    uniqueIndex("orders_cart_uq").on(t.cartId).where(sql`${t.cartId} is not null and ${t.status} <> 'cancelled'`),
  ],
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid(),
    variantId: uuid(),
    sku: text(),
    title: text().notNull(),
    variantTitle: text(),
    imageObjectKey: text(),
    quantity: integer().notNull(),
    unitPrice: bigint({ mode: "bigint" }).notNull(),
    compareAtUnitPrice: bigint({ mode: "bigint" }),
    /** Unit cost snapshot for profit reporting (Kârmatik). */
    unitCost: bigint({ mode: "bigint" }),
    discountAmount: bigint({ mode: "bigint" }).notNull().default(sql`0`),
    /** VAT rate in basis points; null when no tax class resolved (never stored as a guessed 0). */
    taxRateBps: integer(),
    taxAmount: bigint({ mode: "bigint" }).notNull().default(sql`0`),
    taxIncluded: boolean().notNull().default(true),
    total: bigint({ mode: "bigint" }).notNull(),
    requiresShipping: boolean().notNull().default(true),
    fulfilledQuantity: integer().notNull().default(0),
    returnedQuantity: integer().notNull().default(0),
    refundedQuantity: integer().notNull().default(0),
    properties: jsonb().$type<Record<string, string>>().notNull().default({}),
  },
  (t) => [index("order_lines_order_idx").on(t.orderId), index("order_lines_product_idx").on(t.productId), index("order_lines_variant_idx").on(t.variantId)],
);

export const orderAddresses = pgTable(
  "order_addresses",
  {
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    type: text().notNull(),
    address: jsonb().$type<PostalAddress>().notNull(),
  },
  (t) => [uniqueIndex("order_addresses_pk").on(t.orderId, t.type)],
);

export const orderAdjustments = pgTable(
  "order_adjustments",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    orderLineId: uuid(),
    type: text().notNull(),
    campaignId: uuid(),
    code: text(),
    amount: bigint({ mode: "bigint" }).notNull(),
    description: text().notNull(),
  },
  (t) => [index("order_adjustments_order_idx").on(t.orderId)],
);

export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    field: text().notNull(),
    fromValue: text(),
    toValue: text().notNull(),
    reason: text(),
    principalType: text(),
    principalId: uuid(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [index("order_status_history_order_idx").on(t.orderId, t.createdAt)],
);

export const fulfillmentState = pgEnum("fulfillment_state", ["pending", "in_progress", "shipped", "delivered", "cancelled"]);

export const fulfillments = pgTable(
  "fulfillments",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    locationId: uuid().references(() => inventoryLocations.id),
    status: fulfillmentState().notNull().default("pending"),
    carrierCode: text(),
    trackingNumber: text(),
    trackingUrl: text(),
    notifyCustomer: boolean().notNull().default(true),
    shippedAt: tstz(),
    deliveredAt: tstz(),
    cancelledAt: tstz(),
    ...timestamps,
  },
  (t) => [index("fulfillments_order_idx").on(t.orderId)],
);

export const fulfillmentLines = pgTable(
  "fulfillment_lines",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    fulfillmentId: uuid()
      .notNull()
      .references(() => fulfillments.id, { onDelete: "cascade" }),
    orderLineId: uuid()
      .notNull()
      .references(() => orderLines.id, { onDelete: "cascade" }),
    quantity: integer().notNull(),
  },
  (t) => [index("fulfillment_lines_fulfillment_idx").on(t.fulfillmentId)],
);

export const shipmentStatus = pgEnum("shipment_status", ["created", "label_ready", "in_transit", "delivered", "failed", "cancelled"]);

/** Carrier-side shipment created through a shipping adapter. */
export const shipments = pgTable(
  "shipments",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    fulfillmentId: uuid()
      .notNull()
      .references(() => fulfillments.id, { onDelete: "cascade" }),
    carrierCode: text().notNull(),
    providerShipmentId: text(),
    status: shipmentStatus().notNull().default("created"),
    trackingNumber: text(),
    trackingUrl: text(),
    labelAssetId: uuid(),
    lastEventAt: tstz(),
    rawStatus: text(),
    ...timestamps,
  },
  (t) => [index("shipments_fulfillment_idx").on(t.fulfillmentId), uniqueIndex("shipments_provider_uq").on(t.carrierCode, t.providerShipmentId)],
);

export const returnStatus = pgEnum("return_status", ["requested", "approved", "rejected", "received", "refunded", "cancelled"]);

export const returnRequests = pgTable(
  "return_requests",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    status: returnStatus().notNull().default("requested"),
    reason: text(),
    customerNote: text(),
    restockLocationId: uuid(),
    receivedAt: tstz(),
    ...timestamps,
  },
  (t) => [index("return_requests_order_idx").on(t.orderId)],
);

export const returnLines = pgTable(
  "return_lines",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    returnId: uuid()
      .notNull()
      .references(() => returnRequests.id, { onDelete: "cascade" }),
    orderLineId: uuid()
      .notNull()
      .references(() => orderLines.id, { onDelete: "cascade" }),
    quantity: integer().notNull(),
    reason: text(),
    restock: boolean().notNull().default(true),
  },
  (t) => [index("return_lines_return_idx").on(t.returnId)],
);

export const refundStatus = pgEnum("refund_status", ["pending", "succeeded", "failed"]);

export const refunds = pgTable(
  "refunds",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    paymentAttemptId: uuid(),
    returnId: uuid(),
    amount: bigint({ mode: "bigint" }).notNull(),
    shippingAmount: bigint({ mode: "bigint" }).notNull().default(sql`0`),
    currency: char({ length: 3 }).notNull(),
    reason: text(),
    lines: jsonb().$type<{ orderLineId: string; quantity: number; amount: string }[]>().notNull().default([]),
    status: refundStatus().notNull().default("pending"),
    providerRefundId: text(),
    failureReason: text(),
    idempotencyKey: text().notNull(),
    createdByPrincipalId: uuid(),
    processedAt: tstz(),
    ...timestamps,
  },
  (t) => [index("refunds_order_idx").on(t.orderId), uniqueIndex("refunds_idempotency_uq").on(t.storeId, t.idempotencyKey)],
);
