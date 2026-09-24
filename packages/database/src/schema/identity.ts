import { index, pgEnum, pgTable, text, uniqueIndex, uuid, inet, jsonb } from "drizzle-orm/pg-core";
import { timestamps, tstz } from "./_shared";

/**
 * Merchant/staff accounts. Storefront customers live in a separate table (customers)
 * scoped to a store; the two identity systems never share credentials or sessions.
 */
export const users = pgTable(
  "users",
  {
    id: uuid().primaryKey(),
    email: text().notNull(),
    name: text().notNull(),
    passwordHash: text(),
    locale: text().notNull().default("tr"),
    emailVerifiedAt: tstz(),
    disabledAt: tstz(),
    lastLoginAt: tstz(),
    ...timestamps,
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const userSessions = pgTable(
  "user_sessions",
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the opaque session token; the raw token only exists in the cookie. */
    tokenHash: text().notNull(),
    ip: inet(),
    userAgent: text(),
    expiresAt: tstz().notNull(),
    revokedAt: tstz(),
    lastSeenAt: tstz().notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [uniqueIndex("user_sessions_token_hash_uq").on(t.tokenHash), index("user_sessions_user_idx").on(t.userId)],
);

export const agentKind = pgEnum("agent_kind", ["panel_assistant", "mcp_client", "automation"]);

/**
 * AI agents are principals in their own right. Every action an agent performs is recorded
 * with the agent id and, separately, the human user on whose behalf it acted.
 */
export const agentPrincipals = pgTable(
  "agent_principals",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    kind: agentKind().notNull(),
    name: text().notNull(),
    /** For MCP clients: the OAuth client id; for the panel assistant: the provider/model family. */
    externalRef: text(),
    actingUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    revokedAt: tstz(),
    ...timestamps,
  },
  (t) => [index("agent_principals_org_idx").on(t.organizationId)],
);
