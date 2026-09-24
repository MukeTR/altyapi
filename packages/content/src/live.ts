import { decodeCursor, encodeCursor, invalid } from "@altyapi/commerce-core";
import {
  and,
  asc,
  collections,
  collectionTranslations,
  contentAssets,
  contentEntries,
  contentReferences,
  contentTypes,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  pageVersions,
  pgArray,
  productTranslations,
  products,
  publications,
  recordSlugs,
  recordVersions,
  siteLocations,
  siteProfiles,
  sql,
  storefrontState,
  stores,
  withTenantTx,
  type ContentEntryVersionData,
  type Database,
  type SeoFields,
  type SQL,
  type Transaction,
} from "@altyapi/database";
import { loadActiveModules } from "@altyapi/site";
import { fieldValueIn, publishableLocales } from "./fields/compile";
import type { FieldDef, LeafFieldDef } from "./fields/types";
import type { AssetUsage, LinkValue } from "./fields/values";
import { CONTENT_LIMITS } from "./limits";
import { isExternalTarget, linkTargetHref, type InternalLinkKind } from "./links";
import { entryPath, localizedPath, termArchivePath, typeIndexPath } from "./paths";
import { resolveHtmlTokens, tokensIn, type OutlineItem, type QaPair, type RichResolver } from "./rich/render";
import { deriveEntry, visibleCardImage, type EntryCard, type EntryLocaleDerived } from "./service/derive";
import { effectiveType, ENTRY_RESOURCE } from "./service/shared";
import { typePrefixFor, type ContentTypeRow, type EffectiveContentType } from "./types/definition";

/**
 * Storefront reads of content: route matching, slug resolution (with old-slug redirects),
 * live lists read from the card projection of record_versions, and the entry DTO with its
 * references resolved one level deep. Everything reads live versions only (fields, slugs,
 * parent and position alike: a draft reorder or reparent shows up on publish), except in
 * preview, which renders drafts.
 */

export interface ContentRef {
  organizationId: string;
  storeId: string;
}

export interface LiveReadOptions {
  locale: string;
  defaultLocale: string;
  /**
   * Serve the default-language version when the entry is not published in `locale`
   * (untranslated_policy fallback_noindex); the result is marked fallback and noindex.
   */
  fallback?: boolean | undefined;
  /** Public base URL of media (asset object keys are appended); without it rich text images are left out. */
  mediaBaseUrl?: string | null | undefined;
  /** Render drafts (editor preview). */
  preview?: boolean | undefined;
  /**
   * Type (key or id) whose archive URLs taxonomy terms get (/blog/kategori/{term}); terms have
   * no URL of their own.
   */
  archiveOf?: string | undefined;
  /**
   * Languages the store serves now (stores.supported_locales). Hreflang alternates are limited
   * to them: a language removed from the store keeps its published versions, but its URLs no
   * longer resolve. Read from the store when not given.
   */
  supportedLocales?: readonly string[] | undefined;
  /**
   * Active modules of the store. Links to and embeds of products and collections resolve only
   * while the catalog module is on (its routes answer 404 otherwise), like menu links. Read
   * from the store when not given.
   */
  modules?: readonly string[] | undefined;
}

/** Path of an entry, or of a taxonomy term's archive under the owner type. */
function pathOf(type: EffectiveContentType, owner: EffectiveContentType | null, locale: string, defaultLocale: string, slug: string | null | undefined): string | null {
  if (type.kind !== "taxonomy") return entryPath(type, locale, defaultLocale, slug);
  if (!owner || !type.builtin || !slug) return null;
  return termArchivePath(owner, type.builtin.key, locale, defaultLocale, slug);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function activeTypeByRef(tx: Transaction, storeId: string, typeRef: string | undefined): Promise<EffectiveContentType | null> {
  if (!typeRef) return null;
  const [row] = await tx
    .select()
    .from(contentTypes)
    .where(and(eq(contentTypes.storeId, storeId), UUID_RE.test(typeRef) ? eq(contentTypes.id, typeRef) : eq(contentTypes.key, typeRef), eq(contentTypes.status, "active")));
  return row ? effectiveType(row) : null;
}

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

export interface ContentRouteType {
  id: string;
  key: string;
  builtinKey: string | null;
  kind: ContentTypeRow["kind"];
  labels: ContentTypeRow["labels"];
  routePrefix: Record<string, string>;
  settings: ContentTypeRow["settings"];
  taxonomies: { field: string; typeKey: string; taxonomyTypeId: string | null; labels: ContentTypeRow["labels"] | null; archiveSegment: Record<string, string> }[];
}

/** Active types with URL prefixes, for the storefront route table. */
export async function listRouteTypes(db: Database, ref: ContentRef): Promise<ContentRouteType[]> {
  return withTenantTx(db, ref, async (tx) => {
    const rows = await tx.select().from(contentTypes).where(and(eq(contentTypes.storeId, ref.storeId), eq(contentTypes.status, "active")));
    const types = rows.map(effectiveType);
    return types
      .filter((t) => t.routable)
      .map((t) => ({
        id: t.id,
        key: t.key,
        builtinKey: t.builtin?.key ?? null,
        kind: t.kind,
        labels: t.labels,
        routePrefix: t.routePrefix,
        settings: t.settings,
        taxonomies: t.taxonomies.map((b) => {
          const taxonomy = types.find((x) => x.builtin?.key === b.typeKey);
          return { field: b.field, typeKey: b.typeKey, taxonomyTypeId: taxonomy?.id ?? null, labels: taxonomy?.labels ?? null, archiveSegment: b.archiveSegment };
        }),
      }));
  });
}

export type ContentRouteMatch =
  | { kind: "index"; type: ContentRouteType }
  | { kind: "singleton"; type: ContentRouteType }
  | { kind: "entry"; type: ContentRouteType; slug: string }
  | { kind: "term_index"; type: ContentRouteType; taxonomy: ContentRouteType["taxonomies"][number] }
  | { kind: "term"; type: ContentRouteType; taxonomy: ContentRouteType["taxonomies"][number]; slug: string };

/**
 * Matches a path (language prefix already removed, e.g. "/hizmetler/web-tasarim") against the
 * types' localized prefixes, longest prefix first:
 *   /{prefix} → index (or the singleton), /{prefix}/{slug} → entry,
 *   /{prefix}/{archive} → taxonomy index, /{prefix}/{archive}/{term} → taxonomy archive.
 */
export function matchContentRoute(types: readonly ContentRouteType[], locale: string, path: string): ContentRouteMatch | null {
  const segments = path.split("?")[0]!.split("/").filter(Boolean);
  let best: { type: ContentRouteType; length: number } | null = null;
  for (const type of types) {
    const prefix = typePrefixFor(type, locale);
    if (!prefix) continue;
    const parts = prefix.split("/");
    if (parts.length > segments.length || !parts.every((p, i) => segments[i] === p)) continue;
    if (!best || parts.length > best.length) best = { type, length: parts.length };
  }
  if (!best) return null;
  const rest = segments.slice(best.length);
  const type = best.type;
  if (rest.length === 0) return type.kind === "singleton" ? { kind: "singleton", type } : { kind: "index", type };
  if (type.kind === "singleton") return null;
  const taxonomy = type.taxonomies.find((t) => (t.archiveSegment[locale] ?? t.archiveSegment.en) === rest[0]);
  if (taxonomy) {
    if (rest.length === 1) return { kind: "term_index", type, taxonomy };
    if (rest.length === 2) return { kind: "term", type, taxonomy, slug: rest[1]! };
    return null;
  }
  return rest.length === 1 ? { kind: "entry", type, slug: rest[0]! } : null;
}

// ---------------------------------------------------------------------------
// Reference resolution
// ---------------------------------------------------------------------------

export interface ResolvedAssetUsage {
  assetId: string;
  alt: string;
  decorative: boolean;
  crop: AssetUsage["crop"] | null;
  focal: AssetUsage["focal"] | null;
}

export interface ResolvedEntryRef {
  kind: "entry";
  id: string;
  typeKey: string;
  locale: string;
  title: string;
  summary: string;
  path: string | null;
  slug: string | null;
  image: ResolvedAssetUsage | null;
  fields: Record<string, unknown>;
}

export interface ResolvedRecordRef {
  kind: "product" | "collection" | "page";
  id: string;
  title: string;
  handle: string | null;
  path: string;
}

export interface ResolvedLocationRef {
  kind: "location";
  id: string;
  slug: string;
  name: string;
  address: typeof siteLocations.$inferSelect.address;
  geo: typeof siteLocations.$inferSelect.geo;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  openingHours: typeof siteLocations.$inferSelect.openingHours;
  isPrimary: boolean;
}

export type ResolvedRef = ResolvedEntryRef | ResolvedRecordRef | ResolvedLocationRef;

export interface ResolvedAssetInfo {
  objectKey: string;
  width: number | null;
  height: number | null;
  contentType: string;
}

function localizedString(map: unknown, locale: string, fallback: string): string {
  if (!map || typeof map !== "object") return "";
  const m = map as Record<string, string | undefined>;
  return m[locale] ?? m[fallback] ?? "";
}

function resolveAssetUsage(value: unknown, locale: string, defaultLocale: string): ResolvedAssetUsage | null {
  if (!value || typeof value !== "object" || typeof (value as AssetUsage).assetId !== "string") return null;
  const a = value as AssetUsage;
  return {
    assetId: a.assetId,
    alt: a.decorative ? "" : localizedString(a.alt, locale, defaultLocale),
    decorative: a.decorative ?? false,
    crop: a.crop ?? null,
    focal: a.focal ?? null,
  };
}

interface Wanted {
  entry: Set<string>;
  product: Set<string>;
  collection: Set<string>;
  page: Set<string>;
  location: Set<string>;
  asset: Set<string>;
}

const wantedSet = (): Wanted => ({ entry: new Set(), product: new Set(), collection: new Set(), page: new Set(), location: new Set(), asset: new Set() });

/** Everything a render needs to turn ids into live links, cards and media, loaded in one pass. */
class Resolution {
  entries = new Map<string, ResolvedEntryRef>();
  records = new Map<string, ResolvedRecordRef>();
  locations = new Map<string, ResolvedLocationRef>();
  assets = new Map<string, ResolvedAssetInfo>();

  constructor(
    private readonly opts: LiveReadOptions,
    /** The type the rendered entry (or list) belongs to: taxonomy terms link to its archive. */
    private readonly owner: EffectiveContentType | null,
  ) {}

  async load(tx: Transaction, storeId: string, wanted: Wanted): Promise<void> {
    const { locale, defaultLocale } = this.opts;
    if (wanted.entry.size) {
      const rows = await tx
        .select({ entry: contentEntries, version: recordVersions, type: contentTypes })
        .from(contentEntries)
        .innerJoin(recordVersions, eq(recordVersions.id, contentEntries.liveVersionId))
        .innerJoin(contentTypes, eq(contentTypes.id, contentEntries.typeId))
        .where(and(eq(contentEntries.storeId, storeId), inArray(contentEntries.id, [...wanted.entry]), eq(contentEntries.status, "published"), eq(contentTypes.status, "active")));
      for (const r of rows) {
        const type = effectiveType(r.type);
        const cardLocale = r.version.locales.includes(locale) ? locale : this.opts.fallback && r.version.locales.includes(defaultLocale) ? defaultLocale : null;
        if (!cardLocale) continue;
        const derived = (r.version.derived as unknown as Record<string, EntryLocaleDerived>)[cardLocale];
        const data = r.version.data as unknown as ContentEntryVersionData;
        const slug = data.slugs?.[cardLocale] ?? null;
        let path: string | null = null;
        if (type.kind === "taxonomy" && this.owner && type.builtin && slug) path = termArchivePath(this.owner, type.builtin.key, locale, defaultLocale, slug);
        else path = entryPath(type, locale, defaultLocale, slug);
        const card = derived?.card;
        const image = visibleCardImage(type, card);
        this.entries.set(r.entry.id, {
          kind: "entry",
          id: r.entry.id,
          typeKey: type.key,
          locale: cardLocale,
          title: card?.title ?? "",
          summary: card?.summary ?? "",
          path,
          slug,
          image: image ? resolveAssetUsage(image, cardLocale, defaultLocale) : null,
          fields: card?.fields ?? {},
        });
        if (image?.assetId) wanted.asset.add(image.assetId);
      }
    }
    // Without the catalog module /products and /collections answer 404: their records are not
    // resolved, so links to them render as plain text and product embeds are left out.
    const catalogOn = wanted.product.size || wanted.collection.size ? await this.catalogOn(tx, storeId) : false;
    if (wanted.product.size && catalogOn) {
      const rows = await tx
        .select({ id: products.id, locale: productTranslations.locale, title: productTranslations.title, handle: productTranslations.handle })
        .from(products)
        .innerJoin(productTranslations, eq(productTranslations.productId, products.id))
        .where(and(eq(products.storeId, storeId), inArray(products.id, [...wanted.product]), eq(products.status, "active"), inArray(productTranslations.locale, [locale, defaultLocale])));
      for (const id of wanted.product) {
        const t = rows.find((r) => r.id === id && r.locale === locale) ?? rows.find((r) => r.id === id);
        if (t) this.records.set(`product/${id}`, { kind: "product", id, title: t.title, handle: t.handle, path: localizedPath(locale, defaultLocale, `/products/${t.handle}`) });
      }
    }
    if (wanted.collection.size && catalogOn) {
      const rows = await tx
        .select({ id: collections.id, locale: collectionTranslations.locale, title: collectionTranslations.title, handle: collectionTranslations.handle })
        .from(collections)
        .innerJoin(collectionTranslations, eq(collectionTranslations.collectionId, collections.id))
        .where(
          and(eq(collections.storeId, storeId), inArray(collections.id, [...wanted.collection]), eq(collections.isPublished, true), inArray(collectionTranslations.locale, [locale, defaultLocale])),
        );
      for (const id of wanted.collection) {
        const t = rows.find((r) => r.id === id && r.locale === locale) ?? rows.find((r) => r.id === id);
        if (t) this.records.set(`collection/${id}`, { kind: "collection", id, title: t.title, handle: t.handle, path: localizedPath(locale, defaultLocale, `/collections/${t.handle}`) });
      }
    }
    if (wanted.page.size) {
      const [state] = await tx.select({ publicationId: storefrontState.activePublicationId }).from(storefrontState).where(eq(storefrontState.storeId, storeId));
      const [publication] = state?.publicationId ? await tx.select({ pageVersions: publications.pageVersions }).from(publications).where(eq(publications.id, state.publicationId)) : [];
      const versionIds = [...wanted.page].map((id) => publication?.pageVersions[id]).filter((v): v is string => !!v);
      if (versionIds.length) {
        const [profile] = await tx.select({ style: siteProfiles.pageUrlStyle }).from(siteProfiles).where(eq(siteProfiles.storeId, storeId));
        const rows = await tx.select().from(pageVersions).where(inArray(pageVersions.id, versionIds));
        for (const v of rows) {
          const raw = v.type === "home" ? "/" : v.type === "page" || v.type === "landing" ? (profile?.style === "root" ? `/${v.handle}` : `/pages/${v.handle}`) : null;
          if (!raw) continue;
          this.records.set(`page/${v.pageId}`, { kind: "page", id: v.pageId, title: localizedString(v.title, locale, defaultLocale), handle: v.handle, path: localizedPath(locale, defaultLocale, raw) });
        }
      }
    }
    if (wanted.location.size) {
      const rows = await tx
        .select()
        .from(siteLocations)
        .where(and(eq(siteLocations.storeId, storeId), inArray(siteLocations.id, [...wanted.location]), eq(siteLocations.status, "active")));
      for (const l of rows) {
        this.locations.set(l.id, {
          kind: "location",
          id: l.id,
          slug: l.slug,
          name: localizedString(l.name, locale, defaultLocale),
          address: l.address,
          geo: l.geo,
          phone: l.phone,
          email: l.email,
          whatsapp: l.whatsapp,
          openingHours: l.openingHours,
          isPrimary: l.isPrimary,
        });
      }
    }
    if (wanted.asset.size) {
      const rows = await tx
        .select({ id: contentAssets.id, objectKey: contentAssets.objectKey, width: contentAssets.width, height: contentAssets.height, contentType: contentAssets.contentType })
        .from(contentAssets)
        .where(and(eq(contentAssets.storeId, storeId), inArray(contentAssets.id, [...wanted.asset]), eq(contentAssets.status, "ready"), isNull(contentAssets.deletedAt)));
      for (const a of rows) this.assets.set(a.id, { objectKey: a.objectKey, width: a.width, height: a.height, contentType: a.contentType });
    }
  }

  private catalog: boolean | null = null;

  /** Whether the store's catalog module is on (from the options, else read once per resolution). */
  private async catalogOn(tx: Transaction, storeId: string): Promise<boolean> {
    if (this.opts.modules) return this.opts.modules.includes("catalog");
    this.catalog ??= (await loadActiveModules(tx, storeId)).includes("catalog");
    return this.catalog;
  }

  has(kind: keyof Wanted, id: string): boolean {
    if (kind === "entry") return this.entries.has(id);
    if (kind === "asset") return this.assets.has(id);
    if (kind === "location") return this.locations.has(id);
    return this.records.has(`${kind}/${id}`);
  }

  href(kind: InternalLinkKind, id: string): string | null {
    if (kind === "entry") return this.entries.get(id)?.path ?? null;
    return this.records.get(`${kind}/${id}`)?.path ?? null;
  }

  get resolver(): RichResolver {
    const base = this.opts.mediaBaseUrl?.replace(/\/+$/, "") ?? null;
    return {
      href: (kind, id) => this.href(kind, id),
      asset: (id) => {
        const a = this.assets.get(id);
        return a && base ? { src: `${base}/${a.objectKey}`, width: a.width, height: a.height } : null;
      },
      embed: (kind, id) => {
        if (kind === "entry") {
          const e = this.entries.get(id);
          return e?.path ? { href: e.path, title: e.title, summary: e.summary } : null;
        }
        const p = this.records.get(`product/${id}`);
        return p ? { href: p.path, title: p.title } : null;
      },
    };
  }
}

function hasHtml(v: unknown): v is { html: string } & Record<string, unknown> {
  return !!v && typeof v === "object" && typeof (v as { html?: unknown }).html === "string";
}

/** Ids referenced by rich text tokens (links, images, embeds) in stored HTML. */
function addTokens(wanted: Wanted, html: string): void {
  for (const t of tokensIn(html)) wanted[t.kind].add(t.id);
}

function addFieldRefs(wanted: Wanted, field: LeafFieldDef | FieldDef, value: unknown): void {
  if (value === null || value === undefined) return;
  switch (field.type) {
    case "reference":
      if (typeof value === "string") wanted[field.validation.to].add(value);
      break;
    case "multiReference":
      if (Array.isArray(value)) for (const id of value) if (typeof id === "string") wanted[field.validation.to].add(id);
      break;
    case "asset":
      if ((value as AssetUsage).assetId) wanted.asset.add((value as AssetUsage).assetId);
      break;
    case "gallery":
      if (Array.isArray(value)) for (const a of value as AssetUsage[]) if (a?.assetId) wanted.asset.add(a.assetId);
      break;
    case "video":
      if ((value as { captionsAssetId?: string | null }).captionsAssetId) wanted.asset.add((value as { captionsAssetId: string }).captionsAssetId);
      break;
    case "link": {
      const t = (value as LinkValue).target;
      if (t && (t.type === "entry" || t.type === "page" || t.type === "product" || t.type === "collection")) wanted[t.type].add(t.id);
      break;
    }
    default:
      break;
  }
}

function optionLabel(field: Extract<FieldDef, { type: "select" | "multiSelect" }>, value: string, locale: string): string {
  const option = field.validation.options.find((o) => o.value === value);
  const label = (option?.label ?? {}) as Record<string, string | undefined>;
  return label[locale] ?? label.en ?? label.tr ?? value;
}

/** A field value as the storefront renders it: in one language, references resolved, rich text as final HTML. */
function presentValue(field: LeafFieldDef | FieldDef, raw: unknown, path: string, ctx: { locale: string; defaultLocale: string; derived: EntryLocaleDerived | undefined; resolution: Resolution }): unknown {
  const value = fieldValueIn(field, raw, ctx.locale);
  if (value === null || value === undefined) return null;
  const { resolution } = ctx;
  switch (field.type) {
    case "richDoc": {
      const d = ctx.derived?.rich[path];
      if (!d) return null;
      return { html: resolveHtmlTokens(d.html, resolution.resolver), plain: d.plain, outline: d.outline, wordCount: d.wordCount, readingMinutes: d.readingMinutes };
    }
    case "reference":
      return (field.validation.to === "entry" ? resolution.entries.get(value as string) : field.validation.to === "location" ? resolution.locations.get(value as string) : resolution.records.get(`${field.validation.to}/${value}`)) ?? null;
    case "multiReference":
      return (value as string[])
        .map((id) => (field.validation.to === "entry" ? resolution.entries.get(id) : field.validation.to === "location" ? resolution.locations.get(id) : resolution.records.get(`${field.validation.to}/${id}`)))
        .filter(Boolean);
    case "asset":
      return resolveAssetUsage(value, ctx.locale, ctx.defaultLocale);
    case "gallery":
      return (value as AssetUsage[]).map((a) => resolveAssetUsage(a, ctx.locale, ctx.defaultLocale)).filter(Boolean);
    case "link": {
      const v = value as LinkValue;
      const href = linkTargetHref(v.target, (kind, id) => resolution.href(kind, id));
      if (!href) return null;
      return { href, label: localizedString(v.label, ctx.locale, ctx.defaultLocale), openInNewTab: v.openInNewTab ?? false, external: isExternalTarget(v.target) };
    }
    case "select":
      return { value, label: optionLabel(field, value as string, ctx.locale) };
    case "multiSelect":
      return (value as string[]).map((v) => ({ value: v, label: optionLabel(field, v, ctx.locale) }));
    case "video": {
      const v = value as { provider: string; id: string; title?: Record<string, string>; captionsAssetId?: string | null; transcript?: Record<string, string> };
      return { provider: v.provider, id: v.id, title: localizedString(v.title, ctx.locale, ctx.defaultLocale), captionsAssetId: v.captionsAssetId ?? null, transcript: localizedString(v.transcript, ctx.locale, ctx.defaultLocale) };
    }
    case "credentials":
      return (value as { name: Record<string, string> }[]).map((c) => ({ ...c, name: localizedString(c.name, ctx.locale, ctx.defaultLocale) }));
    default:
      return value;
  }
}

// ---------------------------------------------------------------------------
// Entry DTO
// ---------------------------------------------------------------------------

export interface LiveEntryDto {
  id: string;
  typeId: string;
  typeKey: string;
  typeKind: ContentTypeRow["kind"];
  builtinKey: string | null;
  schemaOrg: string;
  /** Field holding the entry name (the H1); summaryField the short answer, imageField the cover image. */
  titleField: string;
  summaryField: string | null;
  imageField: string | null;
  /** null in preview. */
  versionId: string | null;
  version: number | null;
  liveFrom: Date | null;
  firstPublishedAt: Date | null;
  /** Last significant update (dateModified). */
  contentModifiedAt: Date | null;
  /** Language of the content served. */
  locale: string;
  requestedLocale: string;
  /** Default-language content served for an untranslated language (noindex). */
  fallback: boolean;
  /** Languages the entry is published in and the store still serves (hreflang). */
  locales: string[];
  slug: string | null;
  path: string | null;
  indexPath: string | null;
  alternates: Record<string, string>;
  title: string;
  summary: string;
  image: ResolvedAssetUsage | null;
  seo: { title: string; description: string; imageAssetId: string | null; noindex: boolean; canonicalPath: string | null };
  /** Public fields in the served language; references resolved one level deep. */
  fields: Record<string, unknown>;
  /** Key, type and label (in the served language) of every public field, in editor order; generic renderers of custom types read it. */
  fieldMeta: LiveFieldMeta[];
  outline: OutlineItem[];
  qa: QaPair[];
  wordCount: number;
  readingMinutes: number;
  parent: ResolvedEntryRef | null;
  /** Referenced assets that are ready: id → object key and size. */
  assets: Record<string, ResolvedAssetInfo>;
  preview: boolean;
}

export interface LiveFieldMeta {
  key: string;
  type: FieldDef["type"];
  label: string;
  /** Fields of a group or repeater item. */
  children?: LiveFieldMeta[];
}

function fieldMetaOf(field: FieldDef | LeafFieldDef, locale: string, defaultLocale: string): LiveFieldMeta {
  const meta: LiveFieldMeta = { key: field.key, type: field.type, label: localizedString(field.label, locale, defaultLocale) || localizedString(field.label, "en", "tr") };
  if (field.type === "group" || field.type === "repeater") {
    meta.children = field.validation.fields.filter((c) => c.visibility === "public").map((c) => fieldMetaOf(c, locale, defaultLocale));
  }
  return meta;
}

interface EntrySource {
  entry: typeof contentEntries.$inferSelect;
  type: EffectiveContentType;
  data: Record<string, unknown>;
  seo: SeoFields;
  slugs: Record<string, string>;
  /** Parent entry: of the live version (the draft's in preview). */
  parentId: string | null;
  locales: string[];
  derived: Record<string, EntryLocaleDerived>;
  version: typeof recordVersions.$inferSelect | null;
}

async function loadEntrySource(tx: Transaction, storeId: string, id: string, opts: LiveReadOptions, supportedLocales: readonly string[]): Promise<EntrySource | null> {
  const [row] = await tx
    .select({ entry: contentEntries, type: contentTypes })
    .from(contentEntries)
    .innerJoin(contentTypes, eq(contentTypes.id, contentEntries.typeId))
    .where(and(eq(contentEntries.id, id), eq(contentEntries.storeId, storeId), eq(contentTypes.status, "active")));
  if (!row) return null;
  const type = effectiveType(row.type);
  if (opts.preview) {
    if (row.entry.status === "archived") return null;
    const data = row.entry.draftData;
    // Preview shows every language with any content; publish decides what really goes live.
    const complete = publishableLocales(type, data, supportedLocales, type.hiddenFields);
    const locales = [...new Set([...complete, opts.locale])];
    return { entry: row.entry, type, data, seo: row.entry.draftSeo, slugs: row.entry.draftSlugs, parentId: row.entry.parentId, locales, derived: deriveEntry(type, data, locales), version: null };
  }
  if (row.entry.status !== "published" || !row.entry.liveVersionId) return null;
  const [version] = await tx.select().from(recordVersions).where(eq(recordVersions.id, row.entry.liveVersionId));
  if (!version) return null;
  const vd = version.data as unknown as ContentEntryVersionData;
  return {
    entry: row.entry,
    type,
    data: vd.data,
    seo: vd.seo,
    slugs: vd.slugs,
    parentId: vd.parentId ?? null,
    locales: version.locales,
    derived: version.derived as unknown as Record<string, EntryLocaleDerived>,
    version,
  };
}

/** The store's languages: from the options when the caller has them, else from the store row. */
async function supportedLocalesOf(tx: Transaction, storeId: string, opts: Pick<LiveReadOptions, "supportedLocales">): Promise<readonly string[]> {
  if (opts.supportedLocales) return opts.supportedLocales;
  const [row] = await tx.select({ locales: stores.supportedLocales }).from(stores).where(eq(stores.id, storeId));
  return row?.locales ?? [];
}

async function buildEntryDto(tx: Transaction, ref: ContentRef, src: EntrySource, opts: LiveReadOptions, supported: readonly string[]): Promise<LiveEntryDto | null> {
  const owner = src.type.kind === "taxonomy" ? await activeTypeByRef(tx, ref.storeId, opts.archiveOf) : null;
  const { type, data } = src;
  // Published languages the store still serves: the only ones with working URLs.
  const readable = src.locales.filter((l) => supported.includes(l));
  const locale = readable.includes(opts.locale) ? opts.locale : opts.fallback && readable.includes(opts.defaultLocale) ? opts.defaultLocale : null;
  if (!locale) return null;
  const derived = src.derived[locale];
  const wanted = wantedSet();
  const visible = type.fields.filter((f) => f.visibility === "public" && !type.hiddenFields.has(f.key));
  for (const field of visible) {
    const raw = data[field.key];
    if (field.type === "group") {
      for (const c of field.validation.fields) if (c.visibility === "public") addFieldRefs(wanted, c, fieldValueIn(c, (raw as Record<string, unknown> | null)?.[c.key], locale));
    } else if (field.type === "repeater") {
      for (const item of (raw as Record<string, unknown>[] | null) ?? []) for (const c of field.validation.fields) if (c.visibility === "public") addFieldRefs(wanted, c, fieldValueIn(c, item?.[c.key], locale));
    } else addFieldRefs(wanted, field, fieldValueIn(field, raw, locale));
  }
  for (const d of Object.values(derived?.rich ?? {})) addTokens(wanted, d.html);
  for (const qa of derived?.qa ?? []) addTokens(wanted, qa.answerHtml);
  if (src.parentId) wanted.entry.add(src.parentId);
  const cardImage = visibleCardImage(type, derived?.card);
  if (cardImage?.assetId) wanted.asset.add(cardImage.assetId);
  if (src.seo.imageAssetId) wanted.asset.add(src.seo.imageAssetId);

  const resolution = new Resolution({ ...opts, locale }, owner ?? type);
  await resolution.load(tx, ref.storeId, wanted);
  // Referenced FAQ answers and other card HTML carry their own tokens: resolve those as well (still one level).
  const nested = wantedSet();
  for (const e of resolution.entries.values()) for (const v of Object.values(e.fields)) if (hasHtml(v)) addTokens(nested, v.html);
  for (const kind of Object.keys(nested) as (keyof Wanted)[]) for (const id of [...nested[kind]]) if (resolution.has(kind, id)) nested[kind].delete(id);
  if (Object.values(nested).some((s) => s.size)) await resolution.load(tx, ref.storeId, nested);
  for (const e of resolution.entries.values()) {
    for (const [k, v] of Object.entries(e.fields)) if (hasHtml(v)) e.fields[k] = { ...v, html: resolveHtmlTokens(v.html, resolution.resolver) };
  }

  const ctx = { locale, defaultLocale: opts.defaultLocale, derived, resolution };
  const fields: Record<string, unknown> = {};
  for (const field of visible) {
    const raw = data[field.key];
    if (field.type === "group") {
      const g = (raw ?? {}) as Record<string, unknown>;
      fields[field.key] = Object.fromEntries(field.validation.fields.filter((c) => c.visibility === "public").map((c) => [c.key, presentValue(c, g[c.key], `${field.key}.${c.key}`, ctx)]));
    } else if (field.type === "repeater") {
      fields[field.key] = ((raw as Record<string, unknown>[] | null) ?? []).map((item, i) =>
        Object.fromEntries(field.validation.fields.filter((c) => c.visibility === "public").map((c) => [c.key, presentValue(c, item?.[c.key], `${field.key}.${i}.${c.key}`, ctx)])),
      );
    } else {
      fields[field.key] = presentValue(field, raw, field.key, ctx);
    }
  }

  const slug = src.slugs[locale] ?? null;
  const path = pathOf(type, owner, opts.locale, opts.defaultLocale, slug);
  const alternates: Record<string, string> = {};
  for (const l of readable) {
    const p = pathOf(type, owner, l, opts.defaultLocale, src.slugs[l]);
    if (p) alternates[l] = p;
  }
  const card: EntryCard | undefined = derived?.card;
  const fallback = locale !== opts.locale;
  const image = cardImage ? resolveAssetUsage(cardImage, locale, opts.defaultLocale) : null;
  // A merchant-set canonical is a path of the default-language page: it applies where
  // default-language content is served (the default language, or its fallback in an
  // untranslated one). A translation has URLs of its own (its own slug and, often, prefix), so
  // it stays self-canonical instead of pointing at the default-language page, which would take
  // it out of the index.
  const ownCanonical = fallback ? (alternates[locale] ?? path) : path;
  const canonicalPath = src.seo.canonicalPath && locale === opts.defaultLocale ? src.seo.canonicalPath : ownCanonical;
  const assets = Object.fromEntries(resolution.assets);
  return {
    id: src.entry.id,
    typeId: type.id,
    typeKey: type.key,
    typeKind: type.kind,
    builtinKey: type.builtin?.key ?? null,
    schemaOrg: type.schemaOrg,
    titleField: type.titleField,
    summaryField: type.summaryField,
    imageField: type.imageField,
    versionId: src.version?.id ?? null,
    version: src.version?.version ?? null,
    liveFrom: src.version?.liveFrom ?? null,
    firstPublishedAt: src.entry.firstPublishedAt,
    contentModifiedAt: src.entry.contentModifiedAt,
    locale,
    requestedLocale: opts.locale,
    fallback,
    locales: readable,
    slug,
    path,
    indexPath: typeIndexPath(owner ?? type, opts.locale, opts.defaultLocale),
    alternates,
    title: card?.title ?? "",
    summary: card?.summary ?? "",
    image,
    seo: {
      title: src.seo.title?.[locale]?.trim() || card?.title || "",
      description: src.seo.description?.[locale]?.trim() || card?.summary || "",
      imageAssetId: src.seo.imageAssetId ?? image?.assetId ?? null,
      noindex: (src.seo.noindex ?? false) || fallback || Boolean(opts.preview),
      canonicalPath,
    },
    fields,
    fieldMeta: visible.map((f) => fieldMetaOf(f, locale, opts.defaultLocale)),
    outline: derived?.outline ?? [],
    qa: (derived?.qa ?? []).map((q) => ({ ...q, answerHtml: resolveHtmlTokens(q.answerHtml, resolution.resolver) })),
    wordCount: derived?.wordCount ?? 0,
    readingMinutes: derived?.readingMinutes ?? 0,
    parent: src.parentId ? (resolution.entries.get(src.parentId) ?? null) : null,
    assets,
    preview: Boolean(opts.preview),
  };
}

/** The live (or, in preview, draft) entry in a language, with references resolved one level deep. */
export async function getLiveEntryDto(db: Database, ref: ContentRef, id: string, opts: LiveReadOptions): Promise<LiveEntryDto | null> {
  return withTenantTx(db, ref, async (tx) => {
    const supported = await supportedLocalesOf(tx, ref.storeId, opts);
    const src = await loadEntrySource(tx, ref.storeId, id, opts, supported);
    return src ? buildEntryDto(tx, ref, src, opts, supported) : null;
  });
}

export type EntryResolution = { kind: "entry"; entry: LiveEntryDto } | { kind: "moved"; path: string; slug: string } | null;

/**
 * Resolves /{prefix}/{slug} of a type (by key or id): the entry whose live slug it is in that
 * language; with fallback, the default-language slug of an entry not translated into it; an
 * old slug of an entry answers "moved" with its current path (301). Preview matches draft slugs.
 */
export async function resolveEntryBySlug(db: Database, ref: ContentRef, input: { type: string; slug: string } & LiveReadOptions): Promise<EntryResolution> {
  return withTenantTx(db, ref, async (tx) => {
    const type = await activeTypeByRef(tx, ref.storeId, input.type);
    if (!type) return null;
    const owner = type.kind === "taxonomy" ? await activeTypeByRef(tx, ref.storeId, input.archiveOf) : null;
    const dto = async (entryId: string) => {
      const supported = await supportedLocalesOf(tx, ref.storeId, input);
      const src = await loadEntrySource(tx, ref.storeId, entryId, input, supported);
      const entry = src ? await buildEntryDto(tx, ref, src, input, supported) : null;
      return entry ? ({ kind: "entry", entry } as const) : null;
    };

    if (input.preview) {
      const [draft] = await tx
        .select({ id: contentEntries.id })
        .from(contentEntries)
        .where(and(eq(contentEntries.storeId, ref.storeId), eq(contentEntries.typeId, type.id), ne(contentEntries.status, "archived"), sql`${contentEntries.draftSlugs} ->> ${input.locale} = ${input.slug}`))
        .limit(1);
      if (draft) return dto(draft.id);
    }

    const current = async (locale: string) => {
      const [row] = await tx
        .select({ resourceId: recordSlugs.resourceId })
        .from(recordSlugs)
        .where(and(eq(recordSlugs.storeId, ref.storeId), eq(recordSlugs.scopeKey, type.id), eq(recordSlugs.locale, locale), eq(recordSlugs.slug, input.slug), eq(recordSlugs.isCurrent, true)));
      return row?.resourceId ?? null;
    };
    const live = await current(input.locale);
    if (live) return dto(live);
    if (input.fallback && input.locale !== input.defaultLocale) {
      const fallbackId = await current(input.defaultLocale);
      if (fallbackId) {
        const [entry] = await tx.select({ locales: contentEntries.publishedLocales }).from(contentEntries).where(eq(contentEntries.id, fallbackId));
        // Only an entry without its own version in this language falls back.
        if (entry && !entry.locales.includes(input.locale)) return dto(fallbackId);
      }
    }

    // An old slug: redirect to where the entry lives now in this language.
    const moved = await tx
      .select({ resourceId: recordSlugs.resourceId })
      .from(recordSlugs)
      .where(and(eq(recordSlugs.storeId, ref.storeId), eq(recordSlugs.scopeKey, type.id), eq(recordSlugs.locale, input.locale), eq(recordSlugs.slug, input.slug), eq(recordSlugs.isCurrent, false)))
      .orderBy(desc(recordSlugs.updatedAt));
    for (const m of moved) {
      const [now] = await tx
        .select({ slug: recordSlugs.slug })
        .from(recordSlugs)
        .where(and(eq(recordSlugs.resourceType, ENTRY_RESOURCE), eq(recordSlugs.resourceId, m.resourceId), eq(recordSlugs.locale, input.locale), eq(recordSlugs.isCurrent, true)));
      const path = now ? pathOf(type, owner, input.locale, input.defaultLocale, now.slug) : null;
      if (now && path) return { kind: "moved", path, slug: now.slug };
    }
    return null;
  });
}

/** The entry of a singleton type (/{prefix} of a routable singleton, or a singleton shown by a section). */
export async function resolveSingleton(db: Database, ref: ContentRef, input: { type: string } & LiveReadOptions): Promise<LiveEntryDto | null> {
  return withTenantTx(db, ref, async (tx) => {
    const type = await activeTypeByRef(tx, ref.storeId, input.type);
    if (!type || type.kind !== "singleton") return null;
    const [row] = await tx
      .select({ id: contentEntries.id })
      .from(contentEntries)
      .where(and(eq(contentEntries.typeId, type.id), input.preview ? ne(contentEntries.status, "archived") : eq(contentEntries.status, "published")))
      .orderBy(asc(contentEntries.createdAt))
      .limit(1);
    if (!row) return null;
    const supported = await supportedLocalesOf(tx, ref.storeId, input);
    const src = await loadEntrySource(tx, ref.storeId, row.id, input, supported);
    return src ? buildEntryDto(tx, ref, src, input, supported) : null;
  });
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export type LiveEntrySort = "newest" | "oldest" | "position" | "title" | "updated" | "manual";

export interface LiveEntryListQuery extends LiveReadOptions {
  /** Type key or id. */
  type: string;
  /** Taxonomy term entry ids: entries classified with any of them. */
  terms?: string[] | undefined;
  featured?: boolean | undefined;
  /** First publish date range. */
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
  /** Only these entries; with sort "manual" in this order. */
  ids?: string[] | undefined;
  excludeIds?: string[] | undefined;
  /** Children of an entry; null = top-level entries only. */
  parentId?: string | null | undefined;
  /**
   * Only entries whose date field (date, datetime or date range; its end for a range) is
   * today or later, ordered soonest first. The field is the named one or the type's first
   * non-localized date field; a type without one lists nothing.
   */
  upcoming?: { field?: string | null | undefined; now: Date; timeZone?: string | undefined } | undefined;
  sort?: LiveEntrySort | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface LiveEntryCard {
  id: string;
  typeKey: string;
  locale: string;
  fallback: boolean;
  slug: string | null;
  path: string | null;
  title: string;
  summary: string;
  image: ResolvedAssetUsage | null;
  readingMinutes: number;
  position: number;
  firstPublishedAt: Date | null;
  contentModifiedAt: Date | null;
  /** The type's card fields: taxonomy terms resolved, rich text as final HTML. */
  fields: Record<string, unknown>;
}

/**
 * Decodes a list cursor and checks it fits the sort ([date, id], [position, id] or
 * [title, id]); a tampered cursor is refused (errors.content.invalid_cursor) before it can
 * reach a query.
 */
function listCursor(cursor: string, sort: LiveEntrySort): [string | number, string] {
  let parts: (string | number)[];
  try {
    parts = decodeCursor(cursor);
  } catch {
    throw invalid("errors.content.invalid_cursor");
  }
  const [key, id] = parts;
  const keyOk =
    sort === "position" ? typeof key === "number" && Number.isInteger(key) : sort === "title" ? typeof key === "string" : typeof key === "string" && !Number.isNaN(Date.parse(key));
  if (parts.length !== 2 || !keyOk || typeof id !== "string" || !UUID_RE.test(id)) throw invalid("errors.content.invalid_cursor");
  return [key!, id];
}

function sortFor(type: EffectiveContentType, requested: LiveEntrySort | undefined, hasIds: boolean): LiveEntrySort {
  if (requested === "manual") return hasIds ? "manual" : "position";
  if (requested) return requested;
  const def = type.settings.defaultSort;
  if (!def) return "newest";
  if (def.field === "position") return "position";
  if (def.field === "title") return "title";
  if (def.field === "updatedAt") return "updated";
  return def.direction === "asc" ? "oldest" : "newest";
}

/**
 * Live entries of a type as cards, read from the card projection stored with each version
 * (no document rendering at request time). Parent and position come from the live version
 * too, so a draft reorder changes nothing until it is published. Keyset pagination; at most 48
 * per page.
 */
export async function listLiveEntries(db: Database, ref: ContentRef, query: LiveEntryListQuery): Promise<{ items: LiveEntryCard[]; nextCursor: string | null }> {
  return withTenantTx(db, ref, async (tx) => {
    const type = await activeTypeByRef(tx, ref.storeId, query.type);
    if (!type) return { items: [], nextCursor: null };
    const owner = type.kind === "taxonomy" ? await activeTypeByRef(tx, ref.storeId, query.archiveOf) : null;
    const limit = Math.min(Math.max(query.limit ?? 12, 1), CONTENT_LIMITS.livePageSize);
    const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    const ids = query.ids?.filter(isUuid);
    const excludeIds = query.excludeIds?.filter(isUuid);
    const terms = query.terms?.filter(isUuid);
    if (query.ids && !ids?.length) return { items: [], nextCursor: null };
    const upcomingField = query.upcoming ? upcomingDateField(type, query.upcoming.field) : null;
    if (query.upcoming && !upcomingField) return { items: [], nextCursor: null };
    const sort = sortFor(type, query.sort, Boolean(ids?.length));
    const { locale, defaultLocale } = query;
    const useFallback = Boolean(query.fallback) && locale !== defaultLocale;
    const cardLocaleSql = useFallback
      ? sql`case when ${locale} = any(${contentEntries.publishedLocales}) then ${locale} else ${defaultLocale} end`
      : sql`${locale}`;
    const titleSql = sql<string>`coalesce(${recordVersions.derived} -> (${cardLocaleSql}) -> 'card' ->> 'title', '')`;
    // Live parent and position (ContentEntryVersionData), never the draft columns.
    const parentSql = sql`(${recordVersions.data} ->> 'parentId')`;
    const positionSql = sql<number>`coalesce((${recordVersions.data} ->> 'position')::int, 0)`;
    const dateSql = sql`coalesce(${contentEntries.firstPublishedAt}, ${recordVersions.liveFrom})`;
    const updatedSql = sql`coalesce(${contentEntries.contentModifiedAt}, ${contentEntries.firstPublishedAt}, ${recordVersions.liveFrom})`;

    const termFields = type.taxonomies.length
      ? type.taxonomies.map((t) => t.field)
      : type.fields.filter((f) => f.type === "multiReference" && f.validation.to === "entry").map((f) => f.key);
    const after = query.cursor ? listCursor(query.cursor, sort) : null;
    const conditions: (SQL | undefined)[] = [
      eq(contentEntries.storeId, ref.storeId),
      eq(contentEntries.typeId, type.id),
      eq(contentEntries.status, "published"),
      useFallback
        ? sql`(${locale} = any(${contentEntries.publishedLocales}) or ${defaultLocale} = any(${contentEntries.publishedLocales}))`
        : sql`${locale} = any(${contentEntries.publishedLocales})`,
      ids?.length ? inArray(contentEntries.id, ids) : undefined,
      excludeIds?.length ? sql`not (${contentEntries.id} = any(${pgArray(excludeIds, "uuid")}))` : undefined,
      query.parentId === null ? sql`${parentSql} is null` : query.parentId ? sql`${parentSql} = ${query.parentId}` : undefined,
      query.dateFrom ? sql`${dateSql} >= ${query.dateFrom.toISOString()}::timestamptz` : undefined,
      query.dateTo ? sql`${dateSql} < ${query.dateTo.toISOString()}::timestamptz` : undefined,
      query.featured !== undefined && type.fields.some((f) => f.key === "featured")
        ? query.featured
          ? sql`(${recordVersions.data} -> 'data' ->> 'featured') = 'true'`
          : sql`coalesce(${recordVersions.data} -> 'data' ->> 'featured', 'false') <> 'true'`
        : undefined,
      terms?.length && termFields.length
        ? sql`(${sql.join(
            termFields.map((f) => sql`jsonb_exists_any(coalesce(${recordVersions.data} -> 'data' -> ${f}, '[]'::jsonb), ${pgArray(terms, "text")})`),
            sql` or `,
          )})`
        : undefined,
    ];
    let upcomingOrder: SQL | null = null;
    if (upcomingField && query.upcoming) {
      const value = (part?: "from" | "to") =>
        part ? sql`(${recordVersions.data} -> 'data' -> ${upcomingField.key} ->> ${part})` : sql`(${recordVersions.data} -> 'data' ->> ${upcomingField.key})`;
      if (upcomingField.type === "datetime") {
        conditions.push(sql`${value()}::timestamptz >= ${query.upcoming.now.toISOString()}::timestamptz`);
        upcomingOrder = sql`${value()}::timestamptz`;
      } else {
        const today = calendarDate(query.upcoming.now, query.upcoming.timeZone);
        const end = upcomingField.type === "dateRange" ? value("to") : value();
        conditions.push(sql`${end} >= ${today}`);
        upcomingOrder = upcomingField.type === "dateRange" ? value("from") : value();
      }
    }
    const paged = sort !== "manual" && !upcomingOrder;
    if (after && paged) {
      const [k, id] = after;
      const idSql = sql`${String(id)}::uuid`;
      if (sort === "newest") conditions.push(sql`(${dateSql}, ${contentEntries.id}) < (${String(k)}::timestamptz, ${idSql})`);
      else if (sort === "oldest") conditions.push(sql`(${dateSql}, ${contentEntries.id}) > (${String(k)}::timestamptz, ${idSql})`);
      else if (sort === "updated") conditions.push(sql`(${updatedSql}, ${contentEntries.id}) < (${String(k)}::timestamptz, ${idSql})`);
      else if (sort === "position") conditions.push(sql`(${positionSql}, ${contentEntries.id}) > (${Number(k)}, ${idSql})`);
      else if (sort === "title") conditions.push(sql`(${titleSql}, ${contentEntries.id}) > (${String(k)}, ${idSql})`);
    }
    const order = upcomingOrder
      ? [asc(upcomingOrder), asc(contentEntries.id)]
      : sort === "newest"
        ? [desc(dateSql), desc(contentEntries.id)]
        : sort === "oldest"
          ? [asc(dateSql), asc(contentEntries.id)]
          : sort === "updated"
            ? [desc(updatedSql), desc(contentEntries.id)]
            : sort === "title"
              ? [asc(titleSql), asc(contentEntries.id)]
              : sort === "manual"
                ? [sql`array_position(${pgArray(ids ?? [], "uuid")}, ${contentEntries.id})`]
                : [asc(positionSql), asc(contentEntries.id)];

    const rows = await tx
      .select({
        id: contentEntries.id,
        position: positionSql,
        firstPublishedAt: contentEntries.firstPublishedAt,
        contentModifiedAt: contentEntries.contentModifiedAt,
        cardLocale: sql<string>`${cardLocaleSql}`,
        card: sql<EntryCard | null>`${recordVersions.derived} -> (${cardLocaleSql}) -> 'card'`,
        slugs: sql<Record<string, string> | null>`${recordVersions.data} -> 'slugs'`,
        date: sql<string>`${dateSql}`,
        updated: sql<string>`${updatedSql}`,
        title: titleSql,
      })
      .from(contentEntries)
      .innerJoin(recordVersions, eq(recordVersions.id, contentEntries.liveVersionId))
      .where(and(...conditions))
      .orderBy(...order)
      .limit(sort === "manual" ? CONTENT_LIMITS.livePageSize : limit + 1);

    const page = sort === "manual" ? rows : rows.slice(0, limit);
    // Card fields hold term ids and tokenized HTML: resolve them in one pass.
    const wanted = wantedSet();
    const termFieldSet = new Set(termFields);
    for (const r of page) {
      const image = visibleCardImage(type, r.card);
      if (image?.assetId) wanted.asset.add(image.assetId);
      for (const [k, v] of Object.entries(r.card?.fields ?? {})) {
        if (termFieldSet.has(k) && Array.isArray(v)) for (const id of v) if (typeof id === "string") wanted.entry.add(id);
        if (hasHtml(v)) addTokens(wanted, v.html);
      }
    }
    const resolution = new Resolution(query, owner ?? type);
    await resolution.load(tx, ref.storeId, wanted);

    const items: LiveEntryCard[] = page.map((r) => {
      const card = r.card;
      const image = visibleCardImage(type, card);
      const slug = r.slugs?.[r.cardLocale] ?? null;
      const fields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(card?.fields ?? {})) {
        if (termFieldSet.has(k) && Array.isArray(v)) fields[k] = v.map((id) => resolution.entries.get(id as string)).filter(Boolean);
        else if (hasHtml(v)) fields[k] = { ...v, html: resolveHtmlTokens(v.html, resolution.resolver) };
        else fields[k] = v;
      }
      return {
        id: r.id,
        typeKey: type.key,
        locale: r.cardLocale,
        fallback: r.cardLocale !== locale,
        slug,
        path: pathOf(type, owner, locale, defaultLocale, slug),
        title: card?.title ?? "",
        summary: card?.summary ?? "",
        image: image ? resolveAssetUsage(image, r.cardLocale, defaultLocale) : null,
        readingMinutes: card?.readingMinutes ?? 0,
        position: Number(r.position),
        firstPublishedAt: r.firstPublishedAt,
        contentModifiedAt: r.contentModifiedAt,
        fields,
      };
    });
    const last = page[page.length - 1];
    let nextCursor: string | null = null;
    if (paged && rows.length > limit && last) {
      const key =
        sort === "newest" || sort === "oldest"
          ? new Date(last.date).toISOString()
          : sort === "updated"
            ? new Date(last.updated).toISOString()
            : sort === "position"
              ? last.position
              : last.title;
      nextCursor = encodeCursor([key, last.id]);
    }
    return { items, nextCursor };
  });
}

/** The date field an "upcoming" list reads: the named one, or the type's first non-localized date field. */
function upcomingDateField(type: EffectiveContentType, key: string | null | undefined): { key: string; type: "date" | "datetime" | "dateRange" } | null {
  const isDate = (f: FieldDef): f is Extract<FieldDef, { type: "date" | "datetime" | "dateRange" }> =>
    (f.type === "date" || f.type === "datetime" || f.type === "dateRange") && !f.localized && !type.hiddenFields.has(f.key);
  const field = key ? type.fields.find((f) => f.key === key) : type.fields.find(isDate);
  return field && isDate(field) ? { key: field.key, type: field.type } : null;
}

/** YYYY-MM-DD of an instant in a time zone (UTC when none is given). */
function calendarDate(at: Date, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

// ---------------------------------------------------------------------------
// Rich text of other records, schedules and type lookups
// ---------------------------------------------------------------------------

/**
 * Resolves the internal tokens (links, images, embeds) of richDoc HTML that is not stored with
 * an entry, e.g. rich text of page sections rendered with toHtml: everything the documents
 * reference is loaded in one pass, and a target that is not live renders as plain text or is
 * left out.
 */
export async function resolveRichHtml(db: Database, ref: ContentRef, html: readonly string[], opts: LiveReadOptions): Promise<string[]> {
  const wanted = wantedSet();
  for (const h of html) addTokens(wanted, h);
  const resolution = new Resolution(opts, null);
  if (Object.values(wanted).some((set) => set.size)) await withTenantTx(db, ref, (tx) => resolution.load(tx, ref.storeId, wanted));
  return html.map((h) => resolveHtmlTokens(h, resolution.resolver));
}

/**
 * The next time live content changes on its own: the earliest scheduled publish or take-down
 * after `now` among entries of the given types (keys or ids) or the given entries. Shared
 * caches of pages that show them must expire by then.
 */
export async function nextScheduleBoundary(db: Database, ref: ContentRef, scope: { types?: readonly string[]; entryIds?: readonly string[] }, now: Date): Promise<Date | null> {
  const types = [...new Set(scope.types ?? [])];
  const entryIds = scope.entryIds?.filter((id) => UUID_RE.test(id)) ?? [];
  if (!types.length && !entryIds.length) return null;
  const at = now.toISOString();
  const typeIds = types.filter((t) => UUID_RE.test(t));
  const typeKeys = types.filter((t) => !UUID_RE.test(t));
  const ofTypes = types.length
    ? sql`${contentEntries.typeId} in (select ${contentTypes.id} from ${contentTypes} where ${contentTypes.storeId} = ${ref.storeId}
        and (${contentTypes.id} = any(${pgArray(typeIds, "uuid")}) or ${contentTypes.key} = any(${pgArray(typeKeys, "text")})))`
    : null;
  const ofEntries = entryIds.length ? sql`${contentEntries.id} = any(${pgArray(entryIds, "uuid")})` : null;
  const [row] = await withTenantTx(db, ref, (tx) =>
    tx
      .select({
        next: sql<string | null>`least(
          min(${contentEntries.publishAt}) filter (where ${contentEntries.publishAt} > ${at}::timestamptz),
          min(${contentEntries.unpublishAt}) filter (where ${contentEntries.unpublishAt} > ${at}::timestamptz))`,
      })
      .from(contentEntries)
      .where(
        and(
          eq(contentEntries.storeId, ref.storeId),
          sql`(${contentEntries.publishAt} > ${at}::timestamptz or ${contentEntries.unpublishAt} > ${at}::timestamptz)`,
          ofTypes && ofEntries ? sql`(${ofTypes} or ${ofEntries})` : (ofTypes ?? ofEntries!),
        ),
      ),
  );
  return row?.next ? new Date(row.next) : null;
}

/**
 * Live paths of entries in a language, for links outside rich text (menus): an entry that is
 * not live, of an archived type or not published in the language (unless the fallback policy
 * serves it) is left out, so its link is hidden instead of leading to a 404. Taxonomy terms
 * have no path of their own and are left out too.
 */
export async function liveEntryPaths(db: Database, ref: ContentRef, ids: readonly string[], opts: LiveReadOptions): Promise<Map<string, string>> {
  const wanted = wantedSet();
  for (const id of ids) if (UUID_RE.test(id)) wanted.entry.add(id);
  if (!wanted.entry.size) return new Map();
  const resolution = new Resolution(opts, null);
  await withTenantTx(db, ref, (tx) => resolution.load(tx, ref.storeId, wanted));
  return new Map([...resolution.entries].flatMap(([id, e]): [string, string][] => (e.path ? [[id, e.path]] : [])));
}

/** Id of the store's active type installed from a built-in definition ("faq_item"), whatever key it was installed under. */
export async function activeTypeIdByBuiltin(db: Database, ref: ContentRef, builtinKey: string): Promise<string | null> {
  const [row] = await withTenantTx(db, ref, (tx) =>
    tx
      .select({ id: contentTypes.id })
      .from(contentTypes)
      .where(and(eq(contentTypes.storeId, ref.storeId), eq(contentTypes.builtinKey, builtinKey), eq(contentTypes.status, "active")))
      .orderBy(asc(contentTypes.createdAt))
      .limit(1),
  );
  return row?.id ?? null;
}

/**
 * Languages a type has live content in: the union of the published languages of its live
 * entries (record_versions.locales). A type index is written in these languages only; in the
 * others it lists nothing of its own (untranslated_policy hide) or default-language fallbacks.
 */
export async function liveTypeLocales(db: Database, ref: ContentRef, typeId: string): Promise<string[]> {
  if (!UUID_RE.test(typeId)) return [];
  const rows = await withTenantTx(db, ref, (tx) =>
    tx
      .selectDistinct({ locale: sql<string>`unnest(${recordVersions.locales})` })
      .from(contentEntries)
      .innerJoin(recordVersions, eq(recordVersions.id, contentEntries.liveVersionId))
      .where(and(eq(contentEntries.storeId, ref.storeId), eq(contentEntries.typeId, typeId), eq(contentEntries.status, "published"))),
  );
  return rows.map((r) => r.locale);
}

/**
 * Live entries that reference an entry (content_references, live state): "posts about this
 * service", "lawyers practising in this area". Returns source entry ids of the given type.
 */
export async function liveReferencingEntryIds(db: Database, ref: ContentRef, targetEntryId: string, sourceType: string, limit = CONTENT_LIMITS.livePageSize): Promise<string[]> {
  return withTenantTx(db, ref, async (tx) => {
    const type = await activeTypeByRef(tx, ref.storeId, sourceType);
    if (!type || !UUID_RE.test(targetEntryId)) return [];
    const rows = await tx
      .selectDistinct({ id: contentEntries.id })
      .from(contentReferences)
      .innerJoin(contentEntries, eq(contentEntries.id, contentReferences.sourceId))
      .where(
        and(
          eq(contentReferences.storeId, ref.storeId),
          eq(contentReferences.sourceType, ENTRY_RESOURCE),
          eq(contentReferences.state, "live"),
          eq(contentReferences.targetKind, "entry"),
          eq(contentReferences.targetId, targetEntryId),
          eq(contentEntries.typeId, type.id),
          eq(contentEntries.status, "published"),
        ),
      )
      .limit(limit);
    return rows.map((r) => r.id);
  });
}
