import { collections, collectionTranslations, inArray, pageVersions, pages, sql, withTenantTx, type Transaction } from "@altyapi/database";
import { stripHtml } from "@altyapi/catalog";
import { EkosistemError } from "../../errors";
import { loadStoreIdentity, localizedStorePath, storeUrl, type EkosistemServerDeps, type LinkRow, type StoreIdentity } from "../common";
import { assembleIncremental } from "./catalog";
import { pageKeys, parseIncrementalQuery, transactionNow, type IncrementalPage } from "./incremental";
import { loadStorefrontFacts, pickLocalized, sectionJsonLdTypes, sectionsExcerpt } from "./storefront";

/**
 * GET /ekosistem/v1/content (§7.4): published pages (home, content, landing) and published
 * collections with their canonical URLs, hreflang alternates and structured-data status,
 * derived the way the storefront renders them (packages/theme-engine/src/render/resolve.ts
 * and apps/storefront). altyapi has no blog, so kind "post" never occurs.
 *
 * structuredData.types lists the JSON-LD @types the storefront emits for the URL; score is
 * the share of four checks the URL passes: JSON-LD present, SEO title, meta description,
 * indexable (not noindex).
 */

export interface ContentItem {
  ref: string;
  kind: "home" | "page" | "landing" | "collection";
  url: string;
  title: string;
  seo: { title: string; description: string | null };
  excerpt: string;
  locale: string;
  hreflang: Record<string, string>;
  structuredData: { types: string[]; score: number };
  updatedAt: string;
}

/**
 * Keys of the content set. Live pages are the page versions referenced by the active
 * publication; their updatedAt also moves with each publication so a page re-added by a
 * rollback is reported again. Pages that were published once and are no longer live, and
 * unpublished collections, are reported as tombstones when `since` is given.
 */
function liveSource(storeId: string) {
  return sql`
    with pub as (
      select p.id, p.created_at, p.page_versions from publications p
       where p.id = (select s.active_publication_id from storefront_state s where s.store_id = ${storeId})
    )
    select pg.id::text as ref, false as deleted, greatest(pv.created_at, pg.updated_at, pub.created_at) as eff
      from pub
      cross join lateral jsonb_each_text(pub.page_versions) lv(page_id, version_id)
      join pages pg on pg.id = lv.page_id::uuid and pg.store_id = ${storeId}
      join page_versions pv on pv.id = lv.version_id::uuid
     where pv.type in ('home', 'page', 'landing')
    union all
    select c.id::text, false, c.updated_at from collections c where c.store_id = ${storeId} and c.is_published`;
}

/**
 * Unpublishing clears collections.published_at (packages/catalog saveCollection), so every
 * unpublished collection is a tombstone as of its last change; a tombstone for one that was
 * never published is harmless.
 */
function sinceSource(storeId: string) {
  return sql`
    ${liveSource(storeId)}
    union all
    select pg.id::text, true, greatest(pg.updated_at, coalesce((select p.created_at from publications p join storefront_state s on s.active_publication_id = p.id where s.store_id = ${storeId}), pg.updated_at))
      from pages pg
     where pg.store_id = ${storeId}
       and pg.type in ('home', 'page', 'landing')
       and exists (select 1 from page_versions pv where pv.page_id = pg.id)
       and not exists (
         select 1 from storefront_state s join publications p on p.id = s.active_publication_id
          where s.store_id = ${storeId} and p.page_versions ? pg.id::text)
    union all
    select c.id::text, true, c.updated_at from collections c where c.store_id = ${storeId} and not c.is_published
    union all
    select t.ref, true, t.deleted_at from ekosistem_tombstones t where t.store_id = ${storeId} and t.resource = 'content'`;
}

function score(checks: boolean[]): number {
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

async function buildContent(
  tx: Transaction,
  identity: StoreIdentity,
  livePageVersions: Record<string, string>,
  collectionItemList: boolean,
  ids: string[],
  eff: Map<string, Date>,
  now: Date,
): Promise<Map<string, ContentItem>> {
  const out = new Map<string, ContentItem>();
  if (!ids.length) return out;
  const locale = identity.defaultLocale;
  const others = identity.supportedLocales.filter((l) => l !== locale);
  const pageIds = ids.filter((id) => livePageVersions[id]);
  const collectionIds = ids.filter((id) => !livePageVersions[id]);
  const [versions, pageRows, collectionRows, collectionTrs] = await Promise.all([
    pageIds.length ? tx.select().from(pageVersions).where(inArray(pageVersions.id, pageIds.map((id) => livePageVersions[id]!))) : Promise.resolve([]),
    pageIds.length ? tx.select({ id: pages.id, updatedAt: pages.updatedAt }).from(pages).where(inArray(pages.id, pageIds)) : Promise.resolve([]),
    collectionIds.length ? tx.select().from(collections).where(inArray(collections.id, collectionIds)) : Promise.resolve([]),
    collectionIds.length ? tx.select().from(collectionTranslations).where(inArray(collectionTranslations.collectionId, collectionIds)) : Promise.resolve([]),
  ]);

  for (const v of versions) {
    const kind = v.type as "home" | "page" | "landing";
    const title = pickLocalized(v.title, locale, locale) || (kind === "home" ? identity.name : v.handle);
    const defaultPath = kind === "home" ? "/" : identity.pageUrlStyle === "root" ? `/${encodeURIComponent(v.handle)}` : `/pages/${encodeURIComponent(v.handle)}`;
    // Content pages may set their own canonical path (storefront: page.seo.canonicalPath).
    const canonicalPath = kind !== "home" && v.seo.canonicalPath ? v.seo.canonicalPath : defaultPath;
    const seoTitle = pickLocalized(v.seo.title, locale, locale) || (kind === "home" ? identity.name : title);
    const seoDescription = pickLocalized(v.seo.description, locale, locale) || null;
    // Home: Organization + WebSite; other pages: BreadcrumbList (home › page); FAQ sections: FAQPage.
    const types = [...(kind === "home" ? ["Organization", "WebSite"] : ["BreadcrumbList"]), ...sectionJsonLdTypes(v.content.sections, now)];
    out.set(v.pageId, {
      ref: v.pageId,
      kind,
      url: storeUrl(identity.canonicalHost, canonicalPath),
      title,
      seo: { title: seoTitle, description: seoDescription },
      excerpt: sectionsExcerpt(v.content.sections, locale, locale, now),
      locale,
      hreflang: Object.fromEntries(others.map((l) => [l, storeUrl(identity.canonicalHost, localizedStorePath(l, locale, defaultPath))])),
      structuredData: { types, score: score([types.length > 0, seoTitle.trim() !== "", seoDescription !== null, !(v.seo.noindex ?? false)]) },
      updatedAt: (eff.get(v.pageId) ?? pageRows.find((p) => p.id === v.pageId)?.updatedAt ?? v.createdAt).toISOString(),
    });
  }

  for (const c of collectionRows) {
    const trs = collectionTrs.filter((t) => t.collectionId === c.id);
    const tr = trs.find((t) => t.locale === locale) ?? trs[0];
    if (!tr) continue;
    const description = stripHtml(tr.descriptionHtml);
    const seoTitle = tr.seoTitle || tr.title;
    const seoDescription = tr.seoDescription || description.slice(0, 160) || null;
    const types = ["BreadcrumbList", ...(collectionItemList ? ["ItemList"] : [])];
    out.set(c.id, {
      ref: c.id,
      kind: "collection",
      url: storeUrl(identity.canonicalHost, `/collections/${encodeURIComponent(tr.handle)}`),
      title: tr.title,
      seo: { title: seoTitle, description: seoDescription },
      excerpt: description.slice(0, 1000),
      locale,
      hreflang: Object.fromEntries(
        trs.filter((t) => t.locale !== locale && identity.supportedLocales.includes(t.locale)).map((t) => [t.locale, storeUrl(identity.canonicalHost, localizedStorePath(t.locale, locale, `/collections/${encodeURIComponent(t.handle)}`))]),
      ),
      structuredData: { types, score: score([types.length > 0, seoTitle.trim() !== "", seoDescription !== null, true]) },
      updatedAt: (eff.get(c.id) ?? c.updatedAt).toISOString(),
    });
  }
  return out;
}

export async function exportContent(deps: EkosistemServerDeps, link: LinkRow, query: ReadonlyArray<readonly [string, string]>): Promise<IncrementalPage<ContentItem>> {
  const req = parseIncrementalQuery(query, { allowRefs: false });
  const scope = { organizationId: link.organizationId, storeId: link.storeId };
  const facts = await loadStorefrontFacts(deps.db, scope);
  return withTenantTx(deps.db, scope, async (tx) => {
    const now = await transactionNow(tx);
    const identity = await loadStoreIdentity(tx, link.storeId, deps.storeRootDomain);
    if (!identity) throw new EkosistemError("link_invalid");
    const page = await pageKeys(tx, req.since ? sinceSource(link.storeId) : liveSource(link.storeId), req);
    const live = facts.snapshot?.pageVersions ?? {};
    const built = await buildContent(tx, identity, live, facts.collectionItemList, page.keys.filter((k) => !k.deleted).map((k) => k.ref), new Map(page.keys.map((k) => [k.ref, k.updatedAt])), now);
    return { items: assembleIncremental(page.keys, built), nextCursor: page.nextCursor, asOf: now.toISOString() };
  });
}
