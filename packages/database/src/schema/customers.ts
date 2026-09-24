import { sql } from "drizzle-orm";
import { bigint, boolean, index, inet, integer, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamps, tstz } from "./_shared";
import { stores } from "./tenancy";

export interface PostalAddress {
  firstName: string;
  lastName: string;
  company?: string | null;
  line1: string;
  line2?: string | null;
  district?: string | null;
  city: string;
  province?: string | null;
  postalCode?: string | null;
  countryCode: string;
  phone?: string | null;
  /** Turkish e-invoice fields. */
  identityNumber?: string | null;
  taxNumber?: string | null;
  taxOffice?: string | null;
}

/**
 * Storefront customers, scoped to a single store. This identity is separate from
 * merchant/staff users: different table, sessions and credentials.
 */
export const customers = pgTable(
  "customers",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    email: text(),
    phone: text(),
    firstName: text(),
    lastName: text(),
    locale: text(),
    /** Null for guest customers created from checkout. */
    passwordHash: text(),
    emailVerifiedAt: tstz(),
    isGuest: boolean().notNull().default(true),
    tags: text().array().notNull().default(sql`ARRAY[]::text[]`),
    note: text(),
    defaultAddress: jsonb().$type<PostalAddress>(),
    // Denormalized stats maintained by order events; used by segments.
    ordersCount: integer().notNull().default(0),
    totalSpentMinor: bigint({ mode: "bigint" }).notNull().default(sql`0`),
    totalSpentCurrency: text(),
    firstOrderAt: tstz(),
    lastOrderAt: tstz(),
    disabledAt: tstz(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("customers_store_email_uq").on(t.storeId, sql`lower(${t.email})`).where(sql`${t.email} is not null`),
    index("customers_store_created_idx").on(t.storeId, t.createdAt),
  ],
);

export const customerAddresses = pgTable(
  "customer_addresses",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    address: jsonb().$type<PostalAddress>().notNull(),
    isDefaultShipping: boolean().notNull().default(false),
    isDefaultBilling: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [index("customer_addresses_customer_idx").on(t.customerId)],
);

export const customerSessions = pgTable(
  "customer_sessions",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    tokenHash: text().notNull(),
    ip: inet(),
    userAgent: text(),
    expiresAt: tstz().notNull(),
    revokedAt: tstz(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [uniqueIndex("customer_sessions_token_uq").on(t.tokenHash), index("customer_sessions_customer_idx").on(t.customerId)],
);

export const customerGroups = pgTable(
  "customer_groups",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    name: text().notNull(),
    handle: text().notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("customer_groups_store_handle_uq").on(t.storeId, t.handle)],
);

export const customerGroupMembers = pgTable(
  "customer_group_members",
  {
    groupId: uuid()
      .notNull()
      .references(() => customerGroups.id, { onDelete: "cascade" }),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    storeId: uuid().notNull(),
    organizationId: uuid().notNull(),
    addedAt: tstz().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.customerId] }), index("customer_group_members_customer_idx").on(t.customerId)],
);
