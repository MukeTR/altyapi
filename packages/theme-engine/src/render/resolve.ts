import {
  getStorefrontCollection,
  getStorefrontCollectionsByIds,
  getStorefrontProduct,
  listStorefrontProducts,
  localizedPath,
  parseMoney,
  type ListingSort,
  type StorefrontQueryContext,
} from "@altyapi/catalog";
import {
  and,
  categories,
  channels,
  collectionTranslations,
  contentAssets,
  eq,
  isNull,
  inArray,
  pageVersions,
  productTranslations,
  storeDomains,
  stores,
  withTenantTx,
  type Database,
  type NavigationItem,
  type SectionInstance,
} from "@altyapi/database";
import { getSectionDefinition } from "../sections/definitions";
import { collectAssetIds } from "../validation";
import { themeCssVariables } from "../theme-settings";
import { findRedirect, loadLiveSnapshot, loadPreviewSnapshot, pageContentLocales, resolvePage, type ResolvedPage, type StorefrontSnapshot } from "../live";
import type { Breadcrumb, ListingDto, RenderSection, ResolvedLink, ResolvedRoute, SiteDto } from "./types";
import { routeLabel } from "./labels";

export interface StoreRef {
  organizationId: string;
  storeId: string;
}

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

/** Maps referenced asset ids to object keys (only ready, non-deleted assets of this store). */
async function assetMap(db: Database, ref: StoreRef, ids: string[]): Promise<Record<string, string>> {
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

async function storeRow(db: Database, ref: StoreRef) {
  return withTenantTx(db, ref, async (tx) => {
    const store = await tx.query.stores.findFirst({ where: eq(stores.id, ref.storeId) });
    const canonical = await tx.query.storeDomains.findFirst({
      where: and(eq(storeDomains.storeId, ref.storeId), eq(storeDomains.isCanonical, true), eq(storeDomains.status, "active")),
    });
    const channel = await tx.query.channels.findFirst({ where: and(eq(channels.storeId, ref.storeId), eq(channels.isDefault, true)) });
    return { store, canonicalHost: canonical?.hostname ?? null, channelId: channel?.id ?? null };
  });
}

/** Resolves navigation links (page/collection/product references) into localized paths. */
async function resolveMenus(
  db: Database,
  ref: StoreRef,
  snapshot: StorefrontSnapshot,
  locale: string,
  defaultLocale: string,
): Promise<Record<string, ResolvedLink[]>> {
  const pageIds = new Set<string>();
  const collectionIds = new Set<string>();
  const productIds = new Set<string>();
  const walk = (items: NavigationItem[]) =>
    items.forEach((i) => {
      if (i.link.type === "page") pageIds.add(i.link.pageId);
      if (i.link.type === "collection") collectionIds.add(i.link.collectionId);
      if (i.link.type === "product") productIds.add(i.link.productId);
      if (i.children) walk(i.children);
    });
  Object.values(snapshot.navigation).forEach(walk);

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
      case "url":
        return l.url.startsWith("/") ? localizedPath(locale, defaultLocale, l.url) : l.url;
      case "home":
        return localizedPath(locale, defaultLocale, "/");
      case "search":
        return localizedPath(locale, defaultLocale, "/search");
      case "cart":
        return localizedPath(locale, defaultLocale, "/cart");
      case "page": {
        const p = lookups.pv.find((x) => x.pageId === l.pageId);
        return p ? localizedPath(locale, defaultLocale, p.type === "home" ? "/" : `/pages/${p.handle}`) : null;
      }
      case "collection": {
        const c = lookups.cols.find((x) => x.collectionId === l.collectionId);
        return c ? localizedPath(locale, defaultLocale, `/collections/${c.handle}`) : null;
      }
      case "product": {
        const p = lookups.prods.find((x) => x.productId === l.productId);
        return p ? localizedPath(locale, defaultLocale, `/products/${p.handle}`) : null;
      }
    }
  };
  const convert = (items: NavigationItem[]): ResolvedLink[] =>
    items.flatMap((i) => {
      const href = toHref(i);
      if (!href) return []; // unpublished targets are hidden instead of producing broken links
      const children = i.children?.length ? convert(i.children) : undefined;
      return [{ label: localizedText(i.label, locale, defaultLocale), href, ...(children?.length ? { children } : {}) }];
    });
  return Object.fromEntries(Object.entries(snapshot.navigation).map(([handle, items]) => [handle, convert(items)]));
}

export async function loadSite(db: Database, ref: StoreRef, req: SiteRequest): Promise<SiteDto | null> {
  const { store, canonicalHost } = await storeRow(db, ref);
  if (!store) return null;
  const snapshot = await loadSnapshot(db, ref, req.preview);
  if (!snapshot) return null;
  const locale = req.locale && store.supportedLocales.includes(req.locale) ? req.locale : store.defaultLocale;
  const currency = req.currency && store.supportedCurrencies.includes(req.currency) ? req.currency : store.defaultCurrency;
  const { sections } = applySchedule(snapshot.globalSections.sections, new Date());
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
    theme: { settings: snapshot.themeSettings, css: themeCssVariables(snapshot.themeSettings) },
    globalSections: sections.map((s) => toRender(s, null)),
    menus: await resolveMenus(db, ref, snapshot, locale, store.defaultLocale),
    assets: await assetMap(db, ref, [
      ...collectAssetIds({ sections }),
      ...[snapshot.themeSettings.brand.logoAssetId, snapshot.themeSettings.brand.faviconAssetId].filter((x): x is string => !!x),
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

export async function resolveRoute(db: Database, ref: StoreRef, site: SiteDto, req: RouteRequest): Promise<ResolvedRoute> {
  const snapshot = await loadSnapshot(db, ref, req.preview);
  if (!snapshot) throw new Error("storefront not initialized");
  const { channelId } = await storeRow(db, ref);
  const defaultLocale = site.defaultLocale;

  // Locale prefix: "/en/…" for non-default locales.
  let path = req.path.split("?")[0]!.replace(/\/+$/, "") || "/";
  let locale = defaultLocale;
  const seg = path.split("/")[1];
  if (seg && seg !== defaultLocale && site.supportedLocales.includes(seg)) {
    locale = seg;
    path = path.slice(seg.length + 1) || "/";
  }
  const lp = (p: string) => localizedPath(locale, defaultLocale, p);
  const qctx: StorefrontQueryContext = {
    ...ref,
    locale,
    defaultLocale,
    currency: site.currency,
    channelId,
    customerGroupIds: req.customerGroupIds ?? [],
  };
  const now = new Date();
  let ttl = DEFAULT_TTL;
  const alternatesFor = (build: (l: string) => string | null, locales: readonly string[] = site.supportedLocales) =>
    Object.fromEntries(locales.flatMap((l) => {
      const p = build(l);
      return p ? [[l, localizedPath(l, defaultLocale, p)]] : [];
    }));
  // Page SEO: hreflang only for languages the page is written in; a language that renders the
  // default-language fallback is not indexed. The OG image is the page's SEO image.
  const pageSeo = (page: ResolvedPage, route: ResolvedRoute, pageUrlPath: string, fallbackTitle: string) => {
    const contentLocales = pageContentLocales(page, site.supportedLocales, defaultLocale);
    const imageId = page.seo.imageAssetId;
    return {
      alternates: alternatesFor(() => pageUrlPath, contentLocales),
      seo: {
        title: localizedText(page.seo.title, locale, defaultLocale) || fallbackTitle,
        description: localizedText(page.seo.description, locale, defaultLocale),
        imageObjectKey: imageId ? (route.assets[imageId] ?? null) : null,
        noindex: (page.seo.noindex ?? false) || !contentLocales.includes(locale),
      },
    };
  };

  const base = (): ResolvedRoute => ({
    kind: "not_found",
    status: 404,
    redirectTo: null,
    locale,
    path: lp(path),
    canonicalPath: lp(path),
    alternates: {},
    seo: { title: site.name, description: "", imageObjectKey: null, noindex: false },
    sections: [],
    product: null,
    collection: null,
    listing: null,
    search: null,
    breadcrumbs: [{ name: routeLabel(locale, "home"), path: lp("/") }],
    assets: {},
    cacheTtlSeconds: ttl,
  });

  const renderPage = async (type: string, handle: string, route: ResolvedRoute, bind: (s: SectionInstance) => Promise<Record<string, unknown> | null>) => {
    const page = await resolvePage(db, ref, snapshot, type, handle);
    if (!page) return null;
    const { sections, nextBoundary } = applySchedule(page.content.sections, now);
    if (nextBoundary) ttl = Math.max(5, Math.min(ttl, Math.ceil((nextBoundary - now.getTime()) / 1000)));
    route.sections = await Promise.all(sections.map(async (s) => toRender(s, await bind(s))));
    route.assets = await assetMap(db, ref, [...collectAssetIds({ sections }), ...(page.seo.imageAssetId ? [page.seo.imageAssetId] : [])]);
    route.cacheTtlSeconds = ttl;
    return page;
  };

  // Section data bindings shared by all page types.
  const bindCommon = async (s: SectionInstance): Promise<Record<string, unknown> | null> => {
    const p = s.props as Record<string, unknown>;
    switch (s.type) {
      case "product-grid": {
        const source = String(p.source ?? "newest");
        const limit = Number(p.limit ?? 12);
        const q =
          source === "collection" && p.collectionId
            ? { collectionId: String(p.collectionId), limit }
            : source === "tag" && p.tag
              ? { tag: String(p.tag), limit }
              : source === "manual"
                ? { productIds: (p.productIds as string[]) ?? [], limit }
                : source === "on_sale"
                  ? { onSaleOnly: true, limit, sort: "newest" as const }
                  : { limit, sort: "newest" as const };
        const res = await listStorefrontProducts(db, qctx, q);
        if (source === "manual") {
          const order = (p.productIds as string[]) ?? [];
          res.items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        }
        return { products: res.items };
      }
      case "featured-collection": {
        if (!p.collectionId) return { collection: null, products: [] };
        const [col] = await getStorefrontCollectionsByIds(db, qctx, [String(p.collectionId)]);
        if (!col) return { collection: null, products: [] };
        const res = await listStorefrontProducts(db, qctx, { collectionId: col.id, limit: Number(p.productLimit ?? 8) });
        return { collection: { ...col, path: lp(`/collections/${col.handle}`) }, products: res.items };
      }
      case "category-cards": {
        const ids = (s.blocks ?? []).map((b) => String(b.props.collectionId));
        const cols = await getStorefrontCollectionsByIds(db, qctx, ids);
        return { collections: Object.fromEntries(cols.map((c) => [c.id, { ...c, path: lp(`/collections/${c.handle}`) }])) };
      }
      default:
        return null;
    }
  };

  // --- Home
  if (path === "/") {
    const route = base();
    const page = await renderPage("home", "index", route, bindCommon);
    if (!page) return route;
    return {
      ...route,
      kind: "home",
      status: 200,
      canonicalPath: lp("/"),
      ...pageSeo(page, route, "/", site.name),
      breadcrumbs: [],
    };
  }

  const [, kind, handle, ...rest] = path.split("/");
  const route = base();

  // --- Product
  if (kind === "products" && handle && !rest.length) {
    const found = await getStorefrontProduct(db, qctx, decodeURIComponent(handle));
    if (found && "redirectHandle" in found) return { ...route, kind: "redirect", status: 301, redirectTo: lp(`/products/${found.redirectHandle}`) };
    if (found) {
      const product = found.product;
      await renderPage("product", "default", route, async (s) => (s.type === "product-main" ? { product } : bindCommon(s)));
      const crumbs: Breadcrumb[] = [route.breadcrumbs[0]!];
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
          title: product.seoTitle || product.title,
          description: product.seoDescription || product.descriptionHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160),
          imageObjectKey: product.media[0]?.objectKey ?? null,
          noindex: false,
        },
        breadcrumbs: crumbs,
        // Stock and price change often; keep product pages fresher.
        cacheTtlSeconds: Math.min(route.cacheTtlSeconds, 60),
      };
    }
  }

  // --- Collection (+ "all")
  if (kind === "collections" && handle && !rest.length) {
    const h = decodeURIComponent(handle);
    const col = h === "all" ? null : await getStorefrontCollection(db, qctx, h);
    if (h === "all" || col) {
      const lq = listingQuery(req.query, col ? (col.sortOrder === "manual" ? "manual" : col.sortOrder) : "newest", site.currency);
      const pageSize = await (async () => {
        const tmpl = await resolvePage(db, ref, snapshot, "collection", "default");
        const main = tmpl?.content.sections.find((s) => s.type === "collection-main");
        return Math.min(PAGE_SIZE_MAX, Number((main?.props as Record<string, unknown> | undefined)?.productsPerPage ?? 24));
      })();
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
      await renderPage("collection", "default", route, async (s) => (s.type === "collection-main" ? { listing, collection: col } : bindCommon(s)));
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
          title: (col?.seoTitle || title) + (lq.page > 1 ? ` – ${lq.page}` : ""),
          description: col?.seoDescription || (col?.descriptionHtml ?? "").replace(/<[^>]+>/g, " ").trim().slice(0, 160),
          imageObjectKey: col?.imageObjectKey ?? null,
          // Filtered/sorted variants are not indexed; the canonical points to the clean listing.
          noindex: Object.keys(lq.applied).length > 0,
        },
        breadcrumbs: [route.breadcrumbs[0]!, { name: title, path: collectionPath }],
      };
    }
  }

  // --- Content & landing pages
  if (kind === "pages" && handle && !rest.length) {
    const h = decodeURIComponent(handle);
    for (const type of ["page", "landing"] as const) {
      const page = await renderPage(type, h, route, bindCommon);
      if (page) {
        const title = localizedText(page.title, locale, defaultLocale);
        return {
          ...route,
          kind: type,
          status: 200,
          canonicalPath: page.seo.canonicalPath ? lp(page.seo.canonicalPath) : lp(`/pages/${page.handle}`),
          ...pageSeo(page, route, `/pages/${page.handle}`, title),
          breadcrumbs: [route.breadcrumbs[0]!, { name: title, path: lp(`/pages/${page.handle}`) }],
        };
      }
    }
  }

  // --- Search
  if (kind === "search" && !handle) {
    const q = (first(req.query, "q") ?? "").slice(0, 200);
    const lq = listingQuery(req.query, "relevance", site.currency);
    const pageSize = 24;
    const res = q
      ? await listStorefrontProducts(db, qctx, { search: q, sort: lq.sort, limit: pageSize, offset: (lq.page - 1) * pageSize })
      : { items: [], total: 0 };
    const listing: ListingDto = { items: res.items, total: res.total, page: lq.page, pageSize, sort: lq.sort, appliedFilters: lq.applied };
    await renderPage("search", "default", route, async (s) => (s.type === "search-main" ? { listing, query: q } : bindCommon(s)));
    return {
      ...route,
      kind: "search",
      status: 200,
      listing,
      search: { query: q },
      canonicalPath: lp("/search"),
      alternates: alternatesFor(() => "/search"),
      seo: { title: q ? `${q} – ${site.name}` : site.name, description: "", imageObjectKey: null, noindex: true },
      cacheTtlSeconds: 60,
    };
  }

  // --- Cart (rendered client-side; the page provides layout sections only)
  if (kind === "cart" && !handle) {
    await renderPage("cart", "default", route, bindCommon);
    return { ...route, kind: "cart", status: 200, canonicalPath: lp("/cart"), seo: { ...route.seo, noindex: true }, cacheTtlSeconds: 0 };
  }

  // --- Redirects (manual or from slug changes), then 404
  const redirect = await findRedirect(db, ref, req.path.split("?")[0]!.replace(/\/+$/, "") || "/");
  if (redirect) return { ...route, kind: "redirect", status: redirect.statusCode === 302 ? 302 : 301, redirectTo: redirect.toPath };
  // Page handles are shared by every language, so their slug-change 301s are stored once,
  // without a language prefix; they apply under each prefix too.
  if (locale !== defaultLocale && kind === "pages") {
    const moved = await findRedirect(db, ref, path);
    if (moved?.source === "slug_change" && moved.toPath.startsWith("/")) return { ...route, kind: "redirect", status: 301, redirectTo: lp(moved.toPath) };
  }
  await renderPage("not_found", "default", route, bindCommon);
  return { ...route, seo: { ...route.seo, noindex: true }, cacheTtlSeconds: 60 };
}
