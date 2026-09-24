import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid, integer } from "drizzle-orm/pg-core";
import { timestamps, tstz } from "./_shared";
import { stores } from "./tenancy";

export const domainStatus = pgEnum("domain_status", [
  "pending",
  "awaiting_dns",
  "validating",
  "certificate_pending",
  "active",
  "failed",
  "moved",
  "disabled",
]);

export const domainKind = pgEnum("domain_kind", ["platform_subdomain", "custom"]);

export interface DnsInstruction {
  type: "CNAME" | "TXT" | "A" | "AAAA";
  name: string;
  value: string;
  purpose: "routing" | "ownership_verification" | "ssl_validation" | "apex_redirect";
}

/**
 * Hostname → store mapping. PostgreSQL is the source of truth; the edge router only
 * caches a projection of active rows keyed by the store's routing_version.
 */
export const storeDomains = pgTable(
  "store_domains",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    /** Lowercased, punycode-normalized hostname without port or trailing dot. */
    hostname: text().notNull(),
    kind: domainKind().notNull(),
    status: domainStatus().notNull().default("pending"),
    isCanonical: boolean().notNull().default(false),
    /** When set, requests to this hostname redirect (301) to redirectTarget instead of rendering. */
    redirectToHostname: text(),
    /** The apex domain that should redirect to this www hostname (first product behavior). */
    apexHostname: text(),
    cloudflareCustomHostnameId: text(),
    sslStatus: text(),
    verificationStatus: text(),
    dnsInstructions: jsonb().$type<DnsInstruction[]>().notNull().default([]),
    verificationErrors: jsonb().$type<string[]>().notNull().default([]),
    failureReason: text(),
    checkAttempts: integer().notNull().default(0),
    nextCheckAt: tstz(),
    lastCheckedAt: tstz(),
    activatedAt: tstz(),
    disabledAt: tstz(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("store_domains_hostname_uq").on(t.hostname).where(sql`${t.status} <> 'moved'`),
    uniqueIndex("store_domains_one_canonical_uq").on(t.storeId).where(sql`${t.isCanonical}`),
    index("store_domains_store_idx").on(t.storeId),
    index("store_domains_next_check_idx").on(t.nextCheckAt).where(sql`${t.nextCheckAt} is not null`),
  ],
);
