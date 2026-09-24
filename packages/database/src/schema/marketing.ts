import { sql } from "drizzle-orm";
import { index, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamps, tstz } from "./_shared";
import { stores } from "./tenancy";
import { customers } from "./customers";

export const channelConsentStatus = pgEnum("channel_consent_status", ["subscribed", "unsubscribed", "pending", "bounced", "not_set"]);

/**
 * Marketing reachability per store (e-mail/SMS/WhatsApp). Turkish commercial e-message
 * consents must also be registered with İYS; iys_status tracks that synchronization.
 */
export const marketingContacts = pgTable(
  "marketing_contacts",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    email: text(),
    phone: text(),
    customerId: uuid().references(() => customers.id, { onDelete: "set null" }),
    locale: text(),
    emailStatus: channelConsentStatus().notNull().default("not_set"),
    smsStatus: channelConsentStatus().notNull().default("not_set"),
    whatsappStatus: channelConsentStatus().notNull().default("not_set"),
    source: text(),
    emailSubscribedAt: tstz(),
    emailUnsubscribedAt: tstz(),
    iysStatus: text().notNull().default("not_required"),
    iysSyncedAt: tstz(),
    tags: text().array().notNull().default(sql`ARRAY[]::text[]`),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("marketing_contacts_store_email_uq").on(t.storeId, sql`lower(${t.email})`).where(sql`${t.email} is not null`),
    uniqueIndex("marketing_contacts_store_phone_uq").on(t.storeId, t.phone).where(sql`${t.phone} is not null`),
    index("marketing_contacts_customer_idx").on(t.customerId),
  ],
);

export const consentSubjectType = pgEnum("consent_subject_type", ["anonymous", "customer", "contact"]);

/** Consent categories used by the cookie banner and script loading. */
export interface ConsentCategories {
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  personalization: boolean;
}

/**
 * Append-only consent evidence: what was shown (text snapshot + policy version), what was
 * chosen, where and when. The IP is stored only as a keyed hash.
 */
export const consentRecords = pgTable(
  "consent_records",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    subjectType: consentSubjectType().notNull(),
    subjectId: text().notNull(),
    purpose: text().notNull(),
    categories: jsonb().$type<Partial<ConsentCategories> & Record<string, boolean>>().notNull(),
    policyVersion: text().notNull(),
    textSnapshot: text(),
    source: text().notNull(),
    ipHash: text(),
    userAgent: text(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [index("consent_records_subject_idx").on(t.storeId, t.subjectType, t.subjectId, t.createdAt)],
);
