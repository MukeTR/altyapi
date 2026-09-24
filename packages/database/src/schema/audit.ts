import { index, inet, jsonb, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { tstz } from "./_shared";

export const principalType = pgEnum("principal_type", ["user", "agent", "customer", "system", "api_client"]);

/**
 * Append-only audit trail. Changes are stored as redacted before/after snapshots;
 * secrets, tokens, card data and sensitive personal data are never written here.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid().primaryKey(),
    occurredAt: tstz().notNull().defaultNow(),
    organizationId: uuid(),
    storeId: uuid(),
    principalType: principalType().notNull(),
    principalId: uuid(),
    /** The human on whose behalf an agent acted; null for direct human actions. */
    onBehalfOfUserId: uuid(),
    agentId: uuid(),
    sessionId: uuid(),
    correlationId: text().notNull(),
    requestId: text(),
    actionId: uuid(),
    action: text().notNull(),
    resourceType: text().notNull(),
    resourceId: text(),
    changes: jsonb().$type<{ before?: unknown; after?: unknown }>(),
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ip: inet(),
  },
  (t) => [
    index("audit_log_store_time_idx").on(t.storeId, t.occurredAt),
    index("audit_log_org_time_idx").on(t.organizationId, t.occurredAt),
    index("audit_log_resource_idx").on(t.resourceType, t.resourceId),
  ],
);
