import { z } from "zod";
import { alignment, colorScheme, href, link, localized, optionalAsset, richText } from "./primitives";

export type PageTypeName = "home" | "product" | "collection" | "page" | "landing" | "cart" | "search" | "not_found";
export type SectionCategory = "layout" | "hero" | "media" | "content" | "commerce" | "social_proof" | "marketing" | "template";

export interface SectionDefinition {
  type: string;
  version: number;
  name: { tr: string; en: string };
  category: SectionCategory;
  props: z.ZodObject;
  blocks?: Record<string, z.ZodObject>;
  maxBlocks?: number;
  /** Data the renderer resolves from the catalog (product, collection…). */
  contentBindings: ("product" | "collection" | "products" | "collections" | "cart" | "search")[];
  /** Page types the section may be placed on; "global" = theme-level header/footer/overlays. */
  allowedIn: (PageTypeName | "global")[];
  /** Renderer id resolved by the storefront component registry. */
  renderer: string;
  /** Only one instance per page/global tree. */
  singleton?: boolean;
}

const ALL_PAGES: PageTypeName[] = ["home", "product", "collection", "page", "landing", "cart", "search", "not_found"];
const CONTENT_PAGES: PageTypeName[] = ["home", "page", "landing", "collection", "product", "not_found"];

const cta = link.nullable().default(null);

export const SECTION_DEFINITIONS: SectionDefinition[] = [
  {
    type: "announcement-bar",
    version: 1,
    name: { tr: "Duyuru çubuğu", en: "Announcement bar" },
    category: "marketing",
    props: z.object({
      rotateSeconds: z.number().int().min(2).max(30).default(5),
      dismissible: z.boolean().default(false),
      colorScheme: colorScheme,
    }),
    blocks: { message: z.object({ text: localized(160), link: href.nullable().default(null) }) },
    maxBlocks: 5,
    contentBindings: [],
    allowedIn: ["global", "landing"],
    renderer: "builtin:announcement-bar@1",
  },
  {
    type: "header",
    version: 1,
    name: { tr: "Üst bilgi", en: "Header" },
    category: "layout",
    props: z.object({
      logoAssetId: optionalAsset,
      logoWidth: z.number().int().min(40).max(400).default(140),
      menuHandle: z.string().default("main"),
      layout: z.enum(["logo-left", "logo-center"]).default("logo-left"),
      sticky: z.boolean().default(true),
      showSearch: z.boolean().default(true),
      showAccount: z.boolean().default(true),
      showLocaleSwitcher: z.boolean().default(false),
    }),
    contentBindings: ["cart"],
    allowedIn: ["global"],
    renderer: "builtin:header@1",
    singleton: true,
  },
  {
    type: "footer",
    version: 1,
    name: { tr: "Alt bilgi", en: "Footer" },
    category: "layout",
    props: z.object({
      menuHandles: z.array(z.string()).max(4).default(["footer"]),
      text: richText(4000),
      showNewsletter: z.boolean().default(true),
      showPaymentIcons: z.boolean().default(true),
      socialLinks: z
        .array(z.object({ network: z.enum(["instagram", "facebook", "x", "tiktok", "youtube", "linkedin", "pinterest"]), url: z.url() }))
        .max(8)
        .default([]),
      colorScheme: colorScheme,
    }),
    contentBindings: [],
    allowedIn: ["global"],
    renderer: "builtin:footer@1",
    singleton: true,
  },
  {
    type: "hero",
    version: 1,
    name: { tr: "Hero", en: "Hero" },
    category: "hero",
    props: z.object({
      heading: localized(120),
      subheading: localized(300),
      primaryCta: cta,
      secondaryCta: cta,
      desktopImageAssetId: optionalAsset,
      mobileImageAssetId: optionalAsset,
      overlayOpacity: z.number().int().min(0).max(80).default(20),
      contentAlignment: alignment.default("center"),
      height: z.enum(["small", "medium", "large", "full"]).default("large"),
    }),
    contentBindings: [],
    allowedIn: ["home", "page", "landing", "collection"],
    renderer: "builtin:hero@1",
  },
  {
    type: "image-banner",
    version: 1,
    name: { tr: "Görsel banner", en: "Image banner" },
    category: "media",
    props: z.object({
      desktopImageAssetId: optionalAsset,
      mobileImageAssetId: optionalAsset,
      alt: localized(200),
      link: href.nullable().default(null),
      aspectRatio: z.enum(["21:9", "16:9", "3:1", "4:1", "auto"]).default("3:1"),
      campaignId: z.uuid().nullable().default(null),
    }),
    contentBindings: [],
    allowedIn: CONTENT_PAGES,
    renderer: "builtin:image-banner@1",
  },
  {
    type: "slider",
    version: 1,
    name: { tr: "Slider", en: "Slider" },
    category: "hero",
    props: z.object({
      autoplay: z.boolean().default(true),
      intervalSeconds: z.number().int().min(2).max(20).default(6),
      showArrows: z.boolean().default(true),
      showDots: z.boolean().default(true),
      height: z.enum(["small", "medium", "large"]).default("large"),
    }),
    blocks: {
      slide: z.object({
        desktopImageAssetId: optionalAsset,
        mobileImageAssetId: optionalAsset,
        heading: localized(120),
        subheading: localized(300),
        cta,
        alt: localized(200),
        campaignId: z.uuid().nullable().default(null),
      }),
    },
    maxBlocks: 10,
    contentBindings: [],
    allowedIn: CONTENT_PAGES,
    renderer: "builtin:slider@1",
  },
  {
    type: "rich-text",
    version: 1,
    name: { tr: "Zengin metin", en: "Rich text" },
    category: "content",
    props: z.object({
      heading: localized(160),
      body: richText(),
      alignment: alignment.default("left"),
      maxWidth: z.enum(["narrow", "medium", "wide"]).default("medium"),
    }),
    contentBindings: [],
    allowedIn: ALL_PAGES,
    renderer: "builtin:rich-text@1",
  },
  {
    type: "featured-collection",
    version: 1,
    name: { tr: "Öne çıkan koleksiyon", en: "Featured collection" },
    category: "commerce",
    props: z.object({
      heading: localized(120),
      collectionId: z.uuid().nullable().default(null),
      productLimit: z.number().int().min(1).max(24).default(8),
      columnsDesktop: z.number().int().min(2).max(6).default(4),
      columnsMobile: z.number().int().min(1).max(2).default(2),
      showViewAll: z.boolean().default(true),
      layout: z.enum(["grid", "carousel"]).default("grid"),
    }),
    contentBindings: ["collection", "products"],
    allowedIn: CONTENT_PAGES,
    renderer: "builtin:featured-collection@1",
  },
  {
    type: "product-grid",
    version: 1,
    name: { tr: "Ürün vitrini", en: "Product showcase" },
    category: "commerce",
    props: z.object({
      heading: localized(120),
      source: z.enum(["collection", "tag", "manual", "newest", "on_sale"]).default("newest"),
      collectionId: z.uuid().nullable().default(null),
      tag: z.string().max(64).nullable().default(null),
      productIds: z.array(z.uuid()).max(48).default([]),
      limit: z.number().int().min(1).max(48).default(12),
      columnsDesktop: z.number().int().min(2).max(6).default(4),
      columnsMobile: z.number().int().min(1).max(2).default(2),
    }),
    contentBindings: ["products"],
    allowedIn: CONTENT_PAGES,
    renderer: "builtin:product-grid@1",
  },
  {
    type: "category-cards",
    version: 1,
    name: { tr: "Kategori kartları", en: "Category cards" },
    category: "commerce",
    props: z.object({ heading: localized(120), columnsDesktop: z.number().int().min(2).max(6).default(4) }),
    blocks: {
      card: z.object({ collectionId: z.uuid(), imageAssetId: optionalAsset, label: localized(80) }),
    },
    maxBlocks: 12,
    contentBindings: ["collections"],
    allowedIn: CONTENT_PAGES,
    renderer: "builtin:category-cards@1",
  },
  {
    type: "image-with-text",
    version: 1,
    name: { tr: "Görsel ve metin", en: "Image with text" },
    category: "content",
    props: z.object({
      imageAssetId: optionalAsset,
      imagePosition: z.enum(["left", "right"]).default("left"),
      heading: localized(160),
      body: richText(6000),
      cta,
      colorScheme,
    }),
    contentBindings: [],
    allowedIn: CONTENT_PAGES,
    renderer: "builtin:image-with-text@1",
  },
  {
    type: "video",
    version: 1,
    name: { tr: "Video", en: "Video" },
    category: "media",
    props: z
      .object({
        heading: localized(120),
        source: z.enum(["asset", "youtube", "vimeo"]).default("asset"),
        assetId: optionalAsset,
        url: z.url().nullable().default(null),
        posterAssetId: optionalAsset,
        autoplay: z.boolean().default(false),
        loop: z.boolean().default(false),
      })
      .refine((v) => (v.source === "asset" ? true : v.url === null || /(youtube\.com|youtu\.be|vimeo\.com)\//.test(v.url)), {
        message: "errors.section.invalid_video_url",
        path: ["url"],
      }),
    contentBindings: [],
    allowedIn: CONTENT_PAGES,
    renderer: "builtin:video@1",
  } as unknown as SectionDefinition,
  {
    type: "testimonials",
    version: 1,
    name: { tr: "Müşteri yorumları", en: "Testimonials" },
    category: "social_proof",
    props: z.object({ heading: localized(120), layout: z.enum(["grid", "carousel"]).default("carousel") }),
    blocks: {
      testimonial: z.object({
        quote: localized(600),
        author: z.string().max(80).default(""),
        role: localized(80),
        rating: z.number().int().min(1).max(5).nullable().default(null),
        avatarAssetId: optionalAsset,
      }),
    },
    maxBlocks: 20,
    contentBindings: [],
    allowedIn: CONTENT_PAGES,
    renderer: "builtin:testimonials@1",
  },
  {
    type: "logo-cloud",
    version: 1,
    name: { tr: "Logo bulutu", en: "Logo cloud" },
    category: "social_proof",
    props: z.object({ heading: localized(120), grayscale: z.boolean().default(true) }),
    blocks: { logo: z.object({ assetId: z.uuid(), name: z.string().max(80), link: href.nullable().default(null) }) },
    maxBlocks: 24,
    contentBindings: [],
    allowedIn: CONTENT_PAGES,
    renderer: "builtin:logo-cloud@1",
  },
  {
    type: "newsletter",
    version: 1,
    name: { tr: "Bülten", en: "Newsletter" },
    category: "marketing",
    props: z.object({
      heading: localized(120),
      body: localized(400),
      placeholder: localized(80),
      buttonLabel: localized(40),
      consentText: richText(1000),
      successMessage: localized(200),
      colorScheme,
    }),
    contentBindings: [],
    allowedIn: [...CONTENT_PAGES, "global"],
    renderer: "builtin:newsletter@1",
  },
  {
    type: "faq",
    version: 1,
    name: { tr: "Sıkça sorulan sorular", en: "FAQ" },
    category: "content",
    props: z.object({ heading: localized(120), emitStructuredData: z.boolean().default(true) }),
    blocks: { item: z.object({ question: localized(300), answer: richText(4000) }) },
    maxBlocks: 50,
    contentBindings: [],
    allowedIn: CONTENT_PAGES,
    renderer: "builtin:faq@1",
  },
  {
    type: "countdown",
    version: 1,
    name: { tr: "Geri sayım", en: "Countdown" },
    category: "marketing",
    props: z.object({
      heading: localized(120),
      endsAt: z.iso.datetime({ offset: true }),
      expiredBehavior: z.enum(["hide", "show_message"]).default("hide"),
      expiredMessage: localized(200),
      cta,
      campaignId: z.uuid().nullable().default(null),
      colorScheme,
    }),
    contentBindings: [],
    allowedIn: [...CONTENT_PAGES, "global"],
    renderer: "builtin:countdown@1",
  },
  {
    type: "popup",
    version: 1,
    name: { tr: "Popup", en: "Popup" },
    category: "marketing",
    props: z.object({
      heading: localized(120),
      body: richText(2000),
      imageAssetId: optionalAsset,
      cta,
      couponCode: z.string().max(64).nullable().default(null),
      collectEmail: z.boolean().default(false),
      placement: z.enum(["modal", "slide-in", "bar"]).default("modal"),
      trigger: z
        .discriminatedUnion("type", [
          z.object({ type: z.literal("page_load"), delaySeconds: z.number().int().min(0).max(120).default(0) }),
          z.object({ type: z.literal("exit_intent") }),
          z.object({ type: z.literal("scroll"), percent: z.number().int().min(5).max(100).default(50) }),
          z.object({ type: z.literal("timer"), seconds: z.number().int().min(1).max(600).default(15) }),
        ])
        .default({ type: "page_load", delaySeconds: 3 }),
      frequency: z
        .object({ type: z.enum(["once", "session", "every_n_days", "always"]), days: z.number().int().min(1).max(365).default(7) })
        .default({ type: "session", days: 7 }),
      campaignId: z.uuid().nullable().default(null),
    }),
    contentBindings: [],
    allowedIn: ["global", "home", "page", "landing", "collection", "product"],
    renderer: "builtin:popup@1",
  },
  // Template sections: the main content of catalog/system pages.
  {
    type: "product-main",
    version: 1,
    name: { tr: "Ürün detayı", en: "Product details" },
    category: "template",
    props: z.object({
      galleryLayout: z.enum(["thumbnails-left", "thumbnails-bottom", "grid"]).default("thumbnails-bottom"),
      showVendor: z.boolean().default(false),
      showSku: z.boolean().default(false),
      showShareButtons: z.boolean().default(true),
      enableZoom: z.boolean().default(true),
      variantPicker: z.enum(["buttons", "dropdown"]).default("buttons"),
      showRelatedProducts: z.boolean().default(true),
    }),
    contentBindings: ["product"],
    allowedIn: ["product"],
    renderer: "builtin:product-main@1",
    singleton: true,
  },
  {
    type: "collection-main",
    version: 1,
    name: { tr: "Koleksiyon listesi", en: "Collection listing" },
    category: "template",
    props: z.object({
      productsPerPage: z.number().int().min(8).max(96).default(24),
      columnsDesktop: z.number().int().min(2).max(6).default(4),
      columnsMobile: z.number().int().min(1).max(2).default(2),
      enableFiltering: z.boolean().default(true),
      enableSorting: z.boolean().default(true),
      showCollectionImage: z.boolean().default(false),
    }),
    contentBindings: ["collection", "products"],
    allowedIn: ["collection"],
    renderer: "builtin:collection-main@1",
    singleton: true,
  },
  {
    type: "cart-main",
    version: 1,
    name: { tr: "Sepet", en: "Cart" },
    category: "template",
    props: z.object({ showCouponField: z.boolean().default(true), showOrderNote: z.boolean().default(false) }),
    contentBindings: ["cart"],
    allowedIn: ["cart"],
    renderer: "builtin:cart-main@1",
    singleton: true,
  },
  {
    type: "search-main",
    version: 1,
    name: { tr: "Arama sonuçları", en: "Search results" },
    category: "template",
    props: z.object({ productsPerPage: z.number().int().min(8).max(96).default(24) }),
    contentBindings: ["search"],
    allowedIn: ["search"],
    renderer: "builtin:search-main@1",
    singleton: true,
  },
  {
    type: "not-found-main",
    version: 1,
    name: { tr: "Sayfa bulunamadı", en: "Not found" },
    category: "template",
    props: z.object({ heading: localized(120), body: localized(400), showSearch: z.boolean().default(true) }),
    contentBindings: [],
    allowedIn: ["not_found"],
    renderer: "builtin:not-found-main@1",
    singleton: true,
  },
];

const byKey = new Map(SECTION_DEFINITIONS.map((d) => [`${d.type}@${d.version}`, d]));
const latest = new Map<string, SectionDefinition>();
for (const d of SECTION_DEFINITIONS) {
  const cur = latest.get(d.type);
  if (!cur || cur.version < d.version) latest.set(d.type, d);
}

export function getSectionDefinition(type: string, version?: number): SectionDefinition | undefined {
  return version === undefined ? latest.get(type) : byKey.get(`${type}@${version}`);
}

/** JSON Schema of a definition for the editor's property panel and the DB registry. */
export function definitionJsonSchema(def: SectionDefinition) {
  return {
    props: z.toJSONSchema(def.props, { io: "input", unrepresentable: "any" }) as Record<string, unknown>,
    blocks: Object.fromEntries(
      Object.entries(def.blocks ?? {}).map(([k, v]) => [k, z.toJSONSchema(v, { io: "input", unrepresentable: "any" })]),
    ) as Record<string, unknown>,
    defaults: propDefaults(def.props),
  };
}

/** Default value of every prop that has one (required props without defaults are omitted). */
export function propDefaults(schema: z.ZodObject): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    const r = (field as z.ZodType).safeParse(undefined);
    if (r.success && r.data !== undefined) out[key] = r.data;
  }
  return out;
}
