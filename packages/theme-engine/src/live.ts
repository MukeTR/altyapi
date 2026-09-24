import {
  and,
  eq,
  navigations,
  pages,
  pageVersions,
  publications,
  redirects,
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
 * of the active publication, using the frozen page version.
 */
export async function resolvePage(
  db: Database,
  ref: TenantRef,
  snapshot: StorefrontSnapshot,
  type: string,
  handle: string,
): Promise<ResolvedPage | null> {
  return withTenantTx(db, ref, async (tx) => {
    const page = await tx.query.pages.findFirst({
      where: and(eq(pages.storeId, ref.storeId), eq(pages.type, type as typeof pages.$inferSelect.type), eq(pages.handle, handle)),
    });
    if (!page) return null;
    if (snapshot.mode === "preview") {
      return { id: page.id, type: page.type, handle: page.handle, title: page.title, content: page.draftContent, seo: page.draftSeo, versionId: null };
    }
    const versionId = snapshot.pageVersions[page.id];
    if (!versionId) return null;
    const v = await tx.query.pageVersions.findFirst({ where: eq(pageVersions.id, versionId) });
    if (!v) return null;
    return { id: page.id, type: v.type, handle: v.handle, title: v.title, content: v.content, seo: v.seo, versionId: v.id };
  });
}

/** Published page/landing handles for sitemaps. */
export async function listLivePages(db: Database, ref: TenantRef, snapshot: StorefrontSnapshot) {
  const ids = Object.values(snapshot.pageVersions);
  if (!ids.length) return [];
  return withTenantTx(db, ref, async (tx) => {
    const rows = await tx.select({ id: pageVersions.id, type: pageVersions.type, handle: pageVersions.handle, seo: pageVersions.seo, createdAt: pageVersions.createdAt }).from(pageVersions).where(eq(pageVersions.storeId, ref.storeId));
    const live = new Set(ids);
    return rows.filter((r) => live.has(r.id) && (r.type === "page" || r.type === "landing" || r.type === "home"));
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
