import type { CollectionDto, ProductCardDto, ProductDetailDto } from "@altyapi/catalog";
import type { LiveEntryCard, LiveEntryDto } from "@altyapi/content";
import type { SectionInstance, VisibilityRules } from "@altyapi/database";
import type { ModuleKey, PageClass, PageUrlStyle, RouteCacheClass } from "@altyapi/site";
import type { ThemeSettings } from "../theme-settings";
import type { PublicBusinessIdentity } from "./site-data";

export type { PublicBusinessIdentity, PublicLocation } from "./site-data";

export interface ResolvedLink {
  label: string;
  href: string;
  children?: ResolvedLink[];
}

export interface RenderSection {
  id: string;
  type: string;
  renderer: string;
  props: Record<string, unknown>;
  settings: SectionInstance["settings"];
  /** Client-evaluated rules (device, route, UTM, referrer, segment); schedules are applied server-side. */
  visibility: VisibilityRules | null;
  blocks: { id: string; type: string; props: Record<string, unknown> }[];
  data: Record<string, unknown> | null;
}

export interface SiteDto {
  storeId: string;
  name: string;
  status: string;
  defaultLocale: string;
  supportedLocales: string[];
  locale: string;
  currency: string;
  countryCode: string;
  timezone: string;
  contentVersion: number;
  canonicalHost: string;
  mediaBaseUrl: string | null;
  /** Active capability modules (core included); the storefront shows cart and checkout only with commerce. */
  modules: ModuleKey[];
  /** prefixed: pages under /pages/{handle}; root: pages at /{handle}. */
  pageUrlStyle: PageUrlStyle;
  /**
   * Search-console ownership tokens as <meta name> → content (google-site-verification,
   * msvalidate.01, yandex-verification…), emitted in the head of every page.
   */
  verification: Record<string, string>;
  /** Public business identity (imprint, contact facts); null until the merchant fills it in. */
  businessIdentity: PublicBusinessIdentity | null;
  theme: { settings: ThemeSettings; css: string };
  globalSections: RenderSection[];
  menus: Record<string, ResolvedLink[]>;
  /** assetId → objectKey for every ready asset referenced by global sections and brand settings. */
  assets: Record<string, string>;
  preview: boolean;
}

export type RouteKind =
  | "home"
  | "page"
  | "landing"
  | "product"
  | "collection"
  | "search"
  | "cart"
  | "entry"
  | "entry_index"
  | "taxonomy"
  | "not_found"
  | "redirect";

export interface Breadcrumb {
  name: string;
  path: string;
}

export interface ListingDto {
  items: ProductCardDto[];
  total: number;
  page: number;
  pageSize: number;
  sort: string;
  appliedFilters: Record<string, string | string[]>;
}

/** A taxonomy term the index can be filtered by (its archive page). */
export interface EntryTermLink {
  id: string;
  title: string;
  path: string;
}

/** Live entries of a content type index or taxonomy archive, one keyset page at a time. */
export interface EntryListingDto {
  type: { id: string; key: string; name: string; namePlural: string; indexPath: string | null };
  /** The term of a taxonomy archive; null on the type index. */
  term: LiveEntryDto | null;
  items: LiveEntryCard[];
  /** Cursor of the page this one continues (null on the first page). */
  cursor: string | null;
  /** Cursor of the next page; null on the last one. */
  nextCursor: string | null;
  sort: string;
  /** Terms of the type's taxonomies that have an archive, for term filter links. */
  taxonomies: { field: string; label: string; terms: EntryTermLink[] }[];
}

export interface ResolvedRoute {
  kind: RouteKind;
  /** 410: the path was removed on purpose (a redirect rule without target); the not-found page renders. */
  status: 200 | 301 | 302 | 404 | 410;
  redirectTo: string | null;
  locale: string;
  path: string;
  canonicalPath: string;
  /** locale → path for hreflang; only languages that have content of their own for this route. */
  alternates: Record<string, string>;
  /**
   * imageObjectKey is the social (Open Graph) image: the page's or entry's SEO image, the
   * first product image or the collection image otherwise. noindex is also set when the
   * requested language renders the default-language fallback. publishedAt and modifiedAt are
   * set for content entries (article:published_time, article:modified_time).
   */
  seo: {
    title: string;
    description: string;
    imageObjectKey: string | null;
    noindex: boolean;
    ogType: "website" | "article" | "product";
    publishedAt: string | null;
    modifiedAt: string | null;
  };
  sections: RenderSection[];
  product: ProductDetailDto | null;
  collection: CollectionDto | null;
  listing: ListingDto | null;
  /** The content entry an entry route renders (also a singleton type's entry). */
  entry: LiveEntryDto | null;
  /** Entries of a content type index or taxonomy archive. */
  entries: EntryListingDto | null;
  search: { query: string } | null;
  breadcrumbs: Breadcrumb[];
  /** assetId → objectKey for assets referenced by this route's sections and SEO fields. */
  assets: Record<string, string>;
  /** What kind of page this is (tracking and policy scope by it); from the owning module's route. */
  pageClass: PageClass;
  /** public: the same for every visitor (edge-cacheable); private: per visitor, never shared-cached. */
  cacheClass: RouteCacheClass;
  /** Upper bound for shared caches; shortened when a scheduled section or entry starts/ends soon. */
  cacheTtlSeconds: number;
}

export type { LiveEntryCard, LiveEntryDto, LiveFieldMeta, ResolvedAssetUsage, ResolvedEntryRef, ResolvedRecordRef, ResolvedLocationRef } from "@altyapi/content";
