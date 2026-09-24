import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tstz } from "./_shared";

export const outboxStatus = pgEnum("outbox_status", ["pending", "published", "failed"]);

/**
 * Transactional outbox. Domain services insert events in the same transaction as the
 * state change; the publisher moves them to the queue. Consumers dedupe on event id.
 */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid().primaryKey(),
    type: text().notNull(),
    version: integer().notNull().default(1),
    organizationId: uuid(),
    storeId: uuid(),
    aggregateType: text().notNull(),
    aggregateId: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    correlationId: text().notNull(),
    causationId: text(),
    principalType: text(),
    principalId: uuid(),
    occurredAt: tstz().notNull().defaultNow(),
    status: outboxStatus().notNull().default("pending"),
    attempts: integer().notNull().default(0),
    availableAt: tstz().notNull().defaultNow(),
    publishedAt: tstz(),
    lastError: text(),
  },
  (t) => [
    index("outbox_events_pending_idx").on(t.availableAt).where(sql`${t.status} = 'pending'`),
    index("outbox_events_store_idx").on(t.storeId, t.occurredAt),
  ],
);

/**
 * Consumer-side idempotency: a (consumer, message) pair is processed at most once even
 * when the queue redelivers.
 */
export const processedMessages = pgTable(
  "processed_messages",
  {
    consumer: text().notNull(),
    messageId: text().notNull(),
    processedAt: tstz().notNull().defaultNow(),
  },
  (t) => [uniqueIndex("processed_messages_pk").on(t.consumer, t.messageId)],
);

export const jobStatus = pgEnum("job_status", ["queued", "running", "succeeded", "failed", "dead"]);

/**
 * Queue table used by the "postgres" queue driver (local development and small deployments).
 * In production the SQS driver is used and this table stays empty.
 */
export const queueMessages = pgTable(
  "queue_messages",
  {
    id: uuid().primaryKey(),
    queue: text().notNull(),
    body: jsonb().$type<Record<string, unknown>>().notNull(),
    status: jobStatus().notNull().default("queued"),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(8),
    availableAt: tstz().notNull().defaultNow(),
    lockedUntil: tstz(),
    lastError: text(),
    createdAt: tstz().notNull().defaultNow(),
    finishedAt: tstz(),
  },
  (t) => [index("queue_messages_ready_idx").on(t.queue, t.availableAt).where(sql`${t.status} = 'queued'`)],
);
