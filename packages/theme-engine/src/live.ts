import {
  and,
  desc,
  eq,
  inArray,
  navigations,
  pages,
  pageVersions,
  publications,
  redirects,
  sql,
  storefrontState,
  themes,
  themeVersions,
  withTenantTx,
  type Database,
  type LocalizedText,
  type NavigationItem,
  type PageContent,
  type SeoFields,
} from "@altyapi/database";
import { signValue, verifySignedValue } from "@altyapi/auth";
import { themeSettingsSchema, type ThemeSettings } from "./theme-settings";

export interface TenantRef {
  organizationId: string;
  storeId: string;
}

export interface StorefrontSnapshot {
  mode: "live" | "preview";
  publicationId: string | null;
  themeSettings: ThemeSettings;
  globalSections: PageContent;
  navigation: Record<string, NavigationItem[]>;
  /** pageId → pageVersionId for live mode. */
  pageVersions: Record<string, string>;
}

export interface ResolvedPage {
  id: string;
  type: string;
  handle: string;
  title: LocalizedText;
  content: PageContent;
  seo: SeoFields;
  versionId: string | null;
}

/** Live storefront state as referenced by the active publication pointer. */
export async function loadLiveSnapshot(db: Database, ref: TenantRef): Promise<StorefrontSnapshot | null> {
  return withTenantTx(db, ref, async (tx) => {
    const state = await tx.query.storefrontState.findFirst({ where: eq(storefrontState.storeId, ref.storeId) });
    if (!state?.activePublicationId) return null;
    const pub = await tx.query.publications.findFirst({ where: eq(publications.id, state.activePublicationId) });
    if (!pub) return null;
    const tv = await tx.query.themeVersions.findFirst({ where: eq(themeVersions.id, pub.themeVersionId) });
    if (!tv) return null;
    return {
      mode: "live",
      publicationId: pub.id,
      themeSettings: themeSettingsSchema.parse(tv.settings),
      globalSections: tv.globalSections,
      navigation: pub.navigation,
      pageVersions: pub.pageVersions,
    };
  });
}

/** Draft state for the editor preview (never cached). */
export async function loadPreviewSnapshot(db: Database, ref: TenantRef): Promise<StorefrontSnapshot | null> {
  return withTenantTx(db, ref, async (tx) => {
    const state = await tx.query.storefrontState.findFirst({ where: eq(storefrontState.storeId, ref.storeId) });
    if (!state?.activeThemeId) return null;
    const theme = await tx.query.themes.findFirst({ where: eq(themes.id, state.activeThemeId) });
    if (!theme) return null;
    const navRows = await tx.select().from(navigations).where(eq(navigations.storeId, ref.storeId));
    return {
      mode: "preview",
      publicationId: state.activePublicationId,
      themeSettings: themeSettingsSchema.parse(theme.draftSettings),
      globalSections: theme.draftGlobalSections,
      navigation: Object.fromEntries(navRows.map((n) => [n.handle, n.items])),
      pageVersions: {},
    };
  });
}

/**
 * Finds the page to render for a (type, handle). Live mode only returns pages that are part
 * of the active publication and matches the handle of the frozen page version, so a handle
 * renamed in the draft keeps serving its published URL until it is published. Preview mode
 * matches the draft handle.
 */
export async function resolvePage(
  db: Database,
  ref: TenantRef,
  snapshot: StorefrontSnapshot,
  type: string,
  handle: string,
): Promise<ResolvedPage | null> {
  const pageType = type as typeof pages.$inferSelect.type;
  if (snapshot.mode === "preview") {
    return withTenantTx(db, ref, async (tx) => {
      const page = await tx.query.pages.findFirst({
        where: and(eq(pages.storeId, ref.storeId), eq(pages.type, pageType), eq(pages.handle, handle)),
      });
      if (!page) return null;
      return { id: page.id, type: page.type, handle: page.handle, title: page.title, content: page.draftContent, seo: page.draftSeo, versionId: null };
    });
  }
  const liveIds = Object.values(snapshot.pageVersions);
  if (!liveIds.length) return null;
  return withTenantTx(db, ref, async (tx) => {
    // Publishing rejects two live pages on one URL; the newest version wins for older data.
    const [v] = await tx
      .select()
      .from(pageVersions)
      .where(and(eq(pageVersions.storeId, ref.storeId), inArray(pageVersions.id, liveIds), eq(pageVersions.type, pageType), eq(pageVersions.handle, handle)))
      .orderBy(desc(pageVersions.createdAt))
      .limit(1);
    if (!v) return null;
    return { id: v.pageId, type: v.type, handle: v.handle, title: v.title, content: v.content, seo: v.seo, versionId: v.id };
  });
}

/**
 * Locales in which a page has content of its own: a localized title or SEO title. Other
 * locales render the default-language fallback and get no hreflang or sitemap entry. A
 * page without any localized title counts as default-locale content.
 *
 * The home page is the entry point of every language the store publishes in: its title is
 * never rendered (the store name and the sections are), and most of it is bound data that
 * follows the requested language (products, collections, menus), so every supported locale
 * counts as content there.
 */
export function pageContentLocales(
  page: { type: string; title: LocalizedText; seo: SeoFields },
  supportedLocales: readonly string[],
  defaultLocale: string,
): string[] {
  if (page.type === "home") return [...supportedLocales];
  const has = (map: LocalizedText | undefined, locale: string) => (map?.[locale]?.trim().length ?? 0) > 0;
  const locales = supportedLocales.filter((l) => has(page.title, l) || has(page.seo.title, l));
  return locales.length ? locales : [defaultLocale];
}

/**
 * Published home, content and landing page versions for sitemaps. liveSince is when the live
 * version started serving: the first publication of its latest uninterrupted run in the
 * publication sequence. A rollback therefore dates the restored content to the rollback, never
 * back to when that version was first created (a lastmod must not move backwards).
 */
export async function listLivePages(db: Database, ref: TenantRef, snapshot: StorefrontSnapshot) {
  const ids = Object.values(snapshot.pageVersions);
  if (!ids.length) return [];
  return withTenantTx(db, ref, async (tx) => {
    const rows = await tx
      .select({
        id: pageVersions.id,
        pageId: pageVersions.pageId,
        type: pageVersions.type,
        handle: pageVersions.handle,
        title: pageVersions.title,
        seo: pageVersions.seo,
        createdAt: pageVersions.createdAt,
      })
      .from(pageVersions)
      .where(and(eq(pageVersions.storeId, ref.storeId), inArray(pageVersions.id, ids), inArray(pageVersions.type, ["home", "page", "landing"])));
    const since = new Map<string, Date>();
    if (snapshot.publicationId && rows.length) {
      const runs = await tx.execute<{ page_id: string; live_since: Date | string }>(sql`
        select e.key as page_id,
               (select min(p.created_at) from publications p
                 where p.store_id = ${ref.storeId} and p.number <= a.number
                   and p.number > coalesce((select max(q.number) from publications q
                                             where q.store_id = ${ref.storeId} and q.number <= a.number
                                               and (q.page_versions ->> e.key) is distinct from e.value), 0)) as live_since
          from publications a cross join lateral jsonb_each_text(a.page_versions) e
         where a.id = ${snapshot.publicationId}`);
      for (const r of runs) since.set(r.page_id, new Date(r.live_since));
    }
    return rows.map((r) => ({ ...r, liveSince: since.get(r.pageId) ?? r.createdAt }));
  });
}

export async function findRedirect(db: Database, ref: TenantRef, path: string) {
  return withTenantTx(db, ref, (tx) =>
    tx.query.redirects.findFirst({ where: and(eq(redirects.storeId, ref.storeId), eq(redirects.fromPath, path)) }),
  );
}

// ---------------------------------------------------------------------------
// Preview tokens
// ---------------------------------------------------------------------------

const PREVIEW_TTL_SECONDS = 3600;

/** Signed, short-lived token that lets the storefront render drafts for a single store. */
export function createPreviewToken(secret: string, storeId: string): { token: string; expiresInSeconds: number } {
  return { token: signValue(secret, { s: storeId, k: "preview" }, PREVIEW_TTL_SECONDS), expiresInSeconds: PREVIEW_TTL_SECONDS };
}

export function verifyPreviewToken(secret: string, token: string, storeId: string): boolean {
  const payload = verifySignedValue<{ s: string; k: string }>(secret, token);
  return payload?.k === "preview" && payload.s === storeId;
}
