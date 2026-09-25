/**
 * Response shapes of the storefront, media and history endpoints. Many of these routes return
 * database rows without a response schema, and the API adds fields without a version bump, so
 * the types list only what the admin reads and code must tolerate extra or missing fields.
 */

export type LocalizedText = Record<string, string>;

/** JSON Schema 2020-12 node as emitted by z.toJSONSchema({ io: "input" }). */
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: JsonSchema | boolean;
  propertyNames?: JsonSchema;
  items?: JsonSchema;
  required?: string[];
  enum?: readonly (string | number)[];
  const?: unknown;
  default?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  format?: string;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
}

/** Page types of the storefront; "global" is the theme-level placement (header, footer, overlays). */
export type PageType = "home" | "product" | "collection" | "page" | "landing" | "cart" | "search" | "not_found";
export type Placement = PageType | "global";

export interface SectionDefinition {
  type: string;
  version: number;
  name: { tr: string; en: string } & Record<string, string>;
  category: string;
  /** Site module the section belongs to (e.g. "catalog"); absent on older APIs. */
  module?: string;
  policyTags?: string[];
  allowedIn: string[];
  /** Placements where the section must exist exactly once and cannot be removed or hidden. */
  requiredIn?: string[];
  contentBindings: string[];
  maxBlocks: number | null;
  singleton: boolean;
  props: JsonSchema;
  blocks: Record<string, JsonSchema>;
  defaults: Record<string, unknown>;
}

export interface SectionSettings {
  paddingTop?: Record<string, number>;
  paddingBottom?: Record<string, number>;
  hideOn?: Device[];
  colorScheme?: string;
  fullWidth?: boolean;
  anchorId?: string;
}

export type Device = "mobile" | "tablet" | "desktop";

export interface SectionVisibility {
  startsAt?: string | null;
  endsAt?: string | null;
  devices?: Device[];
  routes?: string[];
  excludeRoutes?: string[];
  segmentIds?: string[];
  locales?: string[];
  utm?: { source?: string[]; medium?: string[]; campaign?: string[] };
  referrerContains?: string[];
}

export interface BlockInstance {
  id: string;
  type: string;
  props: Record<string, unknown>;
}

export interface SectionInstance {
  id: string;
  type: string;
  version?: number;
  props: Record<string, unknown>;
  settings?: SectionSettings;
  visibility?: SectionVisibility;
  blocks?: BlockInstance[];
  disabled?: boolean;
}

export interface PageContent {
  sections: SectionInstance[];
}

export interface PageSeo {
  title?: LocalizedText;
  description?: LocalizedText;
  imageAssetId?: string | null;
  noindex?: boolean;
  canonicalPath?: string | null;
}

export type PageStatus = "draft" | "published" | "scheduled" | "unpublished";

export interface StorefrontPage {
  id: string;
  type: PageType;
  handle: string;
  /** Where the page is reachable: its live URL while published, else the URL it will go live under. */
  path: string | null;
  livePath: string | null;
  draftPath: string | null;
  title: LocalizedText;
  status: PageStatus | (string & {});
  draftContent: PageContent;
  draftSeo: PageSeo;
  draftRevision: number;
  publishedRevision: number | null;
  hasUnpublishedChanges: boolean;
  publishAt: string | null;
  unpublishAt: string | null;
  campaignId: string | null;
  updatedAt: string;
}

export interface ColorScheme {
  background: string;
  foreground: string;
  primary: string;
  primaryForeground: string;
  muted: string;
  mutedForeground: string;
  border: string;
}

export const SCHEME_NAMES = ["default", "inverse", "accent", "muted"] as const;
export type SchemeName = (typeof SCHEME_NAMES)[number];

export interface ThemeSettings {
  colors: { schemes: Record<SchemeName, ColorScheme>; sale: string; success: string; error: string };
  typography: { headingFont: string; bodyFont: string; baseSizePx: number; headingScale: number; headingWeight: string };
  shape: { radiusPx: number; buttonStyle: "solid" | "outline"; buttonRadiusPx: number };
  layout: { maxWidthPx: number; gutterPx: number };
  productCard: { imageRatio: string; showSecondaryImageOnHover: boolean; showVendor: boolean; showQuickAdd: boolean };
  brand: { logoAssetId: string | null; faviconAssetId: string | null };
  cookieBanner: { enabled: boolean; position: string; text: LocalizedText; policyUrl: string | null; colorScheme: string };
}

export interface StorefrontTheme {
  id: string;
  name: string;
  baseTheme?: string;
  settings: ThemeSettings;
  globalSections: PageContent;
  draftRevision: number;
  hasUnpublishedChanges?: boolean;
}

export interface Publication {
  id: string;
  number: number;
  reason: string;
  themeVersionId: string;
  pageCount: number;
  createdAt: string;
  isActive?: boolean;
}

export type NavLink =
  | { type: "url"; url: string }
  | { type: "page"; pageId: string }
  | { type: "collection"; collectionId: string }
  | { type: "product"; productId: string }
  /** A content entry: shown with its live path in each language, hidden while it is not live. */
  | { type: "entry"; entryId: string }
  /** A content type's index route (/blog, /hizmetler); hidden while the type has none. */
  | { type: "entry_index"; typeId: string }
  | { type: "home" | "search" | "cart" };

export interface NavItem {
  id: string;
  label: LocalizedText;
  link: NavLink;
  children?: NavItem[];
}

export interface NavigationMenu {
  id: string;
  handle: string;
  name: string;
  items: NavItem[];
  revision: number;
  updatedAt?: string;
}

export interface Redirect {
  id: string;
  fromPath: string;
  toPath: string;
  statusCode: number;
  matchType?: string;
  source: string;
  createdAt: string;
  updatedAt?: string;
}

export type HistoryResource = "theme" | "page" | "navigation" | "entry";

export interface HistoryItem {
  revision: number;
  parentRevision: number | null;
  source: string;
  label: string | null;
  principalType: string;
  principalId: string | null;
  agentId: string | null;
  createdAt: string;
  isCurrent: boolean;
}

export interface HistoryList {
  currentRevision: number;
  canUndo: boolean;
  canRedo: boolean;
  items: HistoryItem[];
}

export interface HistoryMoveResult {
  revision: number;
  snapshot: Record<string, unknown>;
}

export interface PreviewToken {
  token: string;
  expiresInSeconds: number;
}

/** Collections and products as listed by the catalog endpoints (only what pickers need). */
export interface CollectionSummary {
  id: string;
  type: string;
  title: string;
  handle: string;
  isPublished: boolean;
  productCount?: number;
}

export interface ProductSummary {
  id: string;
  title: string;
  handle: string;
  status: string;
  imageObjectKey?: string | null;
}

/** One issue of a 422 errors.content.invalid response. */
export interface ContentIssue {
  path: string;
  message: string;
}
