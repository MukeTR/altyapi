import { sql } from "drizzle-orm";
import { bigint, char, index, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamps, tstz } from "./_shared";
import { stores } from "./tenancy";
import { orders } from "./orders";

export const paymentProvider = pgEnum("payment_provider", ["paytr", "iyzico"]);
export const paymentMode = pgEnum("payment_mode", ["test", "live"]);
export const connectionStatus = pgEnum("payment_connection_status", ["active", "disabled", "error"]);

/**
 * Merchant-owned provider credentials. Values are envelope-encrypted: a data key encrypted
 * by KMS (or the local master key in development) encrypts the credential JSON with
 * AES-256-GCM. Plaintext credentials never touch this table.
 */
export const paymentProviderConnections = pgTable(
  "payment_provider_connections",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    provider: paymentProvider().notNull(),
    mode: paymentMode().notNull(),
    status: connectionStatus().notNull().default("active"),
    /** AES-GCM ciphertext (base64) of the credential JSON. */
    ciphertext: text().notNull(),
    iv: text().notNull(),
    authTag: text().notNull(),
    /** Data key encrypted by the key-encryption key (KMS CiphertextBlob / local wrap), base64. */
    encryptedDataKey: text().notNull(),
    keyId: text().notNull(),
    /** Non-secret display hint, e.g. merchant id suffix. */
    displayHint: text(),
    priority: bigint({ mode: "number" }).notNull().default(0),
    lastVerifiedAt: tstz(),
    lastError: text(),
    ...timestamps,
  },
  (t) => [uniqueIndex("payment_connections_store_provider_uq").on(t.storeId, t.provider), index("payment_connections_store_idx").on(t.storeId)],
);

export const paymentStatus = pgEnum("payment_status", [
  "created",
  "session_created",
  "pending",
  "requires_action",
  "paid",
  "failed",
  "cancelled",
  "partially_refunded",
  "refunded",
]);

export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    connectionId: uuid().notNull(),
    provider: paymentProvider().notNull(),
    mode: paymentMode().notNull(),
    status: paymentStatus().notNull().default("created"),
    amount: bigint({ mode: "bigint" }).notNull(),
    currency: char({ length: 3 }).notNull(),
    refundedAmount: bigint({ mode: "bigint" }).notNull().default(sql`0`),
    idempotencyKey: text().notNull(),
    /** Reference sent to the provider (PayTR merchant_oid / iyzico conversationId). */
    providerReference: text().notNull(),
    /** Provider-side payment id once known (iyzico paymentId, PayTR has none). */
    providerPaymentId: text(),
    sessionToken: text(),
    sessionExpiresAt: tstz(),
    /** Non-secret session data for the client (iframe URL, checkout form content). */
    clientData: jsonb().$type<Record<string, unknown>>(),
    failureCode: text(),
    failureMessage: text(),
    paidAt: tstz(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("payment_attempts_idempotency_uq").on(t.storeId, t.idempotencyKey),
    uniqueIndex("payment_attempts_reference_uq").on(t.provider, t.providerReference),
    index("payment_attempts_order_idx").on(t.orderId),
  ],
);

/** Every provider notification, verified or not, deduplicated by event id and payload hash. */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid().primaryKey(),
    organizationId: uuid(),
    storeId: uuid(),
    paymentAttemptId: uuid(),
    provider: paymentProvider().notNull(),
    providerEventId: text().notNull(),
    payloadHash: text().notNull(),
    type: text().notNull(),
    verified: text().notNull(),
    /** Redacted payload (no card data, no secrets). */
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    processingResult: text(),
    receivedAt: tstz().notNull().defaultNow(),
    processedAt: tstz(),
  },
  (t) => [
    uniqueIndex("payment_events_provider_event_uq").on(t.provider, t.providerEventId),
    uniqueIndex("payment_events_payload_uq").on(t.provider, t.payloadHash),
    index("payment_events_attempt_idx").on(t.paymentAttemptId),
  ],
);

export const transactionType = pgEnum("payment_transaction_type", ["sale", "refund", "void"]);

export const paymentTransactions = pgTable(
  "payment_transactions",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    paymentAttemptId: uuid()
      .notNull()
      .references(() => paymentAttempts.id, { onDelete: "cascade" }),
    type: transactionType().notNull(),
    status: text().notNull(),
    amount: bigint({ mode: "bigint" }).notNull(),
    currency: char({ length: 3 }).notNull(),
    providerTransactionId: text(),
    /** Provider fee/commission if reported (used for profit calculations). */
    feeAmount: bigint({ mode: "bigint" }),
    rawStatus: text(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [index("payment_transactions_attempt_idx").on(t.paymentAttemptId)],
);
