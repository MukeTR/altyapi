import type { NavigationItem, PageContent } from "@altyapi/database";
import { newId } from "@altyapi/commerce-core";
import { SITE_MODULES, SITE_PRESETS, type ModuleKey, type SiteKind, type StarterHomeBlock } from "@altyapi/site";
import { entryTemplateKey, templatePlacementOf, type Placement, type SectionPolicy } from "./sections/types";
import { validatePageContent, type PageContentInput } from "./validation";

/**
 * Starting storefront of a new site, per site-kind preset (docs/platform/site-turleri-ve-cms.md
 * §1, §11 Faz 1). Online stores (ecommerce, hybrid) keep the shop layout every store had
 * before site kinds existed. Static, corporate and service sites get a home page, about,
 * contact and legal pages bound to the business profile, and no cart anywhere. A preset with
 * the catalog module but without commerce also gets the catalog pages (products without a cart).
 */

/** Modules a preset starts with (the always-on core included). */
export function presetModules(kind: SiteKind): ModuleKey[] {
  return SITE_MODULES.activeKeys(SITE_PRESETS[kind].modules.map((m) => ({ moduleKey: m.key, status: m.status })));
}

function presetPolicy(kind: SiteKind): SectionPolicy {
  return { enabledModules: presetModules(kind), blockedTags: [] };
}

function build(input: PageContentInput, placement: Placement, policy: SectionPolicy): PageContent {
  const result = validatePageContent(input, placement, policy);
  if (!result.ok) throw new Error(`Invalid default content for ${placement}: ${JSON.stringify(result.issues)}`);
  return result.content;
}

const sells = (kind: SiteKind) => presetModules(kind).includes("commerce");
const hasCatalog = (kind: SiteKind) => presetModules(kind).includes("catalog");

export function defaultGlobalSections(kind: SiteKind = "ecommerce"): PageContent {
  const policy = presetPolicy(kind);
  if (sells(kind)) {
    return build(
      {
        sections: [
          {
            type: "announcement-bar",
            props: {},
            blocks: [{ type: "message", props: { text: { tr: "Tüm siparişlerde hızlı kargo", en: "Fast shipping on all orders" } } }],
            disabled: true,
          },
          { type: "header", props: {} },
          {
            type: "footer",
            props: { text: { tr: "<p>Güvenli alışveriş.</p>", en: "<p>Secure shopping.</p>" } },
          },
        ],
      },
      "global",
      policy,
    );
  }
  return build(
    {
      sections: [
        // Search looks through products, so it only helps sites with a catalog.
        { type: "header", props: { showSearch: hasCatalog(kind), showCart: false, showAccount: false } },
        // No newsletter (commercial e-mail consent) and no payment marks on a site that does not sell.
        { type: "footer", props: { showNewsletter: false, showPaymentIcons: false } },
      ],
    },
    "global",
    policy,
  );
}

export interface DefaultPage {
  type: "home" | "product" | "collection" | "page" | "landing" | "cart" | "search" | "not_found";
  handle: string;
  title: Record<string, string>;
  content: PageContent;
  /**
   * Goes live with the store's first publication. Pages whose text only the merchant can write
   * (about) start as drafts, so nothing invented is ever published.
   */
  publish: boolean;
}

/** Handles of the site pages a non-commerce preset creates (menus link to them). */
export const SITE_PAGE_HANDLES = { about: "hakkimizda", contact: "iletisim", legal: "yasal-bilgiler" } as const;

function notFoundPage(policy: SectionPolicy): DefaultPage {
  return {
    type: "not_found",
    handle: "default",
    title: { tr: "Sayfa bulunamadı", en: "Page not found" },
    content: build(
      {
        sections: [
          {
            type: "not-found-main",
            props: {
              heading: { tr: "Aradığınız sayfa bulunamadı", en: "We couldn't find that page" },
              body: { tr: "Bağlantı değişmiş ya da kaldırılmış olabilir.", en: "The link may have changed or been removed." },
            },
          },
        ],
      },
      "not_found",
      policy,
    ),
    publish: true,
  };
}

/** Pages a module renders its routes with (handle "default"): product and collection pages, the cart, search and not-found. */
export type ModulePageType = "product" | "collection" | "cart" | "search" | "not_found";

/**
 * Module pages each module needs. A module turned on after the site was set up gets them as
 * drafts (ensureModulePages); until they are published its routes render the same default
 * layout (defaultModulePageContent).
 */
export const MODULE_PAGE_TYPES: Readonly<Partial<Record<ModuleKey, readonly ModulePageType[]>>> = {
  core: ["search", "not_found"],
  catalog: ["product", "collection"],
  commerce: ["cart"],
};

/** Module page types the given active modules need, in module order. */
export function modulePageTypesFor(modules: readonly string[]): ModulePageType[] {
  return SITE_MODULES.keys().flatMap((key) => (modules.includes(key) ? [...(MODULE_PAGE_TYPES[key] ?? [])] : []));
}

/** Starting layout of a module page: its main section. */
function modulePage(type: ModulePageType, policy: SectionPolicy): DefaultPage {
  switch (type) {
    case "product":
      return { type, handle: "default", title: { tr: "Ürün", en: "Product" }, content: build({ sections: [{ type: "product-main", props: {} }] }, type, policy), publish: true };
    case "collection":
      return { type, handle: "default", title: { tr: "Koleksiyon", en: "Collection" }, content: build({ sections: [{ type: "collection-main", props: {} }] }, type, policy), publish: true };
    case "cart":
      return { type, handle: "default", title: { tr: "Sepet", en: "Cart" }, content: build({ sections: [{ type: "cart-main", props: {} }] }, type, policy), publish: true };
    case "search":
      return { type, handle: "default", title: { tr: "Arama", en: "Search" }, content: build({ sections: [{ type: "search-main", props: {} }] }, type, policy), publish: true };
    case "not_found":
      return notFoundPage(policy);
  }
}

/** Policy the built-in layouts are checked against: every module on (rendering applies the store's own policy). */
const ALL_MODULES_POLICY: SectionPolicy = { enabledModules: SITE_MODULES.keys(), blockedTags: [] };

/** A module page as ensureModulePages creates it (a draft) for a module turned on later. */
export function defaultModulePage(type: ModulePageType): DefaultPage {
  return modulePage(type, ALL_MODULES_POLICY);
}

/**
 * Layout a module route renders with while the store has no page of that type (a module
 * turned on after the site was set up, before its pages are published): the main section.
 */
export function defaultModulePageContent(type: ModulePageType): PageContent {
  return defaultModulePage(type).content;
}

function catalogPages(policy: SectionPolicy): DefaultPage[] {
  return [modulePage("product", policy), modulePage("collection", policy)];
}

function searchPage(policy: SectionPolicy): DefaultPage {
  return modulePage("search", policy);
}

/** Sections of the starting home page blocks a preset lists (SITE_PRESETS[kind].homeBlocks). */
const HOME_BLOCK_SECTIONS: Readonly<Record<StarterHomeBlock, PageContentInput["sections"][number]>> = {
  business_facts: { type: "business-facts", props: { facts: ["tradeName", "foundingDate", "address", "phone", "email"] } },
  opening_hours: { type: "opening-hours", props: { heading: { tr: "Çalışma saatleri", en: "Opening hours" } } },
};

export function defaultPages(storeName: string, kind: SiteKind = "ecommerce"): DefaultPage[] {
  const policy = presetPolicy(kind);
  if (sells(kind)) {
    return [
      {
        type: "home",
        handle: "index",
        title: { tr: storeName, en: storeName },
        content: build(
          {
            sections: [
              {
                type: "hero",
                props: {
                  heading: { tr: `${storeName} mağazasına hoş geldiniz`, en: `Welcome to ${storeName}` },
                  subheading: { tr: "Yeni sezon ürünlerini keşfedin.", en: "Discover the new season." },
                  primaryCta: { label: { tr: "Alışverişe başla", en: "Shop now" }, href: "/collections/all" },
                },
              },
              { type: "product-grid", props: { heading: { tr: "Yeni ürünler", en: "New arrivals" }, source: "newest" } },
              {
                type: "newsletter",
                props: {
                  heading: { tr: "Kampanyalardan haberdar olun", en: "Stay in the loop" },
                  buttonLabel: { tr: "Abone ol", en: "Subscribe" },
                  placeholder: { tr: "E-posta adresiniz", en: "Your e-mail" },
                  successMessage: { tr: "Teşekkürler!", en: "Thank you!" },
                },
              },
            ],
          },
          "home",
          policy,
        ),
        publish: true,
      },
      ...catalogPages(policy),
      modulePage("cart", policy),
      searchPage(policy),
      notFoundPage(policy),
    ];
  }

  const contactHref = `/pages/${SITE_PAGE_HANDLES.contact}`;
  const home: DefaultPage = {
    type: "home",
    handle: "index",
    title: { tr: storeName, en: storeName },
    content: build(
      {
        sections: [
          {
            type: "hero",
            props: {
              heading: { tr: storeName, en: storeName },
              primaryCta: { label: { tr: "Bize ulaşın", en: "Contact us" }, href: contactHref },
              ...(hasCatalog(kind) ? { secondaryCta: { label: { tr: "Ürünlerimiz", en: "Our products" }, href: "/collections/all" } } : {}),
              height: "medium",
            },
          },
          ...SITE_PRESETS[kind].homeBlocks.map((block) => HOME_BLOCK_SECTIONS[block]),
        ],
      },
      "home",
      policy,
    ),
    publish: true,
  };
  const about: DefaultPage = {
    type: "page",
    handle: SITE_PAGE_HANDLES.about,
    title: { tr: "Hakkımızda", en: "About us" },
    content: build({ sections: [{ type: "rich-text", props: { heading: { tr: "Hakkımızda", en: "About us" } } }] }, "page", policy),
    publish: false,
  };
  const contact: DefaultPage = {
    type: "page",
    handle: SITE_PAGE_HANDLES.contact,
    title: { tr: "İletişim", en: "Contact" },
    content: build(
      {
        sections: [
          { type: "business-facts", props: { heading: { tr: "İletişim bilgileri", en: "Contact details" }, facts: ["address", "phone", "email", "kepAddress"], layout: "list" } },
          { type: "locations-map", props: { heading: { tr: "Adreslerimiz", en: "Our locations" }, showOpeningHours: true } },
        ],
      },
      "page",
      policy,
    ),
    publish: true,
  };
  const legal: DefaultPage = {
    type: "page",
    handle: SITE_PAGE_HANDLES.legal,
    title: { tr: "Yasal bilgiler", en: "Legal information" },
    content: build({ sections: [{ type: "statutory-info", props: {} }] }, "page", policy),
    publish: true,
  };
  return [home, about, contact, legal, ...(hasCatalog(kind) ? catalogPages(policy) : []), searchPage(policy), notFoundPage(policy)];
}

/**
 * Starting menus. Links to pages use their ids (pageIds: handle → id of the pages created with
 * defaultPages); a link to a page that is not live is hidden until it is published.
 */
export function defaultNavigations(kind: SiteKind = "ecommerce", pageIds: Record<string, string> = {}): { handle: string; name: string; items: NavigationItem[] }[] {
  if (sells(kind)) {
    return [
      {
        handle: "main",
        name: "Ana menü",
        items: [
          { id: newId(), label: { tr: "Ana sayfa", en: "Home" }, link: { type: "home" } },
          { id: newId(), label: { tr: "Tüm ürünler", en: "All products" }, link: { type: "url", url: "/collections/all" } },
        ],
      },
      {
        handle: "footer",
        name: "Alt menü",
        items: [{ id: newId(), label: { tr: "Arama", en: "Search" }, link: { type: "search" } }],
      },
    ];
  }
  const page = (handle: string, label: Record<string, string>): NavigationItem[] =>
    pageIds[handle] ? [{ id: newId(), label, link: { type: "page", pageId: pageIds[handle]! } }] : [];
  return [
    {
      handle: "main",
      name: "Ana menü",
      items: [
        { id: newId(), label: { tr: "Ana sayfa", en: "Home" }, link: { type: "home" } },
        ...(hasCatalog(kind) ? [{ id: newId(), label: { tr: "Ürünler", en: "Products" }, link: { type: "url" as const, url: "/collections/all" } }] : []),
        ...page(SITE_PAGE_HANDLES.about, { tr: "Hakkımızda", en: "About us" }),
        ...page(SITE_PAGE_HANDLES.contact, { tr: "İletişim", en: "Contact" }),
      ],
    },
    {
      handle: "footer",
      name: "Alt menü",
      items: [...page(SITE_PAGE_HANDLES.contact, { tr: "İletişim", en: "Contact" }), ...page(SITE_PAGE_HANDLES.legal, { tr: "Yasal bilgiler", en: "Legal information" })],
    },
  ];
}

// ---------------------------------------------------------------------------
// Content type templates
// ---------------------------------------------------------------------------


/**
 * Layout of a content type's template page until the merchant designs one: the required main
 * section only (entry-main on detail pages, entry-index-main on index pages). Used for the
 * draft template created when a type is installed, and to render entries of a type whose
 * template has not been published yet.
 */
export function defaultTemplateContent(templateKey: string): PageContent | null {
  const m = /^entries\.([a-z][a-z0-9_]{0,47})\.(detail|index)$/.exec(templateKey);
  if (!m) return null;
  const main = m[2] === "detail" ? "entry-main" : "entry-index-main";
  return build({ sections: [{ type: main, props: {} }] }, templatePlacementOf(entryTemplateKey(m[1]!, m[2] as "detail" | "index")), ALL_MODULES_POLICY);
}
