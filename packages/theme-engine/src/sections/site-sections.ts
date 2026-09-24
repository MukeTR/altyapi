import { z } from "zod";
import { localized } from "./primitives";
import { CONTENT_PAGES, ENTRY_TEMPLATES } from "./placements";
import type { SectionDefinition } from "./types";

/**
 * Business identity sections (K3): the imprint, facts, opening hours and locations every site
 * type publishes, bound to business_identities and site_locations on the server. They belong
 * to the site core and may sit in the global footer as well as on pages.
 */

/** Identity facts the business-facts section can show, in display order. */
export const BUSINESS_FACTS = [
  "tradeName",
  "legalName",
  "legalForm",
  "foundingDate",
  "address",
  "phone",
  "email",
  "kepAddress",
  "chamber",
  "mersisNo",
  "tradeRegistryNo",
  "taxOffice",
  "naceCodes",
  "locationCount",
  "sameAs",
] as const;
export type BusinessFact = (typeof BUSINESS_FACTS)[number];

/** Map services a location links out to; no map script or frame is ever loaded on the page. */
export const MAP_PROVIDERS = ["google", "apple", "yandex", "openstreetmap"] as const;
export type MapProvider = (typeof MAP_PROVIDERS)[number];

const SITE_PLACEMENTS: SectionDefinition["allowedIn"] = [...CONTENT_PAGES, ...ENTRY_TEMPLATES, "global"];

export const SITE_SECTION_DEFINITIONS: SectionDefinition[] = [
  {
    type: "statutory-info",
    version: 1,
    name: { tr: "Künye", en: "Imprint" },
    category: "business",
    module: "core",
    policyTags: [],
    propTags: {},
    props: z.object({
      /** Defaults to "Künye" / "Imprint" in the page language. */
      heading: localized(120),
      layout: z.enum(["list", "compact"]).default("list"),
      showLogo: z.boolean().default(false),
    }),
    contentBindings: ["business_identity"],
    allowedIn: SITE_PLACEMENTS,
    renderer: "builtin:statutory-info@1",
    singleton: true,
  },
  {
    type: "business-facts",
    version: 1,
    name: { tr: "İşletme bilgileri", en: "Business facts" },
    category: "business",
    module: "core",
    policyTags: [],
    propTags: {},
    props: z.object({
      heading: localized(120),
      facts: z
        .array(z.enum(BUSINESS_FACTS))
        .min(1)
        .max(BUSINESS_FACTS.length)
        .refine((f) => new Set(f).size === f.length, "errors.section.duplicate_item")
        .default(["tradeName", "foundingDate", "address", "phone", "email"]),
      layout: z.enum(["grid", "list"]).default("grid"),
    }),
    contentBindings: ["business_identity", "locations"],
    allowedIn: SITE_PLACEMENTS,
    renderer: "builtin:business-facts@1",
  },
  {
    type: "opening-hours",
    version: 1,
    name: { tr: "Çalışma saatleri", en: "Opening hours" },
    category: "business",
    module: "core",
    policyTags: [],
    propTags: {},
    props: z.object({
      heading: localized(120),
      /** Location whose hours are shown; null = the primary location. */
      locationId: z.uuid().nullable().default(null),
      showSpecialDays: z.boolean().default(true),
      showNote: z.boolean().default(true),
    }),
    contentBindings: ["locations"],
    allowedIn: SITE_PLACEMENTS,
    renderer: "builtin:opening-hours@1",
  },
  {
    type: "locations-map",
    version: 1,
    name: { tr: "Lokasyonlar", en: "Locations" },
    category: "business",
    module: "core",
    policyTags: [],
    propTags: {},
    props: z.object({
      heading: localized(120),
      /** Locations to show in this order; empty = every active location, primary first. */
      locationIds: z.array(z.uuid()).max(50).default([]),
      /** Where "Show on map" links to (a plain link: no map script or frame is embedded). */
      mapProvider: z.enum(MAP_PROVIDERS).default("google"),
      showContact: z.boolean().default(true),
      showOpeningHours: z.boolean().default(false),
      layout: z.enum(["grid", "list"]).default("grid"),
    }),
    contentBindings: ["locations"],
    allowedIn: SITE_PLACEMENTS,
    renderer: "builtin:locations-map@1",
  },
];
