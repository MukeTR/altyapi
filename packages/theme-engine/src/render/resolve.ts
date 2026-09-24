import {
  getStorefrontCollection,
  getStorefrontProduct,
  listStorefrontProducts,
  localizedPath,
  parseMoney,
  type ListingSort,
  type StorefrontQueryContext,
} from "@altyapi/catalog";
import {
  listLiveEntries,
  listRouteTypes,
  liveEntryPaths,
  liveTypeLocales,
  nextScheduleBoundary,
  resolveEntryBySlug,
  resolveSingleton,
  servesIndexRoute,
  typeIndexPath,
  type ContentRouteMatch,
  type ContentRouteType,
  type LiveEntryDto,
  type LiveEntrySort,
  type LiveReadOptions,
} from "@altyapi/content";
import { AppError } from "@altyapi/commerce-core";
import {
  and,
  categories,
  channels,
  collectionTranslations,
  contentAssets,
  eq,
  inArray,
  isNull,
  pageVersions,
  productTranslations,
  siteProfiles,
  storeDomains,
  stores,
  withTenantTx,
  type Database,
  type NavigationItem,
  type PageContent,
  type SectionInstance,
} from "@altyapi/database";
import { loadActiveModules, VERIFICATION_META_NAMES, type PageUrlStyle, type UntranslatedPolicy } from "@altyapi/site";
import { getSectionDefinition } from "../sections/definitions";
import { ENTRY_LIST_SORTS } from "../sections/content-sections";
import { entryTemplateKey, sectionPolicyFor, type SectionPolicy } from "../sections/types";
import { applySectionPolicy, collectAssetIds } from "../validation";
import { themeCssVariables } from "../theme-settings";
import { defaultModulePageContent, defaultTemplateContent, type ModulePageType } from "../defaults";
import { loadLiveSnapshot, loadPreviewSnapshot, pageContentLocales, resolvePage, type ResolvedPage, type StorefrontSnapshot } from "../live";
import type { Breadcrumb, EntryListingDto, ListingDto, RenderSection, ResolvedLink, ResolvedRoute, SiteDto } from "./types";
import { routeLabel } from "./labels";
import { bindSection, siteDataLoaders, type BindingContext, type StoreRef } from "./bindings";
import { DEFAULT_ROUTE_CLASS, findRedirect, loadRouteTable, matchRoute, moduleRouteOf, pagePath, splitLocale, type RouteClass, type RouteMatch, type RouteTable } from "./routes";

export type { StoreRef } from "./bindings";

export interface SiteRequest {
  locale?: string | undefined;
  currency?: string | undefined;
  preview: boolean;
  customerGroupIds?: string[];
  mediaBaseUrl: string | null;
}

const DEFAULT_TTL = 300;
const PAGE_SIZE_MAX = 96;

function localizedText(map: unknown, locale: string, fallback: string): string {
  if (!map || typeof map !== "object") return "";
  const m = map as Record<string, string>;
  return m[locale] ?? m[fallback] ?? Object.values(m)[0] ?? "";
}

/** Server-side schedule filtering; returns sections plus the next boundary for cache TTL. */
function applySchedule(sections: SectionInstance[], now: Date): { sections: SectionInstance[]; nextBoundary: number | null } {
  let next: number | null = null;
  const visible = sections.filter((s) => {
    if (s.disabled) return false;
    const start = s.visibility?.startsAt ? Date.parse(s.visibility.startsAt) : null;
    const end = s.visibility?.endsAt ? Date.parse(s.visibility.endsAt) : null;
    for (const b of [start, end]) if (b !== null && b > now.getTime() && (next === null || b < next)) next = b;
    if (start !== null && start > now.getTime()) return false;
    if (end !== null && end <= now.getTime()) return false;
    return true;
  });
  return { sections: visible, nextBoundary: next };
}

function toRender(s: SectionInstance, data: Record<string, unknown> | null): RenderSection {
  const def = getSectionDefinition(s.type, s.version);
  const { startsAt: _s, endsAt: _e, ...clientRules } = s.visibility ?? {};
  void _s;
  void _e;
  return {
    id: s.id,
    type: s.type,
    renderer: def?.renderer ?? `unknown:${s.type}`,
    props: s.props,
    settings: s.settings,
    visibility: Object.keys(clientRules).length ? clientRules : null,
    blocks: s.blocks ?? [],
    data,
  };
}

/** Asset ids anywhere in bound section data (entry cards, identity logo, …): keys named assetId or …AssetId. */
function dataAssetIds(value: unknown, key?: string, out: Set<string> = new Set()): Set<string> {
  if (typeof value === "string" && key && /AssetId$|^assetId$/.test(key)) out.add(value);
  else if (Array.isArray(value)) value.forEach((v) => dataAssetIds(v, undefined, out));
  else if (value && typeof value === "object" && !(value instanceof Date)) for (const [k, v] of Object.entries(value)) dataAssetIds(v, k, out);
  return out;
}

/** Maps referenced asset ids to object keys (only ready, non-deleted assets of this store). */
async function assetMap(db: Database, ref: StoreRef, ids: Iterable<string>): Promise<Record<string, string>> {
  const unique = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/.test(id));
  if (!unique.length) return {};
  const rows = await withTenantTx(db, ref, (tx) =>
    tx
      .select({ id: contentAssets.id, objectKey: contentAssets.objectKey })
      .from(contentAssets)
      .where(and(eq(contentAssets.storeId, ref.storeId), inArray(contentAssets.id, unique), eq(contentAssets.status, "ready"), isNull(contentAssets.deletedAt))),
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.objectKey]));
}

async function loadSnapshot(db: Database, ref: StoreRef, preview: boolean): Promise<StorefrontSnapshot | null> {
  return preview ? loadPreviewSnapshot(db, ref) : loadLiveSnapshot(db, ref);
}

/** Store row, canonical host, site profile settings and active modules, in one transaction. */
async function storeRow(db: Database, ref: StoreRef) {
  return withTenantTx(db, ref, async (tx) => {
    const store = await tx.query.stores.findFirst({ where: eq(stores.id, ref.storeId) });
    const canonical = await tx.query.storeDomains.findFirst({
      where: and(eq(storeDomains.storeId, ref.storeId), eq(storeDomains.isCanonical, true), eq(storeDomains.status, "active")),
    });
    const [profile] = await tx
      .select({ pageUrlStyle: siteProfiles.pageUrlStyle, untranslatedPolicy: siteProfiles.untranslatedPolicy, verificationMeta: siteProfiles.verificationMeta })
      .from(siteProfiles)
      .where(eq(siteProfiles.storeId, ref.storeId));
    const modules = await loadActiveModules(tx, ref.storeId);
    // Search-console ownership tokens as <meta name> → content (google-site-verification, msvalidate.01…).
    const verification = Object.fromEntries(
      Object.entries(profile?.verificationMeta ?? {}).flatMap(([provider, token]) =>
        token && provider in VERIFICATION_META_NAMES ? [[VERIFICATION_META_NAMES[provider as keyof typeof VERIFICATION_META_NAMES], token]] : [],
      ),
    );
    return {
      store,
      canonicalHost: canonical?.hostname ?? null,
      pageUrlStyle: (profile?.pageUrlStyle ?? "prefixed") as PageUrlStyle,
      untranslatedPolicy: (profile?.untranslatedPolicy ?? "hide") as UntranslatedPolicy,
      verification,
      modules,
    };
  });
}

/**
 * Resolves navigation links (page/collection/product/entry references, content type indexes)
 * into localized paths. Links into modules that are off (cart without commerce, products and
 * collections without the catalog, entries without content) and to targets that are not live
 * are hidden instead of producing broken links. Entry links follow the entry's own slug and
 * the type's prefix in each language.
 */
async function resolveMenus(
  db: Database,
  ref: StoreRef,
  snapshot: StorefrontSnapshot,
  site: { locale: string; defaultLocale: string; style: PageUrlStyle; modules: readonly string[]; untranslatedPolicy: UntranslatedPolicy; mediaBaseUrl: string | null },
): Promise<Record<string, ResolvedLink[]>> {
  const { locale, defaultLocale, style, modules } = site;
  const catalog = modules.includes("catalog");
  const content = modules.includes("content");
  const pageIds = new Set<string>();
  const collectionIds = new Set<string>();
  const productIds = new Set<string>();
  const entryIds = new Set<string>();
  const typeIds = new Set<string>();
  const walk = (items: NavigationItem[]) =>
    items.forEach((i) => {
      if (i.link.type === "page") pageIds.add(i.link.pageId);
      if (i.link.type === "collection" && catalog) collectionIds.add(i.link.collectionId);
      if (i.link.type === "product" && catalog) productIds.add(i.link.productId);
      if (i.link.type === "entry" && content) entryIds.add(i.link.entryId);
      if (i.link.type === "entry_index" && content) typeIds.add(i.link.typeId);
      if (i.children) walk(i.children);
    });
  Object.values(snapshot.navigation).forEach(walk);

  const [entryPaths, routeTypes] = await Promise.all([
    entryIds.size
      ? liveEntryPaths(db, ref, [...entryIds], {
          locale,
          defaultLocale,
          fallback: site.untranslatedPolicy === "fallback_noindex",
          mediaBaseUrl: site.mediaBaseUrl,
          modules,
        })
      : Promise.resolve(new Map<string, string>()),
    typeIds.size ? listRouteTypes(db, ref) : Promise.resolve([]),
  ]);

  const lookups = await withTenantTx(db, ref, async (tx) => {
    const liveVersionIds = [...pageIds].map((id) => snapshot.pageVersions[id]).filter((x): x is string => !!x);
    const pv = liveVersionIds.length
      ? await tx.select({ pageId: pageVersions.pageId, handle: pageVersions.handle, type: pageVersions.type }).from(pageVersions).where(inArray(pageVersions.id, liveVersionIds))
      : [];
    const cols = collectionIds.size
      ? await tx.select().from(collectionTranslations).where(and(inArray(collectionTranslations.collectionId, [...collectionIds]), eq(collectionTranslations.locale, locale)))
      : [];
    const prods = productIds.size
      ? await tx.select().from(productTranslations).where(and(inArray(productTranslations.productId, [...productIds]), eq(productTranslations.locale, locale)))
      : [];
    return { pv, cols, prods };
  });

  const toHref = (item: NavigationItem): string | null => {
    const l = item.link;
    switch (l.type) {
      case "url": {
        if (!l.url.startsWith("/")) return l.url;
        // A link into a module that is off (/collections/all without the catalog) would only 404.
        const owner = moduleRouteOf(l.url, defaultLocale);
        return owner && !modules.includes(owner.module) ? null : localizedPath(locale, defaultLocale, l.url);
      }
      case "home":
        return localizedPath(locale, defaultLocale, "/");
      case "search":
        return localizedPath(locale, defaultLocale, "/search");
      case "cart":
        return modules.includes("commerce") ? localizedPath(locale, defaultLocale, "/cart") : null;
      case "page": {
        const p = lookups.pv.find((x) => x.pageId === l.pageId);
        const path = p ? pagePath(p.type, p.handle, style) : null;
        return path ? localizedPath(locale, defaultLocale, path) : null;
      }
      case "collection": {
        const c = lookups.cols.find((x) => x.collectionId === l.collectionId);
        return c ? localizedPath(locale, defaultLocale, `/collections/${c.handle}`) : null;
      }
      case "product": {
        const p = lookups.prods.find((x) => x.productId === l.productId);
        return p ? localizedPath(locale, defaultLocale, `/products/${p.handle}`) : null;
      }
      case "entry":
        return entryPaths.get(l.entryId) ?? null;
      case "entry_index": {
        // Only a type that answers /{prefix} itself (an index route or a singleton) has a page to link to.
        const type = routeTypes.find((t) => t.id === l.typeId);
        return type && servesIndexRoute(type) ? typeIndexPath(type, locale, defaultLocale) : null;
      }
    }
  };
  const convert = (items: NavigationItem[]): ResolvedLink[] =>
    items.flatMap((i) => {
      const href = toHref(i);
      if (!href) return [];
      const children = i.children?.length ? convert(i.children) : undefined;
      return [{ label: localizedText(i.label, locale, defaultLocale), href, ...(children?.length ? { children } : {}) }];
    });
  return Object.fromEntries(Object.entries(snapshot.navigation).map(([handle, items]) => [handle, convert(items)]));
}

export async function loadSite(db: Database, ref: StoreRef, req: SiteRequest): Promise<SiteDto | null> {
  const { store, canonicalHost, pageUrlStyle, untranslatedPolicy, verification, modules } = await storeRow(db, ref);
  if (!store) return null;
  const snapshot = await loadSnapshot(db, ref, req.preview);
  if (!snapshot) return null;
  const locale = req.locale && store.supportedLocales.includes(req.locale) ? req.locale : store.defaultLocale;
  const currency = req.currency && store.supportedCurrencies.includes(req.currency) ? req.currency : store.defaultCurrency;
  const now = new Date();
  const { sections } = applySchedule(snapshot.globalSections.sections, now);
  const visible = applySectionPolicy(sections, sectionPolicyFor({ modules }));
  const loaders = siteDataLoaders(db, ref, locale, store.defaultLocale);
  // Global sections bind only site data (identity, locations); they carry no route context.
  const bc: BindingContext = {
    db,
    ref,
    locale,
    defaultLocale: store.defaultLocale,
    timezone: store.timezone,
    lp: (p) => localizedPath(locale, store.defaultLocale, p),
    qctx: null,
    content: modules.includes("content"),
    contentTypes: [],
    live: { locale, defaultLocale: store.defaultLocale, mediaBaseUrl: req.mediaBaseUrl, preview: req.preview, supportedLocales: store.supportedLocales, modules },
    now,
    entry: null,
    expireAt: () => {},
    ...loaders,
  };
  const globalSections = await Promise.all(visible.map(async (s) => toRender(s, await bindSection(s, bc))));
  const businessIdentity = await loaders.identity();
  return {
    storeId: store.id,
    name: store.name,
    status: store.status,
    defaultLocale: store.defaultLocale,
    supportedLocales: store.supportedLocales,
    locale,
    currency,
    countryCode: store.countryCode,
    timezone: store.timezone,
    contentVersion: store.contentVersion,
    canonicalHost: canonicalHost ?? "",
    mediaBaseUrl: req.mediaBaseUrl,
    modules,
    pageUrlStyle,
    verification,
    businessIdentity,
    theme: { settings: snapshot.themeSettings, css: themeCssVariables(snapshot.themeSettings) },
    globalSections,
    menus: await resolveMenus(db, ref, snapshot, {
      locale,
      defaultLocale: store.defaultLocale,
      style: pageUrlStyle,
      modules,
      untranslatedPolicy,
      mediaBaseUrl: req.mediaBaseUrl,
    }),
    assets: await assetMap(db, ref, [
      ...collectAssetIds({ sections: visible }),
      ...dataAssetIds(globalSections.map((s) => s.data)),
      ...[snapshot.themeSettings.brand.logoAssetId, snapshot.themeSettings.brand.faviconAssetId, businessIdentity?.logoAssetId].filter((x): x is string => !!x),
    ]),
    preview: snapshot.mode === "preview",
  };
}

export interface RouteRequest extends SiteRequest {
  /** Path without locale prefix handling applied yet, e.g. "/en/products/shirt". */
  path: string;
  query: Record<string, string | string[] | undefined>;
}

const LISTING_PARAMS = ["sort", "page", "price_min", "price_max", "vendor", "option", "in_stock", "on_sale"] as const;

function first(q: RouteRequest["query"], key: string): string | undefined {
  const v = q[key];
  return Array.isArray(v) ? v[0] : v;
}

function listingQuery(q: RouteRequest["query"], defaultSort: string, currency: string) {
  const page = Math.max(1, Math.min(500, Number.parseInt(first(q, "page") ?? "1", 10) || 1));
  const sortRaw = first(q, "sort");
  const sorts: ListingSort[] = ["manual", "best_selling", "newest", "price_asc", "price_desc", "title_asc", "title_desc", "relevance"];
  const sort = (sorts as string[]).includes(sortRaw ?? "") ? (sortRaw as ListingSort) : (defaultSort as ListingSort);
  // Price filters arrive as decimals typed by shoppers ("149,90").
  const num = (k: string) => {
    const v = first(q, k);
    if (!v) return undefined;
    try {
      return parseMoney(v, currency);
    } catch {
      return undefined;
    }
  };
  const list = (k: string) => {
    const v = q[k];
    return (Array.isArray(v) ? v : v ? [v] : []).flatMap((x) => x.split(",")).filter(Boolean).slice(0, 20);
  };
  const applied: Record<string, string | string[]> = {};
  for (const k of LISTING_PARAMS) if (q[k] !== undefined && k !== "page") applied[k] = q[k] as string | string[];
  return {
    page,
    sort,
    priceMin: num("price_min"),
    priceMax: num("price_max"),
    vendorIds: list("vendor").filter((v) => /^[0-9a-f-]{36}$/.test(v)),
    optionValueLabels: list("option"),
    inStockOnly: first(q, "in_stock") === "1",
    onSaleOnly: first(q, "on_sale") === "1",
    applied,
  };
}

/** Canonical excludes sort/filter params; pagination keeps ?page=N for N > 1. */
function canonicalFor(path: string, page: number): string {
  return page > 1 ? `${path}?page=${page}` : path;
}

/** Query parameter carrying the keyset cursor of entry index pages. */
const ENTRY_CURSOR_PARAM = "after";

type Binder = (s: SectionInstance) => Promise<Record<string, unknown> | null>;

/**
 * Resolves a storefront request through the route table (routes.ts) into the page to render:
 * its sections with their data, SEO fields, alternates, breadcrumbs, the page and cache class
 * of the owning route and the shared cache lifetime.
 */
export async function resolveRoute(db: Database, ref: StoreRef, site: SiteDto, req: RouteRequest): Promise<ResolvedRoute> {
  const snapshot = await loadSnapshot(db, ref, req.preview);
  if (!snapshot) throw new Error("storefront not initialized");
  const channelId = await withTenantTx(db, ref, async (tx) => {
    const channel = await tx.query.channels.findFirst({ where: and(eq(channels.storeId, ref.storeId), eq(channels.isDefault, true)) });
    return channel?.id ?? null;
  });
  const defaultLocale = site.defaultLocale;
  const fullPath = req.path.split("?")[0]!.replace(/\/+$/, "") || "/";
  const { locale, path } = splitLocale(fullPath, site.supportedLocales, defaultLocale);
  const lp = (p: string) => localizedPath(locale, defaultLocale, p);
  const table = await loadRouteTable(db, ref, site.modules);
  const policy: SectionPolicy = sectionPolicyFor({ modules: site.modules });
  const qctx: StorefrontQueryContext = {
    ...ref,
    locale,
    defaultLocale,
    currency: site.currency,
    channelId,
    customerGroupIds: req.customerGroupIds ?? [],
  };
  const catalogOn = site.modules.includes("catalog");
  const now = new Date();
  let ttl = DEFAULT_TTL;
  const expireAt = (at: Date | null) => {
    if (at && at.getTime() > now.getTime()) ttl = Math.max(5, Math.min(ttl, Math.ceil((at.getTime() - now.getTime()) / 1000)));
  };
  const live: LiveReadOptions = {
    locale,
    defaultLocale,
    fallback: table.untranslatedPolicy === "fallback_noindex",
    mediaBaseUrl: req.mediaBaseUrl,
    preview: req.preview,
    // Hreflang alternates only for languages the store still serves; product links only with the catalog.
    supportedLocales: site.supportedLocales,
    modules: site.modules,
  };
  const loaders = siteDataLoaders(db, ref, locale, defaultLocale);
  const binding = (entry: LiveEntryDto | null): BindingContext => ({
    db,
    ref,
    locale,
    defaultLocale,
    timezone: site.timezone,
    lp,
    qctx: catalogOn ? qctx : null,
    content: site.modules.includes("content"),
    contentTypes: table.contentTypes,
    live,
    now,
    entry,
    expireAt,
    ...loaders,
  });
  const bindCommon: Binder = (s) => bindSection(s, binding(null));

  const alternatesFor = (build: (l: string) => string | null, locales: readonly string[] = site.supportedLocales) =>
    Object.fromEntries(
      locales.flatMap((l) => {
        const p = build(l);
        return p ? [[l, localizedPath(l, defaultLocale, p)]] : [];
      }),
    );
  // Page SEO: hreflang only for languages the page is written in; a language that renders the
  // default-language fallback is not indexed. The OG image is the page's SEO image.
  const pageSeo = (page: ResolvedPage, route: ResolvedRoute, pageUrlPath: string, fallbackTitle: string) => {
    const contentLocales = pageContentLocales(page, site.supportedLocales, defaultLocale);
    const imageId = page.seo.imageAssetId;
    return {
      alternates: alternatesFor(() => pageUrlPath, contentLocales),
      seo: {
        ...route.seo,
        title: localizedText(page.seo.title, locale, defaultLocale) || fallbackTitle,
        description: localizedText(page.seo.description, locale, defaultLocale),
        imageObjectKey: imageId ? (route.assets[imageId] ?? null) : null,
        noindex: (page.seo.noindex ?? false) || !contentLocales.includes(locale),
      },
    };
  };

  const home = (): Breadcrumb => ({ name: routeLabel(locale, "home"), path: lp("/") });
  const base = (cls: RouteClass): ResolvedRoute => ({
    kind: "not_found",
    status: 404,
    redirectTo: null,
    locale,
    path: lp(path),
    canonicalPath: lp(path),
    alternates: {},
    seo: { title: site.name, description: "", imageObjectKey: null, noindex: false, ogType: "website", publishedAt: null, modifiedAt: null },
    sections: [],
    product: null,
    collection: null,
    listing: null,
    entry: null,
    entries: null,
    search: null,
    breadcrumbs: [home()],
    assets: {},
    pageClass: cls.pageClass,
    cacheClass: cls.cacheClass,
    cacheTtlSeconds: ttl,
  });
  const redirectTo = (route: ResolvedRoute, to: string, status: 301 | 302 = 301): ResolvedRoute => ({ ...route, kind: "redirect", status, redirectTo: to });

  /** Renders a page's sections (schedule, policy, data) into the route; extra asset ids join the route's asset map. */
  const renderInto = async (page: ResolvedPage, route: ResolvedRoute, bind: Binder, extraAssets: Iterable<string> = []) => {
    const { sections, nextBoundary } = applySchedule(page.content.sections, now);
    if (nextBoundary) expireAt(new Date(nextBoundary));
    const visible = applySectionPolicy(sections, policy);
    route.sections = await Promise.all(visible.map(async (s) => toRender(s, await bind(s))));
    route.assets = await assetMap(db, ref, [
      ...collectAssetIds({ sections: visible }),
      ...dataAssetIds(route.sections.map((s) => s.data)),
      ...(page.seo.imageAssetId ? [page.seo.imageAssetId] : []),
      ...extraAssets,
    ]);
    route.cacheTtlSeconds = ttl;
    return page;
  };
  const renderPage = async (type: string, handle: string, route: ResolvedRoute, bind: Binder) => {
    const page = await resolvePage(db, ref, snapshot, type, handle);
    return page ? renderInto(page, route, bind) : null;
  };
  /**
   * A module page (product, collection, cart, search, not found; live, or the draft in
   * preview). A module turned on after the site was set up has its pages as drafts until they
   * are published: its routes render the built-in default layout meanwhile, never an empty page.
   */
  const modulePage = async (type: ModulePageType): Promise<ResolvedPage> =>
    (await resolvePage(db, ref, snapshot, type, "default")) ?? { id: `default:${type}`, type, handle: "default", title: {}, content: defaultModulePageContent(type), seo: {}, versionId: null };

  /** A template page (live, or the draft in preview); the built-in default layout until one is published. */
  const templatePage = async (templateKey: string): Promise<ResolvedPage | null> => {
    const page = await resolvePage(db, ref, snapshot, "template", templateKey);
    if (page) return page;
    const content: PageContent | null = defaultTemplateContent(templateKey);
    return content ? { id: templateKey, type: "template", handle: templateKey, title: {}, content, seo: {}, versionId: null } : null;
  };

  // --- Module routes -------------------------------------------------------------------

  const homeRoute = async (route: ResolvedRoute): Promise<ResolvedRoute | null> => {
    const page = await renderPage("home", "index", route, bindCommon);
    if (!page) return null;
    return { ...route, kind: "home", status: 200, canonicalPath: lp("/"), ...pageSeo(page, route, "/", site.name), breadcrumbs: [] };
  };

  /** A content or landing page by handle, served at its URL for the store's page URL style. */
  const contentPage = async (route: ResolvedRoute, handle: string): Promise<ResolvedRoute | null> => {
    for (const type of ["page", "landing"] as const) {
      const page = await renderPage(type, handle, route, bindCommon);
      if (!page) continue;
      const own = pagePath(type, page.handle, table.pageUrlStyle)!;
      const title = localizedText(page.title, locale, defaultLocale);
      return {
        ...route,
        kind: type,
        status: 200,
        canonicalPath: page.seo.canonicalPath ? lp(page.seo.canonicalPath) : lp(own),
        ...pageSeo(page, route, own, title),
        breadcrumbs: [home(), { name: title, path: lp(own) }],
      };
    }
    return null;
  };

  /** Whether a live (or, in preview, drafted) page or landing uses a handle. */
  const pageExists = async (handle: string) =>
    Boolean((await resolvePage(db, ref, snapshot, "page", handle)) ?? (await resolvePage(db, ref, snapshot, "landing", handle)));

  const pagesRoute = async (route: ResolvedRoute, rest: string[]): Promise<ResolvedRoute | null> => {
    if (rest.length !== 1) return null;
    const handle = decodeURIComponent(rest[0]!);
    // Root style serves pages at /{handle}; the old /pages/{handle} URL moves there.
    if (table.pageUrlStyle === "root") return (await pageExists(handle)) ? redirectTo(route, lp(`/${handle}`)) : null;
    return contentPage(route, handle);
  };

  const productRoute = async (route: ResolvedRoute, rest: string[]): Promise<ResolvedRoute | null> => {
    if (rest.length !== 1) return null;
    const found = await getStorefrontProduct(db, qctx, decodeURIComponent(rest[0]!));
    if (found && "redirectHandle" in found) return redirectTo(route, lp(`/products/${found.redirectHandle}`));
    if (!found) return null;
    const product = found.product;
    await renderInto(await modulePage("product"), route, async (s) => (s.type === "product-main" ? { product } : bindCommon(s)));
    const crumbs: Breadcrumb[] = [home()];
    if (product.categoryId) {
      const trail = await withTenantTx(db, ref, async (tx) => {
        const out: Breadcrumb[] = [];
        let id: string | null = product.categoryId;
        for (let depth = 0; id && depth < 6; depth++) {
          const c: typeof categories.$inferSelect | undefined = await tx.query.categories.findFirst({ where: eq(categories.id, id) });
          if (!c) break;
          out.unshift({ name: localizedText(c.name, locale, defaultLocale), path: lp(`/collections/all?category=${c.handle}`) });
          id = c.parentId;
        }
        return out;
      });
      crumbs.push(...trail);
    }
    crumbs.push({ name: product.title, path: lp(`/products/${product.handle}`) });
    return {
      ...route,
      kind: "product",
      status: 200,
      product,
      canonicalPath: lp(`/products/${product.handle}`),
      alternates: Object.fromEntries(Object.entries(product.alternateHandles).map(([l, h]) => [l, localizedPath(l, defaultLocale, `/products/${h}`)])),
      seo: {
        ...route.seo,
        title: product.seoTitle || product.title,
        description: product.seoDescription || product.descriptionHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160),
        imageObjectKey: product.media[0]?.objectKey ?? null,
        noindex: false,
        ogType: "product",
      },
      breadcrumbs: crumbs,
      // Stock and price change often; keep product pages fresher.
      cacheTtlSeconds: Math.min(route.cacheTtlSeconds, 60),
    };
  };

  const collectionRoute = async (route: ResolvedRoute, rest: string[]): Promise<ResolvedRoute | null> => {
    if (rest.length !== 1) return null;
    const h = decodeURIComponent(rest[0]!);
    const col = h === "all" ? null : await getStorefrontCollection(db, qctx, h);
    if (h !== "all" && !col) return null;
    const lq = listingQuery(req.query, col ? (col.sortOrder === "manual" ? "manual" : col.sortOrder) : "newest", site.currency);
    const tmpl = await modulePage("collection");
    const main = tmpl.content.sections.find((s) => s.type === "collection-main");
    const pageSize = Math.min(PAGE_SIZE_MAX, Number((main?.props as Record<string, unknown> | undefined)?.productsPerPage ?? 24));
    const res = await listStorefrontProducts(db, qctx, {
      ...(col ? { collectionId: col.id } : {}),
      sort: lq.sort,
      limit: pageSize,
      offset: (lq.page - 1) * pageSize,
      ...(lq.priceMin !== undefined ? { priceMin: lq.priceMin } : {}),
      ...(lq.priceMax !== undefined ? { priceMax: lq.priceMax } : {}),
      vendorIds: lq.vendorIds,
      optionValueLabels: lq.optionValueLabels,
      inStockOnly: lq.inStockOnly,
      onSaleOnly: lq.onSaleOnly,
    });
    const listing: ListingDto = { items: res.items, total: res.total, page: lq.page, pageSize, sort: lq.sort, appliedFilters: lq.applied };
    await renderInto(tmpl, route, async (s) => (s.type === "collection-main" ? { listing, collection: col } : bindCommon(s)));
    const title = col?.title ?? routeLabel(locale, "allProducts");
    const collectionPath = lp(`/collections/${col?.handle ?? "all"}`);
    return {
      ...route,
      kind: "collection",
      status: 200,
      collection: col,
      listing,
      canonicalPath: canonicalFor(collectionPath, lq.page),
      alternates: col
        ? Object.fromEntries(Object.entries(col.alternateHandles).map(([l, hh]) => [l, localizedPath(l, defaultLocale, `/collections/${hh}`)]))
        : alternatesFor(() => "/collections/all"),
      seo: {
        ...route.seo,
        title: (col?.seoTitle || title) + (lq.page > 1 ? ` – ${lq.page}` : ""),
        description: col?.seoDescription || (col?.descriptionHtml ?? "").replace(/<[^>]+>/g, " ").trim().slice(0, 160),
        imageObjectKey: col?.imageObjectKey ?? null,
        // Filtered/sorted variants are not indexed; the canonical points to the clean listing.
        noindex: Object.keys(lq.applied).length > 0,
      },
      breadcrumbs: [home(), { name: title, path: collectionPath }],
    };
  };

  const searchRoute = async (route: ResolvedRoute): Promise<ResolvedRoute> => {
    const q = (first(req.query, "q") ?? "").slice(0, 200);
    const lq = listingQuery(req.query, "relevance", site.currency);
    const pageSize = 24;
    // Search looks through the catalog; a site without one has nothing to find there.
    const res =
      q && catalogOn
        ? await listStorefrontProducts(db, qctx, { search: q, sort: lq.sort, limit: pageSize, offset: (lq.page - 1) * pageSize })
        : { items: [], total: 0 };
    const listing: ListingDto = { items: res.items, total: res.total, page: lq.page, pageSize, sort: lq.sort, appliedFilters: lq.applied };
    await renderInto(await modulePage("search"), route, async (s) => (s.type === "search-main" ? { listing, query: q } : bindCommon(s)));
    return {
      ...route,
      kind: "search",
      status: 200,
      listing,
      search: { query: q },
      canonicalPath: lp("/search"),
      alternates: alternatesFor(() => "/search"),
      seo: { ...route.seo, title: q ? `${q} – ${site.name}` : site.name, noindex: true },
      cacheTtlSeconds: 60,
    };
  };

  /** Cart: rendered client-side; the page provides layout sections only. */
  const cartRoute = async (route: ResolvedRoute): Promise<ResolvedRoute> => {
    await renderInto(await modulePage("cart"), route, bindCommon);
    return { ...route, kind: "cart", status: 200, canonicalPath: lp("/cart"), seo: { ...route.seo, noindex: true }, cacheTtlSeconds: 0 };
  };

  const moduleRoute = async (match: Extract<RouteMatch, { kind: "module" }>, route: ResolvedRoute): Promise<ResolvedRoute | null> => {
    switch (match.route.id) {
      case "core.home":
        return homeRoute(route);
      case "core.pages":
        return pagesRoute(route, match.rest);
      case "core.search":
        return searchRoute(route);
      case "catalog.products":
        return productRoute(route, match.rest);
      case "catalog.collections":
        return collectionRoute(route, match.rest);
      case "commerce.cart":
        return cartRoute(route);
      default:
        // Routes served by their own app pages (checkout) have nothing to resolve here.
        return null;
    }
  };

  // --- Content routes ------------------------------------------------------------------

  const typeName = (type: ContentRouteType, plural: boolean) => localizedText(plural ? type.labels.namePlural : type.labels.name, locale, defaultLocale);
  const indexPathOf = (type: ContentRouteType) =>
    type.kind === "collection" && (type.settings.indexMode ?? "auto") === "auto" ? typeIndexPath(type, locale, defaultLocale) : null;

  /** Home › index › parent › entry. */
  const entryCrumbs = (type: ContentRouteType, entry: LiveEntryDto): Breadcrumb[] => {
    const out: Breadcrumb[] = [home()];
    const index = indexPathOf(type);
    if (index) out.push({ name: typeName(type, true), path: index });
    if (entry.parent?.path) out.push({ name: entry.parent.title, path: entry.parent.path });
    if (entry.path) out.push({ name: entry.title, path: entry.path });
    return out;
  };

  const entryRoute = async (type: ContentRouteType, entry: LiveEntryDto, route: ResolvedRoute): Promise<ResolvedRoute | null> => {
    const page = await templatePage(entryTemplateKey(type.key, "detail"));
    if (!page) return null;
    const bc = binding(entry);
    await renderInto(page, route, (s) => bindSection(s, bc), Object.keys(entry.assets));
    // The page changes on its own at a scheduled update or take-down of the entry.
    expireAt(await nextScheduleBoundary(db, ref, { entryIds: [entry.id] }, now));
    const imageKey = entry.seo.imageAssetId ? (entry.assets[entry.seo.imageAssetId]?.objectKey ?? route.assets[entry.seo.imageAssetId] ?? null) : null;
    const date = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
    return {
      ...route,
      kind: "entry",
      status: 200,
      entry,
      canonicalPath: entry.seo.canonicalPath ?? entry.path ?? lp(path),
      // hreflang only for the languages the entry is published in.
      alternates: entry.alternates,
      seo: {
        title: entry.seo.title || entry.title,
        description: entry.seo.description,
        imageObjectKey: imageKey,
        noindex: entry.seo.noindex,
        ogType: type.kind === "singleton" ? "website" : "article",
        publishedAt: date(entry.firstPublishedAt ?? entry.liveFrom),
        modifiedAt: date(entry.contentModifiedAt ?? entry.firstPublishedAt ?? entry.liveFrom),
      },
      breadcrumbs: entryCrumbs(type, entry),
      cacheTtlSeconds: ttl,
    };
  };

  /** One keyset page of a type's live entries (optionally of one taxonomy term), for entry-index-main. */
  const entryListing = async (type: ContentRouteType, term: LiveEntryDto | null, props: Record<string, unknown>): Promise<EntryListingDto> => {
    const cursor = first(req.query, ENTRY_CURSOR_PARAM)?.slice(0, 500) || null;
    const sortProp = String(props.sort ?? "default");
    const sort = (ENTRY_LIST_SORTS as readonly string[]).includes(sortProp) && sortProp !== "default" ? (sortProp as LiveEntrySort) : undefined;
    const taxonomyTypes = type.taxonomies.filter((t) => t.taxonomyTypeId);
    const [page, boundary, taxonomies] = await Promise.all([
      listLiveEntries(db, ref, { ...live, type: type.id, terms: term ? [term.id] : undefined, sort, limit: Number(props.perPage ?? 12), cursor: cursor ?? undefined }),
      nextScheduleBoundary(db, ref, { types: [type.id, ...taxonomyTypes.map((t) => t.taxonomyTypeId!)] }, now),
      props.termFilters === false
        ? Promise.resolve([])
        : Promise.all(
            taxonomyTypes.map(async (t) => {
              const terms = await listLiveEntries(db, ref, { ...live, type: t.taxonomyTypeId!, archiveOf: type.id, limit: 48 });
              return {
                field: t.field,
                label: t.labels ? localizedText(t.labels.namePlural, locale, defaultLocale) : t.typeKey,
                terms: terms.items.flatMap((e) => (e.path ? [{ id: e.id, title: e.title, path: e.path }] : [])),
              };
            }),
          ),
    ]);
    expireAt(boundary);
    return {
      type: { id: type.id, key: type.key, name: typeName(type, false), namePlural: typeName(type, true), indexPath: indexPathOf(type) },
      term,
      items: page.items,
      cursor,
      nextCursor: page.nextCursor,
      sort: sort ?? "default",
      taxonomies: taxonomies.filter((t) => t.terms.length),
    };
  };

  /** Index of a type (term = null) or a taxonomy archive, rendered with the type's index template. */
  const indexRoute = async (type: ContentRouteType, term: LiveEntryDto | null, route: ResolvedRoute): Promise<ResolvedRoute | null> => {
    const page = await templatePage(entryTemplateKey(type.key, "index"));
    if (!page) return null;
    const main = page.content.sections.find((s) => s.type === "entry-index-main");
    let listing: EntryListingDto;
    // The type index is written in the languages its entries are published in, and always in
    // the default language: other languages are neither advertised (hreflang) nor indexed.
    // A term archive follows the term's own languages.
    const indexLocalesOf = async () => {
      const written = new Set([defaultLocale, ...(await liveTypeLocales(db, ref, type.id))]);
      return site.supportedLocales.filter((l) => written.has(l));
    };
    let indexLocales: string[] = [];
    try {
      [listing, indexLocales] = await Promise.all([entryListing(type, term, main?.props ?? {}), term ? Promise.resolve([]) : indexLocalesOf()]);
    } catch (err) {
      // A tampered or outdated cursor: the page does not exist.
      if (err instanceof AppError && err.messageKey === "errors.content.invalid_cursor") return null;
      throw err;
    }
    await renderInto(page, route, async (s) => (s.type === "entry-index-main" ? { listing } : bindCommon(s)), term ? Object.keys(term.assets) : []);
    const indexPath = indexPathOf(type);
    const ownPath = term?.path ?? indexPath ?? lp(path);
    const canonicalPath = listing.cursor ? `${ownPath}?${ENTRY_CURSOR_PARAM}=${encodeURIComponent(listing.cursor)}` : ownPath;
    const title = term ? term.seo.title || term.title : typeName(type, true);
    const crumbs: Breadcrumb[] = [home()];
    if (indexPath) crumbs.push({ name: typeName(type, true), path: indexPath });
    if (term?.path) crumbs.push({ name: term.title, path: term.path });
    const imageKey = term?.seo.imageAssetId ? (term.assets[term.seo.imageAssetId]?.objectKey ?? null) : null;
    return {
      ...route,
      kind: term ? "taxonomy" : "entry_index",
      status: 200,
      entries: listing,
      canonicalPath,
      alternates: term
        ? term.alternates
        : alternatesFor((l) => {
            const p = type.routePrefix[l] ?? type.routePrefix.en ?? Object.values(type.routePrefix)[0];
            return p ? `/${p}` : null;
          }, indexLocales),
      seo: {
        ...route.seo,
        title,
        description: term ? term.seo.description : "",
        imageObjectKey: imageKey,
        noindex: term ? (term.seo.noindex ?? false) : !indexLocales.includes(locale),
      },
      breadcrumbs: crumbs,
      cacheTtlSeconds: ttl,
    };
  };

  const contentRoute = async (m: ContentRouteMatch, route: ResolvedRoute): Promise<ResolvedRoute | null> => {
    switch (m.kind) {
      case "index":
        return indexRoute(m.type, null, route);
      case "singleton": {
        const entry = await resolveSingleton(db, ref, { ...live, type: m.type.id });
        return entry ? entryRoute(m.type, entry, route) : null;
      }
      case "entry": {
        const found = await resolveEntryBySlug(db, ref, { ...live, type: m.type.id, slug: decodeURIComponent(m.slug) });
        if (!found) return null;
        if (found.kind === "moved") return redirectTo(route, found.path);
        return entryRoute(m.type, found.entry, route);
      }
      case "term_index": {
        // The archive segment alone has no page of its own: it leads to the type index.
        const index = indexPathOf(m.type);
        return index ? redirectTo(route, index) : null;
      }
      case "term": {
        if (!m.taxonomy.taxonomyTypeId) return null;
        const found = await resolveEntryBySlug(db, ref, { ...live, type: m.taxonomy.taxonomyTypeId, slug: decodeURIComponent(m.slug), archiveOf: m.type.id });
        if (!found) return null;
        if (found.kind === "moved") return redirectTo(route, found.path);
        return indexRoute(m.type, found.entry, route);
      }
    }
  };

  // --- Root-level pages ----------------------------------------------------------------

  const rootPage = async (handle: string, route: ResolvedRoute): Promise<ResolvedRoute | null> => {
    if (table.pageUrlStyle === "root") return contentPage(route, handle);
    // Prefixed style: a page's root URL (from a time the store served pages at the root) moves to /pages/{handle}.
    return (await pageExists(handle)) ? redirectTo(route, lp(`/pages/${handle}`)) : null;
  };

  // --- Resolution ----------------------------------------------------------------------

  const match = matchRoute(table, locale, path);
  const route = base(match);
  let resolved: ResolvedRoute | null = null;
  if (match.kind === "module") resolved = await moduleRoute(match, route);
  else if (match.kind === "content") resolved = await contentRoute(match.match, route);
  else if (match.kind === "root_page") resolved = await rootPage(match.handle, route);
  if (resolved) return resolved;

  // Redirects (manual, slug and prefix changes): the exact rule, else the longest prefix rule.
  const fallback = base(DEFAULT_ROUTE_CLASS);
  const redirect = await findRedirect(db, ref, fullPath);
  if (redirect?.toPath) return redirectTo(fallback, redirect.toPath, redirect.statusCode === 302 ? 302 : 301);
  // Page handles are shared by every language, so their slug-change 301s are stored once,
  // without a language prefix; they apply under each prefix too.
  const isPagePath = path.startsWith("/pages/") || (table.pageUrlStyle === "root" && match.kind === "root_page");
  if (!redirect && locale !== defaultLocale && isPagePath) {
    const moved = await findRedirect(db, ref, path);
    if (moved?.source === "slug_change" && moved.toPath?.startsWith("/")) return redirectTo(fallback, lp(moved.toPath));
  }
  await renderInto(await modulePage("not_found"), fallback, bindCommon);
  // 410: removed on purpose (a prefix or entry taken down for good); the not-found page renders.
  return { ...fallback, status: redirect?.statusCode === 410 ? 410 : 404, seo: { ...fallback.seo, noindex: true }, cacheTtlSeconds: 60 };
}

export type { RouteTable };
