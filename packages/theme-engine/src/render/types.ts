import type { CollectionDto, ProductCardDto, ProductDetailDto } from "@altyapi/catalog";
import type { SectionInstance, VisibilityRules } from "@altyapi/database";
import type { ThemeSettings } from "../theme-settings";

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
  theme: { settings: ThemeSettings; css: string };
  globalSections: RenderSection[];
  menus: Record<string, ResolvedLink[]>;
  /** assetId → objectKey for every ready asset referenced by global sections and brand settings. */
  assets: Record<string, string>;
  preview: boolean;
}

export type RouteKind = "home" | "page" | "landing" | "product" | "collection" | "search" | "cart" | "not_found" | "redirect";

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

export interface ResolvedRoute {
  kind: RouteKind;
  status: 200 | 301 | 302 | 404;
  redirectTo: string | null;
  locale: string;
  path: string;
  canonicalPath: string;
  /** locale → path for hreflang; only languages that have content of their own for this route. */
  alternates: Record<string, string>;
  /**
   * imageObjectKey is the social (Open Graph) image: the page's SEO image for home and content
   * pages, the first product image or the collection image otherwise. noindex is also set when
   * the requested language renders the default-language fallback.
   */
  seo: { title: string; description: string; imageObjectKey: string | null; noindex: boolean };
  sections: RenderSection[];
  product: ProductDetailDto | null;
  collection: CollectionDto | null;
  listing: ListingDto | null;
  search: { query: string } | null;
  breadcrumbs: Breadcrumb[];
  /** assetId → objectKey for assets referenced by this route's sections and SEO fields. */
  assets: Record<string, string>;
  /** Upper bound for shared caches; shortened when a scheduled section starts/ends soon. */
  cacheTtlSeconds: number;
}
