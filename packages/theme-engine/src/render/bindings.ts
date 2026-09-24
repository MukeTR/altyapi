import {
  getStorefrontCollectionsByIds,
  listStorefrontProducts,
  type StorefrontQueryContext,
} from "@altyapi/catalog";
import {
  activeTypeIdByBuiltin,
  isRichDocEmpty,
  listLiveEntries,
  liveReferencingEntryIds,
  nextScheduleBoundary,
  resolveRichHtml,
  toHtml,
  typeIndexPath,
  type ContentRouteType,
  type LiveEntryCard,
  type LiveEntryDto,
  type LiveEntrySort,
  type LiveReadOptions,
  type RichDoc,
} from "@altyapi/content";
import { withTenantTx, type Database, type SectionInstance } from "@altyapi/database";
import type { MapProvider } from "../sections/site-sections";
import { loadPublicIdentity, loadPublicLocations, mapLink, type PublicBusinessIdentity, type PublicLocation } from "./site-data";

/**
 * Server-side data of sections: every section that shows records (products, entries, the
 * business identity, locations) gets them resolved here, one load per section and never one
 * per item. Identity and locations are loaded at most once per request and shared.
 */

export interface StoreRef {
  organizationId: string;
  storeId: string;
}

export interface BindingContext {
  db: Database;
  ref: StoreRef;
  locale: string;
  defaultLocale: string;
  timezone: string;
  /** Localized path of the page language. */
  lp: (path: string) => string;
  /** Catalog queries; null while the catalog module is off (catalog sections are not rendered then). */
  qctx: StorefrontQueryContext | null;
  /** The content module is on. */
  content: boolean;
  /** Routable content types (index paths and labels of listed types). */
  contentTypes: readonly ContentRouteType[];
  /** Live read options of content (language fallback, media base URL). */
  live: LiveReadOptions;
  now: Date;
  /** The entry an entry template renders; null elsewhere. */
  entry: LiveEntryDto | null;
  /** Shortens the shared cache lifetime of the response to a content boundary. */
  expireAt: (at: Date | null) => void;
  identity: () => Promise<PublicBusinessIdentity | null>;
  locations: () => Promise<PublicLocation[]>;
}

/** Memoized loaders of the business identity and locations for one request. */
export function siteDataLoaders(db: Database, ref: StoreRef, locale: string, defaultLocale: string) {
  let identity: Promise<PublicBusinessIdentity | null> | null = null;
  let locations: Promise<PublicLocation[]> | null = null;
  return {
    identity: () => (identity ??= withTenantTx(db, ref, (tx) => loadPublicIdentity(tx, ref.storeId, locale, defaultLocale))),
    locations: () => (locations ??= withTenantTx(db, ref, (tx) => loadPublicLocations(tx, ref.storeId, locale, defaultLocale))),
  };
}

type Props = Record<string, unknown>;

function docIn(map: unknown, locale: string, defaultLocale: string): RichDoc | null {
  if (!map || typeof map !== "object") return null;
  const m = map as Record<string, RichDoc | undefined>;
  const doc = m[locale] && !isRichDocEmpty(m[locale]) ? m[locale] : m[defaultLocale];
  return doc && !isRichDocEmpty(doc) ? doc : null;
}

function textIn(map: unknown, locale: string, defaultLocale: string): string {
  if (!map || typeof map !== "object") return "";
  const m = map as Record<string, string | undefined>;
  return m[locale]?.trim() || m[defaultLocale]?.trim() || "";
}

/** Type facts an entry list shows next to its cards (name, "view all" link). */
function listedType(bc: BindingContext, typeKey: string) {
  const type = bc.contentTypes.find((t) => t.key === typeKey);
  if (!type) return { key: typeKey, name: "", namePlural: "", indexPath: null };
  return {
    key: type.key,
    name: textIn(type.labels.name, bc.locale, bc.defaultLocale),
    namePlural: textIn(type.labels.namePlural, bc.locale, bc.defaultLocale),
    indexPath: type.kind === "collection" && (type.settings.indexMode ?? "auto") === "auto" ? typeIndexPath(type, bc.locale, bc.defaultLocale) : null,
  };
}

async function bindEntryList(p: Props, bc: BindingContext): Promise<Props> {
  const typeKey = p.typeKey as string | null;
  if (!typeKey || !bc.content) return { type: null, items: [] };
  const type = listedType(bc, typeKey);
  const empty = { type, items: [] as LiveEntryCard[] };
  let ids: string[] | undefined;
  if (p.mode === "manual") {
    ids = p.entryIds as string[];
    if (!ids.length) return empty;
  } else if (p.referencesCurrent) {
    if (!bc.entry) return empty;
    ids = await liveReferencingEntryIds(bc.db, bc.ref, bc.entry.id, typeKey);
    if (!ids.length) return empty;
  }
  const termIds = p.mode === "filter" ? (p.termIds as string[]) : [];
  const sort = p.mode === "manual" ? "manual" : p.sort === "default" ? undefined : (p.sort as LiveEntrySort);
  const [res, boundary] = await Promise.all([
    listLiveEntries(bc.db, bc.ref, {
      ...bc.live,
      type: typeKey,
      ids,
      terms: termIds.length ? termIds : undefined,
      featured: p.featuredOnly ? true : undefined,
      excludeIds: bc.entry && p.mode !== "manual" ? [bc.entry.id] : undefined,
      upcoming: p.upcoming ? { field: p.dateField as string | null, now: bc.now, timeZone: bc.timezone } : undefined,
      sort,
      limit: Number(p.limit ?? 6),
    }),
    nextScheduleBoundary(bc.db, bc.ref, { types: [typeKey] }, bc.now),
  ]);
  bc.expireAt(boundary);
  return { type, items: res.items };
}

/** FAQ items with final answer HTML: inline questions (richDoc answers) or FAQ entries in the given order. */
async function bindFaq(s: SectionInstance, bc: BindingContext): Promise<Props> {
  const p = s.props;
  if (p.source === "entries") {
    const ids = p.entryIds as string[];
    if (!bc.content || !ids.length) return { items: [] };
    const typeId = await activeTypeIdByBuiltin(bc.db, bc.ref, "faq_item");
    if (!typeId) return { items: [] };
    const [res, boundary] = await Promise.all([
      listLiveEntries(bc.db, bc.ref, { ...bc.live, type: typeId, ids, sort: "manual" }),
      nextScheduleBoundary(bc.db, bc.ref, { entryIds: ids }, bc.now),
    ]);
    bc.expireAt(boundary);
    return {
      items: res.items.map((e) => ({ id: e.id, question: e.title, answerHtml: (e.fields.answer as { html?: string } | null)?.html ?? "", path: e.path })),
    };
  }
  const items = (s.blocks ?? [])
    .filter((b) => b.type === "item")
    .map((b) => ({ id: b.id, question: textIn(b.props.question, bc.locale, bc.defaultLocale), doc: docIn(b.props.answer, bc.locale, bc.defaultLocale) }))
    .filter((i) => i.question);
  const html = await resolveRichHtml(bc.db, bc.ref, items.map((i) => (i.doc ? toHtml(i.doc) : "")), bc.live);
  return { items: items.map((i, n) => ({ id: i.id, question: i.question, answerHtml: html[n] ?? "", path: null })) };
}

async function bindRichText(p: Props, bc: BindingContext): Promise<Props> {
  const doc = docIn(p.body, bc.locale, bc.defaultLocale);
  if (!doc) return { html: "" };
  const [html] = await resolveRichHtml(bc.db, bc.ref, [toHtml(doc)], bc.live);
  return { html: html ?? "" };
}

/**
 * Related entries of the entry an entry-main renders: the same type, sharing a term of its
 * taxonomies when it has any, the newest first.
 */
async function bindEntryMain(p: Props, bc: BindingContext): Promise<Props> {
  const entry = bc.entry;
  if (!entry) return { entry: null, related: [] };
  if (!p.related || !bc.content) return { entry, related: [] };
  const type = bc.contentTypes.find((t) => t.id === entry.typeId);
  const termIds = (type?.taxonomies ?? []).flatMap((t) => ((entry.fields[t.field] as { id: string }[] | null) ?? []).map((ref) => ref.id));
  const res = await listLiveEntries(bc.db, bc.ref, {
    ...bc.live,
    type: entry.typeId,
    terms: termIds.length ? termIds : undefined,
    excludeIds: [entry.id],
    limit: Number(p.relatedLimit ?? 3),
  });
  return { entry, related: res.items };
}

/** Section data the renderer needs, or null for sections that render from their props alone. */
export async function bindSection(s: SectionInstance, bc: BindingContext): Promise<Props | null> {
  const p = s.props;
  switch (s.type) {
    case "product-grid": {
      if (!bc.qctx) return { products: [] };
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
      const res = await listStorefrontProducts(bc.db, bc.qctx, q);
      if (source === "manual") {
        const order = (p.productIds as string[]) ?? [];
        res.items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      }
      return { products: res.items };
    }
    case "featured-collection": {
      if (!bc.qctx || !p.collectionId) return { collection: null, products: [] };
      const [col] = await getStorefrontCollectionsByIds(bc.db, bc.qctx, [String(p.collectionId)]);
      if (!col) return { collection: null, products: [] };
      const res = await listStorefrontProducts(bc.db, bc.qctx, { collectionId: col.id, limit: Number(p.productLimit ?? 8) });
      return { collection: { ...col, path: bc.lp(`/collections/${col.handle}`) }, products: res.items };
    }
    case "category-cards": {
      if (!bc.qctx) return { collections: {} };
      const ids = (s.blocks ?? []).map((b) => String(b.props.collectionId));
      const cols = await getStorefrontCollectionsByIds(bc.db, bc.qctx, ids);
      return { collections: Object.fromEntries(cols.map((c) => [c.id, { ...c, path: bc.lp(`/collections/${c.handle}`) }])) };
    }
    case "entry-main":
      return bindEntryMain(p, bc);
    case "entry-list":
      return bindEntryList(p, bc);
    case "faq":
      return s.version >= 2 ? bindFaq(s, bc) : null;
    case "rich-text":
      return s.version >= 2 ? bindRichText(p, bc) : null;
    case "statutory-info":
      return { identity: await bc.identity() };
    case "business-facts": {
      const [identity, locations] = await Promise.all([bc.identity(), bc.locations()]);
      return { identity, locationCount: locations.length, primaryLocation: locations[0] ?? null };
    }
    case "opening-hours": {
      const locations = await bc.locations();
      const location = p.locationId ? (locations.find((l) => l.id === p.locationId) ?? null) : (locations[0] ?? null);
      return { location, timezone: bc.timezone };
    }
    case "locations-map": {
      const all = await bc.locations();
      const ids = p.locationIds as string[];
      const picked = ids.length ? ids.flatMap((id) => all.filter((l) => l.id === id)) : all;
      const provider = p.mapProvider as MapProvider;
      return { locations: picked.map((l) => ({ ...l, mapUrl: mapLink(provider, l) })), timezone: bc.timezone };
    }
    default:
      return null;
  }
}
