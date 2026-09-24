import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamps } from "./_shared";
import { contentAssets } from "./storage";
import type { LocalizedText } from "./storefront";
import { stores } from "./tenancy";

/**
 * Site core (docs/platform/site-turleri-ve-cms.md §1, K3, K6): what kind of site a store is,
 * which capability modules are on, and the business identity and locations every site type
 * publishes (imprint, contact facts, opening hours, JSON-LD organization). Runtime code never
 * branches on the site kind or pack name; it reads site_modules (and later the compiled policy
 * snapshot). Changing kind, packs or modules is a data change, not a migration.
 */

/** Preset that seeds default modules and templates; informational after onboarding. */
export const siteKind = pgEnum("site_kind", ["static", "corporate", "service", "ecommerce", "hybrid"]);

/** prefixed: pages live under /pages/{handle}; root: pages are served at /{handle} (and /pages/* 301s there). */
export const pageUrlStyle = pgEnum("page_url_style", ["prefixed", "root"]);

/**
 * What a request for a language the record has no content in gets.
 * hide: 404 and no hreflang; fallback_noindex: default-language content marked noindex.
 */
export const untranslatedPolicy = pgEnum("untranslated_policy", ["hide", "fallback_noindex"]);

/**
 * enabled / disabled: the merchant's choice. locked_on / locked_off: fixed by a pack or the
 * policy; the merchant cannot flip them. A feature runs only when its module is enabled or
 * locked_on (and the platform flag, entitlement and policy allow it).
 */
export const siteModuleStatus = pgEnum("site_module_status", ["enabled", "disabled", "locked_on", "locked_off"]);

/** Who set the module row last: the site-kind preset, a vertical pack, the merchant or the policy. */
export const siteModuleSource = pgEnum("site_module_source", ["preset", "pack", "merchant", "policy"]);

/** Legal form of the business (Turkish registry categories). */
export const businessLegalForm = pgEnum("business_legal_form", [
  "sahis",
  "limited",
  "anonim",
  "kooperatif",
  "dernek",
  "vakif",
  "kamu",
  "diger",
]);

export const siteLocationStatus = pgEnum("site_location_status", ["active", "hidden"]);

/**
 * Preferences for AI crawlers in robots.txt and the Content-Signal line. Search and answer
 * bots and agents acting for a user are always allowed; training crawlers (GPTBot,
 * Google-Extended, CCBot, …) follow the merchant's choice and are denied by default.
 */
export interface AiCrawlerPreferences {
  training: "allow" | "deny";
}

export type SiteVerificationProvider = "google" | "bing" | "yandex" | "pinterest" | "facebook";

/** Search console / platform ownership tokens rendered as <meta name="…-site-verification">. */
export type SiteVerificationMeta = Partial<Record<SiteVerificationProvider, string>>;

/**
 * One row per store. Seeded by the site-kind preset at store creation (and by the Faz 1
 * migration for stores that existed before, as `ecommerce`).
 */
export const siteProfiles = pgTable("site_profiles", {
  storeId: uuid()
    .primaryKey()
    .references(() => stores.id, { onDelete: "cascade" }),
  organizationId: uuid().notNull(),
  kind: siteKind().notNull(),
  /** Pinned release of the primary vertical pack ("hukuk.avukat@1.4.0"); null = platform baseline. */
  primaryPack: text(),
  /** Pinned add-on pack releases, same notation as primaryPack. */
  addonPacks: text().array().notNull().default(sql`ARRAY[]::text[]`),
  pageUrlStyle: pageUrlStyle().notNull().default("prefixed"),
  untranslatedPolicy: untranslatedPolicy().notNull().default("hide"),
  aiCrawlers: jsonb().$type<AiCrawlerPreferences>().notNull().default({ training: "deny" }),
  verificationMeta: jsonb().$type<SiteVerificationMeta>().notNull().default({}),
  ...timestamps,
});

/**
 * Capability module state per store. A missing row means the module is off. Module keys come
 * from the module registry (packages/site); settings are validated by the module's manifest.
 */
export const siteModules = pgTable(
  "site_modules",
  {
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    organizationId: uuid().notNull(),
    moduleKey: text().notNull(),
    status: siteModuleStatus().notNull(),
    settings: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    source: siteModuleSource().notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.moduleKey] }),
    check("site_modules_key_format", sql`${t.moduleKey} ~ '^[a-z][a-z0-9_-]{0,63}$'`),
  ],
);

/** Postal address of a business or location. Turkish terms; for foreign addresses il is the city. */
export interface SiteAddress {
  /** Street, building and door number ("Bağdat Cad. No:12 D:3"). */
  street: string;
  /** Neighbourhood (mahalle). */
  mahalle?: string | null;
  /** District (ilçe). */
  ilce?: string | null;
  /** Province (il). */
  il: string;
  postalCode?: string | null;
  /** ISO 3166-1 alpha-2. */
  country: string;
}

/** Registry and trade identifiers beyond the Turkish tax/MERSİS numbers. */
export interface BusinessIdentifiers {
  /** NACE Rev.2 activity codes, primary first (from the tax certificate or onboarding). */
  nace?: string[];
  duns?: string;
  gln?: string;
  lei?: string;
  /** VAT id of a foreign establishment. */
  vatId?: string;
  eori?: string;
}

/**
 * The legal and public identity of the business behind a site (K3): imprint (6563 m.3 künye),
 * statutory info, contact facts and the JSON-LD #organization node. Fields are nullable so the
 * onboarding wizard can save step by step; completeness is checked where it is required
 * (statutory-info rendering, identity.require rules).
 */
export const businessIdentities = pgTable("business_identities", {
  storeId: uuid()
    .primaryKey()
    .references(() => stores.id, { onDelete: "cascade" }),
  organizationId: uuid().notNull(),
  /** Registered name (ticaret unvanı, or the owner's full name for a sole proprietor). */
  legalName: text(),
  /** Name the business trades and is known under (brand / signboard). */
  tradeName: text(),
  legalForm: businessLegalForm(),
  mersisNo: text(),
  tradeRegistryNo: text(),
  taxOffice: text(),
  /** VKN, or for a sole proprietor the TCKN, which is personal data: public only when taxNumberPublic. */
  taxNumber: text(),
  taxNumberPublic: boolean().notNull().default(false),
  /** Registered e-mail (KEP) address. */
  kepAddress: text(),
  /** Chamber or professional body the business belongs to (oda, baro, TÜRMOB…). */
  chamber: text(),
  /** Where the professional rules of that body can be read (6563 m.3 for regulated professions). */
  chamberRulesUrl: text(),
  /** E.164. */
  phone: text(),
  email: text(),
  address: jsonb().$type<SiteAddress>(),
  foundingDate: date({ mode: "string" }),
  logoAssetId: uuid().references(() => contentAssets.id, { onDelete: "set null" }),
  description: jsonb().$type<LocalizedText>().notNull().default({}),
  /** Official social and directory profile URLs (schema.org sameAs). */
  sameAs: text().array().notNull().default(sql`ARRAY[]::text[]`),
  identifiers: jsonb().$type<BusinessIdentifiers>().notNull().default({}),
  updatedByPrincipalId: uuid(),
  ...timestamps,
});

export interface GeoPoint {
  lat: number;
  lng: number;
  /** Shown as an area rather than a pin (home-based businesses); JSON-LD omits the exact point. */
  approximate: boolean;
}

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/** A weekly opening interval (schema.org OpeningHoursSpecification). Times are HH:MM in the store timezone; closes < opens means past midnight. */
export interface OpeningHoursRow {
  days: Weekday[];
  opens: string;
  closes: string;
}

/** Holiday or exceptional hours for an inclusive date range (YYYY-MM-DD). */
export interface SpecialOpeningDay {
  from: string;
  to: string;
  closed: boolean;
  /** Intervals when open; empty when closed. */
  hours: { opens: string; closes: string }[];
  label?: LocalizedText;
}

export interface OpeningHours {
  weekly: OpeningHoursRow[];
  specialDays: SpecialOpeningDay[];
  /** Visits only by appointment ("randevu ile"), with or without regular hours. */
  byAppointment: boolean;
  note?: LocalizedText;
}

/** Where a service-area business works; null on a location means it serves at its address. */
export interface ServiceArea {
  places: { il: string; ilce?: string | null }[];
  /** Radius around the location's geo point. */
  radiusKm?: number | null;
  /** ISO 3166-1 alpha-2 countries served as a whole. */
  countries?: string[];
}

/** Branches, offices and service points of the business (NAP, hours, map). */
export const siteLocations = pgTable(
  "site_locations",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    name: jsonb().$type<LocalizedText>().notNull(),
    slug: text().notNull(),
    /** Null for a service-area business that does not publish an address. */
    address: jsonb().$type<SiteAddress>(),
    geo: jsonb().$type<GeoPoint>(),
    /** E.164. */
    phone: text(),
    email: text(),
    /** E.164 number reachable on WhatsApp. */
    whatsapp: text(),
    openingHours: jsonb().$type<OpeningHours>().notNull().default({ weekly: [], specialDays: [], byAppointment: false }),
    serviceArea: jsonb().$type<ServiceArea>(),
    isPrimary: boolean().notNull().default(false),
    position: integer().notNull().default(0),
    status: siteLocationStatus().notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("site_locations_store_slug_uq").on(t.storeId, t.slug),
    uniqueIndex("site_locations_primary_uq").on(t.storeId).where(sql`${t.isPrimary}`),
    index("site_locations_store_position_idx").on(t.storeId, t.position),
  ],
);
