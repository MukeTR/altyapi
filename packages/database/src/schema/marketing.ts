import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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

export interface TrackingSecretsEnvelope {
  ciphertext: string;
  iv: string;
  authTag: string;
  encryptedDataKey: string;
  keyId: string;
}

/**
 * Protected tracking layer (pixels, analytics, conversion APIs). Deliberately separate from
 * themes and pages: design edits, publishes and rollbacks can never change it.
 */
export const trackingConfigs = pgTable("tracking_configs", {
  storeId: uuid()
    .primaryKey()
    .references(() => stores.id, { onDelete: "cascade" }),
  organizationId: uuid().notNull(),
  gtmContainerId: text(),
  ga4MeasurementId: text(),
  googleAdsConversionId: text(),
  googleAdsPurchaseLabel: text(),
  metaPixelId: text(),
  tiktokPixelId: text(),
  metaCapiEnabled: boolean().notNull().default(false),
  tiktokEventsApiEnabled: boolean().notNull().default(false),
  ga4MeasurementProtocolEnabled: boolean().notNull().default(false),
  /** Encrypted server-side credentials (Meta CAPI token, TikTok access token, GA4 API secret). */
  secrets: jsonb().$type<TrackingSecretsEnvelope>(),
  /** Consent policy version; changing it re-asks every visitor. */
  consentPolicyVersion: text().notNull().default("1"),
  version: integer().notNull().default(1),
  updatedByPrincipalId: uuid(),
  ...timestamps,
});

export const conversionDeliveryStatus = pgEnum("conversion_delivery_status", ["sent", "failed", "skipped"]);

/** Server-side conversion sends; powers the pixel health view and guarantees single delivery. */
export const conversionDeliveries = pgTable(
  "conversion_deliveries",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    destination: text().notNull(),
    eventName: text().notNull(),
    eventId: text().notNull(),
    orderId: uuid(),
    status: conversionDeliveryStatus().notNull(),
    httpStatus: integer(),
    message: text(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("conversion_deliveries_uq").on(t.storeId, t.destination, t.eventId),
    index("conversion_deliveries_store_idx").on(t.storeId, t.createdAt),
  ],
);
