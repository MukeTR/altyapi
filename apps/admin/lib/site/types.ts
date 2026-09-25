/**
 * Response shapes of the site core API (/v1/…/site: profile, modules, business identity and
 * locations; packages/site and packages/tenancy/src/site). Responses may carry more fields.
 */
import type { LocalizedText } from "@/lib/content/types";

export const SITE_KINDS = ["static", "corporate", "service", "ecommerce", "hybrid"] as const;
export type SiteKind = (typeof SITE_KINDS)[number];

export const PAGE_URL_STYLES = ["prefixed", "root"] as const;
export const UNTRANSLATED_POLICIES = ["hide", "fallback_noindex"] as const;
export const VERIFICATION_PROVIDERS = ["google", "bing", "yandex", "pinterest", "facebook"] as const;
export type VerificationProvider = (typeof VERIFICATION_PROVIDERS)[number];

/** <meta name> each provider checks (packages/site/src/profile.ts). */
export const VERIFICATION_META_NAMES: Record<VerificationProvider, string> = {
  google: "google-site-verification",
  bing: "msvalidate.01",
  yandex: "yandex-verification",
  pinterest: "p:domain_verify",
  facebook: "facebook-domain-verification",
};

export interface SiteProfile {
  kind: SiteKind;
  primaryPack: string | null;
  addonPacks: string[];
  pageUrlStyle: (typeof PAGE_URL_STYLES)[number];
  untranslatedPolicy: (typeof UNTRANSLATED_POLICIES)[number];
  aiCrawlers: { training: "allow" | "deny" };
  verificationMeta: Partial<Record<VerificationProvider, string>>;
  modulesVersion: number;
  policyVersion: number;
  updatedAt: string;
  /** Active modules of the store (core included). */
  modules: string[];
}

export type SiteModuleStatus = "enabled" | "disabled" | "locked_on" | "locked_off";

export interface SiteModule {
  key: string;
  version: string;
  label: LocalizedText;
  description: LocalizedText;
  status: SiteModuleStatus;
  active: boolean;
  alwaysOn: boolean;
  source: "preset" | "pack" | "merchant" | "policy" | null;
  settings: Record<string, unknown>;
  settingsValid: boolean;
  dependsOn: string[];
  dependents: string[];
  updatedAt: string | null;
}

export const LEGAL_FORMS = ["sahis", "limited", "anonim", "kooperatif", "dernek", "vakif", "kamu", "diger"] as const;
export type LegalForm = (typeof LEGAL_FORMS)[number];

export interface SiteAddress {
  street: string;
  mahalle?: string | null;
  ilce?: string | null;
  il: string;
  postalCode?: string | null;
  country: string;
}

export interface BusinessIdentity {
  legalName: string | null;
  tradeName: string | null;
  legalForm: LegalForm | null;
  mersisNo: string | null;
  tradeRegistryNo: string | null;
  taxOffice: string | null;
  taxNumber: string | null;
  taxNumberPublic: boolean;
  kepAddress: string | null;
  chamber: string | null;
  chamberRulesUrl: string | null;
  phone: string | null;
  email: string | null;
  address: SiteAddress | null;
  foundingDate: string | null;
  logoAssetId: string | null;
  description: LocalizedText;
  sameAs: string[];
  identifiers: { nace?: string[]; duns?: string; gln?: string; lei?: string; vatId?: string; eori?: string };
  updatedAt: string | null;
  /** The tax number is a sole proprietor's TCKN shown masked (the reader lacks site:write). */
  taxNumberMasked: boolean;
}

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface OpeningHours {
  weekly: { days: Weekday[]; opens: string; closes: string }[];
  specialDays: { from: string; to: string; closed: boolean; hours: { opens: string; closes: string }[]; label?: LocalizedText }[];
  byAppointment: boolean;
  note?: LocalizedText;
}

export interface GeoPoint {
  lat: number;
  lng: number;
  approximate: boolean;
}

export interface ServiceArea {
  places: { il: string; ilce?: string | null }[];
  radiusKm?: number | null;
  countries?: string[];
}

export interface SiteLocation {
  id: string;
  name: LocalizedText;
  slug: string;
  address: SiteAddress | null;
  geo: GeoPoint | null;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  openingHours: OpeningHours;
  serviceArea: ServiceArea | null;
  isPrimary: boolean;
  position: number;
  status: "active" | "hidden";
  createdAt: string;
  updatedAt: string;
}
