import type { LocalizedLabel } from "./manifest";
import { SITE_MODULES, type ModuleKey } from "./modules/index";
import { ModuleRegistryError } from "./registry";
import { SITE_KINDS, type SiteKind } from "./types";

export interface SitePresetModule {
  key: ModuleKey;
  /** Presets offer defaults the merchant can change; locks come from packs and policy. */
  status: "enabled";
  settings?: Record<string, unknown>;
}

/**
 * Business facts the starting home page of a site that does not sell shows under its hero
 * (theme-engine lays them out): the identity facts, and the opening hours of the primary
 * location for businesses customers visit.
 */
export const STARTER_HOME_BLOCKS = ["business_facts", "opening_hours"] as const;
export type StarterHomeBlock = (typeof STARTER_HOME_BLOCKS)[number];

/**
 * Site-kind preset (docs/platform/site-turleri-ve-cms.md §1): the modules a new site starts
 * with and what its starting pages show. Modules a preset does not list start off (no row).
 * The kind stays on the profile for onboarding and reporting; runtime code reads site_modules
 * and preset data, never the kind.
 */
export interface SitePreset {
  kind: SiteKind;
  label: LocalizedLabel;
  description: LocalizedLabel;
  modules: readonly SitePresetModule[];
  /** Starting home page blocks of a site without commerce (an online store starts with the shop layout). */
  homeBlocks: readonly StarterHomeBlock[];
}

export const SITE_PRESETS: Readonly<Record<SiteKind, SitePreset>> = {
  static: {
    kind: "static",
    label: { tr: "Tanıtım sitesi", en: "Static site" },
    description: {
      tr: "Kişisel site, tek sayfalık tanıtım veya küçük ofis sitesi: sayfalar, yazılar ve yasal metinler.",
      en: "Personal site, landing page or small office site: pages, posts and legal texts.",
    },
    modules: [{ key: "content", status: "enabled" }],
    homeBlocks: ["business_facts"],
  },
  corporate: {
    kind: "corporate",
    label: { tr: "Kurumsal site", en: "Corporate site" },
    description: {
      tr: "Şirket sitesi: kurumsal sayfalar, hizmetler, yazılar, SSS ve yasal metinler. Ürün kataloğu katalog modülü açılarak eklenir.",
      en: "Company site: corporate pages, services, posts, FAQ and legal texts. A product catalog is added by enabling the catalog module.",
    },
    // The plan's corporate packs start without a catalog (kurumsal.genel: content, people, leads);
    // the B2B quote catalog (priceVisibility=quote_only) arrives with the b2b.uretici-toptan pack
    // in Faz 3, together with the storefront that hides prices. Until then a corporate site has
    // no product, collection, cart or checkout routes (§11 Faz 1).
    modules: [{ key: "content", status: "enabled" }],
    homeBlocks: ["business_facts"],
  },
  service: {
    kind: "service",
    label: { tr: "Hizmet sitesi", en: "Service business site" },
    description: {
      tr: "Kuaför, klinik, danışman, eğitmen gibi hizmet işletmeleri: hizmet sayfaları, SSS ve lokasyonlar.",
      en: "Salons, clinics, consultants, tutors: service pages, FAQ and locations.",
    },
    modules: [{ key: "content", status: "enabled" }],
    homeBlocks: ["business_facts", "opening_hours"],
  },
  ecommerce: {
    kind: "ecommerce",
    label: { tr: "E-ticaret sitesi", en: "Online store" },
    description: {
      tr: "Ürün satışı: katalog, sepet, ödeme, siparişler ve içerik.",
      en: "Selling products: catalog, cart, checkout, orders and content.",
    },
    modules: [
      { key: "content", status: "enabled" },
      { key: "catalog", status: "enabled" },
      { key: "commerce", status: "enabled" },
    ],
    homeBlocks: ["business_facts"],
  },
  hybrid: {
    kind: "hybrid",
    label: { tr: "Hizmet ve e-ticaret", en: "Services and store" },
    description: {
      tr: "Hem hizmet sunan hem ürün satan işletmeler: içerik, katalog ve e-ticaret birlikte.",
      en: "Businesses that offer services and sell products: content, catalog and commerce together.",
    },
    modules: [
      { key: "content", status: "enabled" },
      { key: "catalog", status: "enabled" },
      { key: "commerce", status: "enabled" },
    ],
    homeBlocks: ["business_facts"],
  },
};

/** Boot check: every preset names registered, switchable modules with valid settings and their dependencies. */
function validatePresets(): void {
  const problems: string[] = [];
  for (const kind of SITE_KINDS) {
    const preset = SITE_PRESETS[kind];
    if (preset.kind !== kind) problems.push(`preset "${kind}" declares kind "${preset.kind}"`);
    const keys = new Set<string>();
    for (const m of preset.modules) {
      if (keys.has(m.key)) problems.push(`preset "${kind}" lists module "${m.key}" twice`);
      keys.add(m.key);
      const manifest = SITE_MODULES.get(m.key);
      if (!manifest) {
        problems.push(`preset "${kind}" enables "${m.key}", which has no manifest`);
        continue;
      }
      if (manifest.alwaysOn) problems.push(`preset "${kind}" lists always-on module "${m.key}"`);
      const parsed = manifest.settings.safeParse(m.settings ?? {});
      if (!parsed.success) problems.push(`preset "${kind}": settings of "${m.key}" are invalid (${parsed.error.message})`);
    }
    for (const m of preset.modules) {
      for (const dep of SITE_MODULES.get(m.key)?.dependsOn ?? []) {
        if (!keys.has(dep) && !SITE_MODULES.isAlwaysOn(dep)) problems.push(`preset "${kind}" enables "${m.key}" without its dependency "${dep}"`);
      }
    }
  }
  if (problems.length) throw new ModuleRegistryError(problems);
}

validatePresets();

export interface PresetModuleRow {
  moduleKey: ModuleKey;
  status: "enabled";
  settings: Record<string, unknown>;
  source: "preset";
}

/** site_modules rows a new site of this kind starts with (settings parsed, defaults filled in). */
export function presetModuleRows(kind: SiteKind): PresetModuleRow[] {
  return SITE_PRESETS[kind].modules.map((m) => ({
    moduleKey: m.key,
    status: m.status,
    settings: SITE_MODULES.parseSettings(m.key, m.settings ?? {}),
    source: "preset" as const,
  }));
}
