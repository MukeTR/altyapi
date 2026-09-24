import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  char,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { timestamps, tstz } from "./_shared";
import { users } from "./identity";

export const organizations = pgTable(
  "organizations",
  {
    id: uuid().primaryKey(),
    slug: text().notNull(),
    name: text().notNull(),
    createdByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("organizations_slug_uq").on(t.slug)],
);

export const memberStatus = pgEnum("member_status", ["invited", "active", "suspended"]);

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid().primaryKey(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid().references(() => users.id, { onDelete: "cascade" }),
    /** Invitations are addressed by email until accepted and bound to a user. */
    invitedEmail: text(),
    status: memberStatus().notNull().default("active"),
    invitedByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    inviteExpiresAt: tstz(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("organization_members_org_user_uq")
      .on(t.organizationId, t.userId)
      .where(sql`${t.userId} is not null`),
    uniqueIndex("organization_members_org_email_uq")
      .on(t.organizationId, t.invitedEmail)
      .where(sql`${t.invitedEmail} is not null`),
    index("organization_members_user_idx").on(t.userId),
  ],
);

export const roleName = pgEnum("role_name", [
  "organization_owner",
  "store_admin",
  "catalog_manager",
  "order_manager",
  "marketing_manager",
  "analyst",
  "developer",
]);

/**
 * A member may hold several roles. store_id null means the role applies to every store
 * in the organization; otherwise it is limited to that store.
 */
export const roleAssignments = pgTable(
  "role_assignments",
  {
    id: uuid().primaryKey(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    memberId: uuid()
      .notNull()
      .references(() => organizationMembers.id, { onDelete: "cascade" }),
    storeId: uuid().references(() => stores.id, { onDelete: "cascade" }),
    role: roleName().notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("role_assignments_uq").on(t.memberId, t.role, sql`coalesce(${t.storeId}, '00000000-0000-0000-0000-000000000000'::uuid)`),
    index("role_assignments_org_idx").on(t.organizationId),
  ],
);

export const storeStatus = pgEnum("store_status", ["setup", "active", "paused", "closed"]);

export const stores = pgTable(
  "stores",
  {
    id: uuid().primaryKey(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    /** Globally unique; forms the default hostname {slug}.altyapi.store. */
    slug: text().notNull(),
    name: text().notNull(),
    status: storeStatus().notNull().default("setup"),
    defaultLocale: text().notNull().default("tr"),
    supportedLocales: text().array().notNull().default(sql`ARRAY['tr']::text[]`),
    defaultCurrency: char({ length: 3 }).notNull().default("TRY"),
    supportedCurrencies: text().array().notNull().default(sql`ARRAY['TRY']::text[]`),
    timezone: text().notNull().default("Europe/Istanbul"),
    countryCode: char({ length: 2 }).notNull().default("TR"),
    contactEmail: text(),
    settings: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /**
     * Incremented whenever routing-relevant data (domains, status, canonical host) changes.
     * The edge router keys its cache on this so stale mappings are invalidated by version.
     */
    routingVersion: integer().notNull().default(1),
    /** Incremented on theme/page publish and catalog changes; storefront cache keys include it. */
    contentVersion: integer().notNull().default(1),
    /** Incremented whenever site_modules or the site profile change; module gates cache on it. */
    modulesVersion: integer().notNull().default(1),
    /** Incremented whenever the compiled site policy changes; policy checks cache on it. */
    policyVersion: integer().notNull().default(1),
    ...timestamps,
  },
  (t) => [uniqueIndex("stores_slug_uq").on(t.slug), index("stores_org_idx").on(t.organizationId)],
);

export const channelType = pgEnum("channel_type", ["online_store", "marketplace", "social", "pos", "api"]);

export const channels = pgTable(
  "channels",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    type: channelType().notNull(),
    handle: text().notNull(),
    name: text().notNull(),
    currency: char({ length: 3 }).notNull(),
    isDefault: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex("channels_store_handle_uq").on(t.storeId, t.handle), index("channels_store_idx").on(t.storeId)],
);
