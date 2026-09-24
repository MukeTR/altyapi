import { z } from "zod";
import { AppError, assertStoreLocales, conflict, invalid, isValidSlug, newId, notFound, slugify } from "@altyapi/commerce-core";
import {
  and,
  asc,
  contentEntries,
  contentTypes,
  desc,
  eq,
  inArray,
  navigations,
  ne,
  notInArray,
  pgTimestamp,
  pages,
  pageVersions,
  publications,
  recordTombstone,
  redirects,
  siteProfiles,
  slugHistory,
  sql,
  storefrontState,
  stores,
  themes,
  themeVersions,
  withPlatformTx,
  withTenantTx,
  type Database,
  type LocalizedText,
  type NavigationItem,
  type PageContent,
  type SeoFields,
  type Transaction,
  upsertRedirect,
} from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { appendEvent } from "@altyapi/events";
import { setAssetReferences } from "@altyapi/storage";
import { assertCan, assertModule, type SiteModuleHooks, type SiteModuleHookTarget, type StoreContext } from "@altyapi/tenancy";
import { isSameSitePath, type ContentTypeHooks, type ContentTypeHookTarget } from "@altyapi/content";
import type { ModuleKey, PageUrlStyle, SiteKind } from "@altyapi/site";
import { defaultGlobalSections, defaultModulePage, defaultNavigations, defaultPages, defaultTemplateContent, modulePageTypesFor } from "./defaults";
import { entryTemplateKey, placementOfPage, sectionPolicyFor, type PageTypeName } from "./sections/types";
import { themeSettingsSchema } from "./theme-settings";
import { collectAssetIds, localizedTextMaps, pageContentInputSchema, templateModule, validatePageContent } from "./validation";
import { pagePath } from "./render/routes";
import { LOCALES } from "./sections/primitives";
import { ensureBaseline, navigationSnapshot, nextRevisionNumber, pageSnapshot, recordRevision, themeSnapshot, type RevisionMeta } from "./history";
import { assertHandleFree, assertLiveHandlesFree, isRoutablePageType } from "./handles";

type Scope = { organizationId: string; storeId: string };
const scopeOf = (ctx: StoreContext): Scope => ({ organizationId: ctx.organizationId, storeId: ctx.storeId });

export type PageRow = typeof pages.$inferSelect;
export type PublicationRow = typeof publications.$inferSelect;

/** How the store serves its pages (/pages/{handle} or /{handle}). */
async function pageUrlStyleTx(tx: Transaction, storeId: string): Promise<PageUrlStyle> {
  const [profile] = await tx.select({ style: siteProfiles.pageUrlStyle }).from(siteProfiles).where(eq(siteProfiles.storeId, storeId));
  return profile?.style ?? "prefixed";
}

/** The store's page URL style (site_profiles.page_url_style), for callers that build page paths. */
export async function pageUrlStyle(db: Database, ctx: StoreContext): Promise<PageUrlStyle> {
  assertCan(ctx, "storefront:read");
  return withTenantTx(db, scopeOf(ctx), (tx) => pageUrlStyleTx(tx, ctx.storeId));
}

function contentIssues(issues: { path: string; message: string }[]): never {
  throw new AppError("validation_failed", "errors.content.invalid", { issues });
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/**
 * Creates the default theme, pages, menus and the first publication for a new store, laid out
 * for its site-kind preset (defaults.ts): the shop layout for online stores, home, about,
 * contact and legal pages without any cart for static, corporate and service sites.
 * Idempotent: a store that already has storefront state is left unchanged.
 */
export async function bootstrapStorefront(
  tx: Transaction,
  scope: Scope & { storeName: string; principalId: string | null; preset?: SiteKind | undefined },
): Promise<void> {
  const existing = await tx.query.storefrontState.findFirst({ where: eq(storefrontState.storeId, scope.storeId) });
  if (existing) return;
  const preset = scope.preset ?? "ecommerce";
  const tenant = { organizationId: scope.organizationId, storeId: scope.storeId };

  const themeId = newId();
  await tx.insert(themes).values({
    id: themeId,
    ...tenant,
    name: "Varsayılan tema",
    status: "active",
    draftSettings: themeSettingsSchema.parse({}),
    draftGlobalSections: defaultGlobalSections(preset),
  });
  const pageIds: Record<string, string> = {};
  const publishIds: string[] = [];
  for (const p of defaultPages(scope.storeName, preset)) {
    const id = newId();
    await tx.insert(pages).values({ id, ...tenant, type: p.type, handle: p.handle, title: p.title, draftContent: p.content, status: "draft" });
    pageIds[p.handle] = id;
    if (p.publish) publishIds.push(id);
  }
  for (const n of defaultNavigations(preset, pageIds)) {
    await tx.insert(navigations).values({ id: newId(), ...tenant, ...n });
  }
  await tx.insert(storefrontState).values({ ...tenant, activeThemeId: themeId });
  const created = await tx.query.themes.findFirst({ where: eq(themes.id, themeId) });
  await recordRevision(tx, tenant, { type: "theme", id: themeId, revision: 1, parent: null, snapshot: themeSnapshot(created!), meta: { source: "bootstrap" } });
  for (const p of await tx.select().from(pages).where(eq(pages.storeId, scope.storeId))) {
    await recordRevision(tx, tenant, { type: "page", id: p.id, revision: p.draftRevision, parent: null, snapshot: pageSnapshot(p), meta: { source: "bootstrap" } });
  }
  for (const n of await tx.select().from(navigations).where(eq(navigations.storeId, scope.storeId))) {
    await recordRevision(tx, tenant, { type: "navigation", id: n.id, revision: n.revision, parent: null, snapshot: navigationSnapshot(n), meta: { source: "bootstrap" } });
  }
  await publishCore(tx, tenant, { includeTheme: true, pageIds: publishIds, reason: "initial", principalId: scope.principalId });
}

// ---------------------------------------------------------------------------
// Content type templates
// ---------------------------------------------------------------------------

/**
 * Creates the draft template pages of a routable content type (plan §5): the detail layout
 * (entries.<key>.detail, with entry-main) and, for collections, the index layout
 * (entries.<key>.index, with entry-index-main). Existing template pages are left alone, so it
 * is safe to call again (a reinstalled type, prefixes added later). Until the merchant
 * publishes a template, entries render with the same default layout.
 */
export async function ensureEntryTemplatePages(tx: Transaction, type: ContentTypeHookTarget): Promise<string[]> {
  if (type.kind === "taxonomy") return [];
  const kinds: ("detail" | "index")[] = type.kind === "collection" ? ["detail", "index"] : ["detail"];
  const scope = { organizationId: type.organizationId, storeId: type.storeId };
  const created: string[] = [];
  for (const kind of kinds) {
    const templateKey = entryTemplateKey(type.key, kind);
    const [existing] = await tx.select({ id: pages.id }).from(pages).where(and(eq(pages.storeId, type.storeId), eq(pages.templateKey, templateKey)));
    if (existing) continue;
    const content = defaultTemplateContent(templateKey);
    if (!content) continue;
    const labels = kind === "detail" ? type.labels.name : type.labels.namePlural;
    const [row] = await tx
      .insert(pages)
      .values({ id: newId(), ...scope, type: "template", handle: templateKey, templateKey, title: labels, draftContent: content, status: "draft" })
      .returning();
    await recordRevision(tx, scope, { type: "page", id: row!.id, revision: row!.draftRevision, parent: null, snapshot: pageSnapshot(row!), meta: { source: "content_type_install" } });
    await recordAudit(tx, {
      ...scope,
      action: "page.created",
      resourceType: "page",
      resourceId: row!.id,
      after: { type: "template", templateKey, contentTypeId: type.typeId, source: "content_type_install" },
    });
    created.push(row!.id);
  }
  return created;
}

/**
 * Hooks to pass to the content type services (installType, createCustomType, updateType):
 * a type that has routes gets its draft template pages in the same transaction.
 */
export const entryTemplateHooks: ContentTypeHooks = {
  onInstalled: async (tx, type) => {
    if (type.routable) await ensureEntryTemplatePages(tx, type);
  },
  onRoutable: async (tx, type) => {
    await ensureEntryTemplatePages(tx, type);
  },
};

// ---------------------------------------------------------------------------
// Module pages
// ---------------------------------------------------------------------------

/**
 * Creates the missing pages a store's active modules render their routes with (product and
 * collection pages for the catalog, the cart for commerce, search and not-found for the core),
 * as drafts with the default layout: a site set up without a module gets them when the module
 * is turned on. Until the merchant publishes them, the routes render the same default layout
 * (resolveRoute). Existing pages are left alone; a store whose storefront is not set up yet
 * gets its pages from bootstrapStorefront instead. Returns the ids of the pages created.
 */
export async function ensureModulePages(tx: Transaction, target: SiteModuleHookTarget): Promise<string[]> {
  const state = await tx.query.storefrontState.findFirst({ where: eq(storefrontState.storeId, target.storeId) });
  if (!state) return [];
  const scope = { organizationId: target.organizationId, storeId: target.storeId };
  const created: string[] = [];
  for (const type of modulePageTypesFor(target.activeModules)) {
    const [existing] = await tx
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.storeId, target.storeId), eq(pages.type, type), eq(pages.handle, "default")));
    if (existing) continue;
    const page = defaultModulePage(type);
    const [row] = await tx
      .insert(pages)
      .values({ id: newId(), ...scope, type, handle: page.handle, title: page.title, draftContent: page.content, status: "draft" })
      .returning();
    await recordRevision(tx, scope, { type: "page", id: row!.id, revision: row!.draftRevision, parent: null, snapshot: pageSnapshot(row!), meta: { source: "module_enable" } });
    await recordAudit(tx, {
      ...scope,
      action: "page.created",
      resourceType: "page",
      resourceId: row!.id,
      after: { type, handle: page.handle, source: "module_enable", modules: target.activated },
    });
    created.push(row!.id);
  }
  return created;
}

/** Hooks to pass to the site module services (enableModule): a module turned on gets its pages in the same transaction. */
export const modulePageHooks: SiteModuleHooks = {
  onActivated: async (tx, target) => {
    await ensureModulePages(tx, target);
  },
};

// ---------------------------------------------------------------------------
// Publishing core
// ---------------------------------------------------------------------------

interface PublishOptions {
  includeTheme: boolean;
  /** Pages whose draft should go live; "all" = every page with unpublished changes. */
  pageIds: string[] | "all";
  removePageIds?: string[];
  reason: string;
  principalId: string | null;
}

async function publishCore(tx: Transaction, scope: Scope, opts: PublishOptions): Promise<PublicationRow> {
  // Serialize publishes per store.
  const [state] = await tx.select().from(storefrontState).where(eq(storefrontState.storeId, scope.storeId)).for("update");
  if (!state?.activeThemeId) throw new AppError("precondition_failed", "errors.storefront.not_initialized");

  const current = state.activePublicationId
    ? await tx.query.publications.findFirst({ where: eq(publications.id, state.activePublicationId) })
    : undefined;

  // Theme version
  const theme = await tx.query.themes.findFirst({ where: eq(themes.id, state.activeThemeId) });
  if (!theme) throw notFound("theme", state.activeThemeId);
  const latestThemeVersion = await tx.query.themeVersions.findFirst({
    where: eq(themeVersions.themeId, theme.id),
    orderBy: desc(themeVersions.version),
  });
  let themeVersionId = current?.themeVersionId ?? latestThemeVersion?.id;
  let themePublished = false;
  // Revisions form a tree (undo/redo), so "different from what was published" means "not equal".
  if (opts.includeTheme && (!latestThemeVersion || theme.draftRevision !== latestThemeVersion.sourceRevision)) {
    themeVersionId = newId();
    await tx.insert(themeVersions).values({
      id: themeVersionId,
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      themeId: theme.id,
      version: (latestThemeVersion?.version ?? 0) + 1,
      settings: theme.draftSettings,
      globalSections: theme.draftGlobalSections,
      sourceRevision: theme.draftRevision,
      createdByPrincipalId: opts.principalId,
    });
    themePublished = true;
  } else if (opts.includeTheme && latestThemeVersion) {
    themeVersionId = latestThemeVersion.id;
  }
  if (!themeVersionId) throw new AppError("precondition_failed", "errors.storefront.theme_not_published");

  // Navigation snapshot travels with theme publishes.
  let navigation = current?.navigation ?? {};
  if (opts.includeTheme || !current) {
    const navRows = await tx.select().from(navigations).where(eq(navigations.storeId, scope.storeId));
    navigation = Object.fromEntries(navRows.map((n) => [n.handle, n.items]));
  }

  // Page versions
  const pageMap: Record<string, string> = { ...(current?.pageVersions ?? {}) };
  const candidates =
    opts.pageIds === "all"
      ? await tx.select().from(pages).where(and(eq(pages.storeId, scope.storeId), inArray(pages.status, ["draft", "published"])))
      : opts.pageIds.length
        ? await tx.select().from(pages).where(and(eq(pages.storeId, scope.storeId), inArray(pages.id, opts.pageIds)))
        : [];
  if (opts.pageIds !== "all" && candidates.length !== opts.pageIds.length) throw notFound("page");

  const publishedPages: { pageId: string; pageVersionId: string }[] = [];
  const publishedHandles = new Map<string, string>();
  for (const page of candidates) {
    const needsVersion = !pageMap[page.id] || page.draftRevision !== page.publishedRevision;
    if (!needsVersion) continue;
    const last = await tx.query.pageVersions.findFirst({ where: eq(pageVersions.pageId, page.id), orderBy: desc(pageVersions.version) });
    const versionId = newId();
    await tx.insert(pageVersions).values({
      id: versionId,
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      pageId: page.id,
      version: (last?.version ?? 0) + 1,
      type: page.type,
      handle: page.handle,
      title: page.title,
      content: page.draftContent,
      seo: page.draftSeo,
      sourceRevision: page.draftRevision,
      createdByPrincipalId: opts.principalId,
    });
    await tx
      .update(pages)
      .set({ status: "published", publishedRevision: page.draftRevision, publishAt: null })
      .where(eq(pages.id, page.id));
    pageMap[page.id] = versionId;
    publishedPages.push({ pageId: page.id, pageVersionId: versionId });
    if (isRoutablePageType(page.type)) publishedHandles.set(page.id, page.handle);
  }

  for (const pageId of opts.removePageIds ?? []) {
    delete pageMap[pageId];
    await tx.update(pages).set({ status: "unpublished", publishedRevision: null }).where(eq(pages.id, pageId));
  }

  // Storefront URLs resolve by published handle: a handle still served by another live page
  // (renamed only in its draft) cannot go live twice.
  const otherLiveIds = Object.entries(pageMap)
    .filter(([pageId]) => !publishedHandles.has(pageId))
    .map(([, versionId]) => versionId);
  if (publishedHandles.size && otherLiveIds.length) {
    const [clash] = await tx
      .select({ handle: pageVersions.handle })
      .from(pageVersions)
      .where(
        and(
          inArray(pageVersions.id, otherLiveIds),
          inArray(pageVersions.type, ["page", "landing"]),
          inArray(pageVersions.handle, [...publishedHandles.values()]),
        ),
      )
      .limit(1);
    if (clash) throw conflict("errors.page.handle_taken", { handle: clash.handle });
  }

  const [{ next }] = (await tx
    .select({ next: sql<number>`coalesce(max(${publications.number}), 0) + 1` })
    .from(publications)
    .where(eq(publications.storeId, scope.storeId))) as [{ next: number }];

  const [publication] = await tx
    .insert(publications)
    .values({
      id: newId(),
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      number: Number(next),
      themeVersionId,
      pageVersions: pageMap,
      navigation,
      reason: opts.reason,
      basedOnPublicationId: current?.id ?? null,
      createdByPrincipalId: opts.principalId,
    })
    .returning();

  await switchPointer(tx, scope, publication!, current);

  if (themePublished) {
    await appendEvent(tx, {
      type: "theme.published",
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      aggregateType: "publication",
      aggregateId: publication!.id,
      payload: { publicationId: publication!.id, themeVersionId },
    });
  }
  for (const p of publishedPages) {
    await appendEvent(tx, {
      type: "page.published",
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      aggregateType: "page",
      aggregateId: p.pageId,
      payload: p,
    });
  }
  await recordAudit(tx, {
    organizationId: scope.organizationId,
    storeId: scope.storeId,
    action: "storefront.published",
    resourceType: "publication",
    resourceId: publication!.id,
    after: {
      number: publication!.number,
      reason: opts.reason,
      themePublished,
      pages: publishedPages.map((p) => p.pageId),
      removedPages: opts.removePageIds ?? [],
    },
  });
  return publication!;
}

/**
 * Atomic live switch shared by publish, unpublish, scheduled publishing and rollback: pointer
 * update, 301s for pages whose live URL moved, content cache version bump and the
 * storefront.publication_switched event (edge cache invalidation) in the caller's transaction.
 */
async function switchPointer(tx: Transaction, scope: Scope, publication: PublicationRow, previous: PublicationRow | undefined): Promise<void> {
  await tx
    .update(storefrontState)
    .set({ activePublicationId: publication.id, updatedAt: new Date() })
    .where(eq(storefrontState.storeId, scope.storeId));
  if (previous) await redirectMovedPages(tx, scope, previous.pageVersions, publication.pageVersions);
  const contentVersion = await bumpContentVersion(tx, scope.storeId);
  await appendEvent(tx, {
    type: "storefront.publication_switched",
    organizationId: scope.organizationId,
    storeId: scope.storeId,
    aggregateType: "publication",
    aggregateId: publication.id,
    payload: {
      publicationId: publication.id,
      previousPublicationId: previous?.id ?? null,
      number: publication.number,
      reason: publication.reason,
      contentVersion,
    },
  });
}

/**
 * Keeps old URLs working: every routable page whose live handle differs between two
 * publications (a published rename, or a rollback across one) gets a 301 to its new path.
 */
async function redirectMovedPages(tx: Transaction, scope: Scope, before: Record<string, string>, after: Record<string, string>): Promise<void> {
  const moved = Object.entries(after).filter(([pageId, versionId]) => before[pageId] && before[pageId] !== versionId);
  if (!moved.length) return;
  const rows = await tx
    .select({ id: pageVersions.id, type: pageVersions.type, handle: pageVersions.handle })
    .from(pageVersions)
    .where(inArray(pageVersions.id, moved.flatMap(([pageId, versionId]) => [before[pageId]!, versionId])));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const style = await pageUrlStyleTx(tx, scope.storeId);
  for (const [pageId, versionId] of moved) {
    const previous = byId.get(before[pageId]!);
    const next = byId.get(versionId);
    const oldPath = previous ? pagePath(previous.type, previous.handle, style) : null;
    const newPath = next ? pagePath(next.type, next.handle, style) : null;
    if (!oldPath || !newPath || oldPath === newPath) continue;
    await upsertRedirect(tx, scope, oldPath, newPath, 301, "slug_change");
    await tx
      .insert(slugHistory)
      .values({
        id: newId(),
        organizationId: scope.organizationId,
        storeId: scope.storeId,
        resourceType: "page",
        resourceId: pageId,
        locale: "*",
        slug: previous!.handle,
      })
      .onConflictDoNothing();
  }
}

/** Bumps the store's content version (part of every storefront and edge cache key); returns the new value. */
async function bumpContentVersion(tx: Transaction, storeId: string): Promise<number> {
  const [row] = await tx
    .update(stores)
    .set({ contentVersion: sql`${stores.contentVersion} + 1` })
    .where(eq(stores.id, storeId))
    .returning({ contentVersion: stores.contentVersion });
  return row!.contentVersion;
}

// ---------------------------------------------------------------------------
// Theme draft
// ---------------------------------------------------------------------------

export const updateThemeDraftSchema = z.object({
  expectedRevision: z.number().int().positive(),
  name: z.string().trim().min(1).max(80).optional(),
  settings: z.unknown().optional(),
  globalSections: pageContentInputSchema.optional(),
});

export async function getActiveTheme(db: Database, ctx: StoreContext) {
  assertCan(ctx, "storefront:read");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const state = await tx.query.storefrontState.findFirst({ where: eq(storefrontState.storeId, ctx.storeId) });
    if (!state?.activeThemeId) throw new AppError("precondition_failed", "errors.storefront.not_initialized");
    const theme = await tx.query.themes.findFirst({ where: eq(themes.id, state.activeThemeId) });
    const latest = await tx.query.themeVersions.findFirst({
      where: eq(themeVersions.themeId, state.activeThemeId),
      orderBy: desc(themeVersions.version),
    });
    return { theme: theme!, hasUnpublishedChanges: !latest || theme!.draftRevision !== latest.sourceRevision };
  });
}

export async function updateThemeDraft(db: Database, ctx: StoreContext, input: z.infer<typeof updateThemeDraftSchema>) {
  assertCan(ctx, "storefront:write");
  const settings = input.settings === undefined ? undefined : themeSettingsSchema.parse(input.settings);
  let globalSections: PageContent | undefined;
  if (input.globalSections) {
    const v = validatePageContent(input.globalSections, "global", sectionPolicyFor(ctx.store));
    if (!v.ok) contentIssues(v.issues);
    globalSections = v.content;
  }
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const { theme } = await getActiveThemeTx(tx, ctx.storeId);
    if (theme.draftRevision !== input.expectedRevision) {
      throw conflict("errors.content.revision_conflict", { currentRevision: theme.draftRevision });
    }
    if (globalSections) assertContentLocales(ctx, globalSections, theme.draftGlobalSections);
    await ensureBaseline(tx, scopeOf(ctx), "theme", theme.id, theme.draftRevision, themeSnapshot(theme));
    const revision = await nextRevisionNumber(tx, "theme", theme.id, theme.draftRevision);
    const [updated] = await tx
      .update(themes)
      .set({
        name: input.name ?? theme.name,
        draftSettings: settings ?? theme.draftSettings,
        draftGlobalSections: globalSections ?? theme.draftGlobalSections,
        draftRevision: revision,
      })
      .where(eq(themes.id, theme.id))
      .returning();
    await recordRevision(tx, scopeOf(ctx), { type: "theme", id: theme.id, revision, parent: theme.draftRevision, snapshot: themeSnapshot(updated!) });
    const assetIds = [
      ...(globalSections ? collectAssetIds(globalSections) : collectAssetIds(theme.draftGlobalSections)),
      ...Object.values((settings ?? theme.draftSettings).brand ?? {}).filter((v): v is string => typeof v === "string"),
    ];
    await setAssetReferences(tx, scopeOf(ctx), { type: "theme", id: theme.id }, assetIds);
    return updated!;
  });
}

async function getActiveThemeTx(tx: Transaction, storeId: string) {
  const state = await tx.query.storefrontState.findFirst({ where: eq(storefrontState.storeId, storeId) });
  if (!state?.activeThemeId) throw new AppError("precondition_failed", "errors.storefront.not_initialized");
  const theme = await tx.query.themes.findFirst({ where: eq(themes.id, state.activeThemeId) });
  if (!theme) throw notFound("theme", state.activeThemeId);
  return { state, theme };
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

const localizedTitle = z.partialRecord(z.enum(LOCALES), z.string().trim().max(200));

const seoSchema = z.object({
  title: z.partialRecord(z.enum(LOCALES), z.string().max(70)).optional(),
  description: z.partialRecord(z.enum(LOCALES), z.string().max(320)).optional(),
  imageAssetId: z.uuid().nullable().optional(),
  noindex: z.boolean().optional(),
  /** A path on this site (never another host), localized per language when rendered. */
  canonicalPath: z.string().trim().max(500).refine(isSameSitePath, "errors.page.invalid_canonical_path").nullable().optional(),
});

export const createPageSchema = z.object({
  type: z.enum(["page", "landing"]),
  title: localizedTitle.refine((t) => Object.values(t).some((v) => v && v.length > 0), "errors.page.title_required"),
  handle: z.string().trim().toLowerCase().optional(),
  content: pageContentInputSchema.optional(),
  seo: seoSchema.optional(),
  campaignId: z.uuid().nullable().optional(),
});

export const updatePageSchema = z.object({
  expectedRevision: z.number().int().positive(),
  title: localizedTitle.optional(),
  handle: z.string().trim().toLowerCase().optional(),
  content: pageContentInputSchema.optional(),
  seo: seoSchema.optional(),
  campaignId: z.uuid().nullable().optional(),
});

export const schedulePageSchema = z
  .object({ publishAt: z.coerce.date().nullable(), unpublishAt: z.coerce.date().nullable() })
  .refine((v) => !v.publishAt || !v.unpublishAt || v.publishAt < v.unpublishAt, "errors.page.invalid_schedule");

type LocalizedInput = Record<string, unknown> | undefined;
type PageTextInput = { title?: LocalizedInput; seo?: { title?: LocalizedInput; description?: LocalizedInput } };

/**
 * New or edited page title and SEO text may only be in languages the store publishes in
 * (commerce-core locale registry). Text already stored is compared against, so a page whose
 * existing translations include a language the store has since disabled (or the bilingual
 * defaults of a single-language store) can still be saved unchanged.
 */
function assertPageLocales(ctx: StoreContext, input: PageTextInput, current?: { title: LocalizedInput; seo: PageTextInput["seo"] }) {
  const edited = (next: LocalizedInput, stored: LocalizedInput) => Object.fromEntries(Object.entries(next ?? {}).filter(([l, text]) => text !== stored?.[l]));
  const supported = ctx.store.supportedLocales;
  assertStoreLocales(edited(input.title, current?.title), supported, "title");
  assertStoreLocales(edited(input.seo?.title, current?.seo?.title), supported, "seo.title");
  assertStoreLocales(edited(input.seo?.description, current?.seo?.description), supported, "seo.description");
}

const textPair = (locale: string, text: unknown) => `${locale}\u0000${String(text)}`;

/** Every (language, text) pair of the given localized maps. */
function textPairs(maps: Iterable<Record<string, unknown>>): Set<string> {
  const out = new Set<string>();
  for (const map of maps) for (const [locale, text] of Object.entries(map)) out.add(textPair(locale, text));
  return out;
}

/**
 * The same rule for localized text in section and block props (every section, including
 * global ones) and menu labels: new or edited text only in the store's languages. What is
 * already stored counts by language and value wherever it sits, so reordering sections, items
 * or blocks never turns existing text (bilingual defaults, a since-disabled language) into an
 * edit.
 */
function assertLocalizedMaps(ctx: StoreContext, maps: { path: string; map: Record<string, unknown> }[], stored: Set<string>) {
  for (const { path, map } of maps) {
    const edited = Object.fromEntries(Object.entries(map).filter(([locale, text]) => !stored.has(textPair(locale, text))));
    assertStoreLocales(edited, ctx.store.supportedLocales, path);
  }
}

function assertContentLocales(ctx: StoreContext, next: PageContent, stored?: PageContent) {
  assertLocalizedMaps(ctx, localizedTextMaps(next), textPairs(stored ? localizedTextMaps(stored).map((m) => m.map) : []));
}

function permissionForPageType(type: string, action: "write" | "publish") {
  return (type === "page" || type === "landing" ? `content:${action}` : `storefront:${action}`) as
    | "content:write"
    | "content:publish"
    | "storefront:write"
    | "storefront:publish";
}

export async function listPages(db: Database, ctx: StoreContext, filter: { type?: PageTypeName }): Promise<PageRow[]> {
  assertCan(ctx, "storefront:read");
  return withTenantTx(db, scopeOf(ctx), (tx) =>
    tx
      .select()
      .from(pages)
      .where(and(eq(pages.storeId, ctx.storeId), filter.type ? eq(pages.type, filter.type) : undefined))
      .orderBy(asc(pages.type), asc(pages.handle)),
  );
}

export async function getPage(db: Database, ctx: StoreContext, pageId: string): Promise<PageRow> {
  assertCan(ctx, "storefront:read");
  const page = await withTenantTx(db, scopeOf(ctx), (tx) =>
    tx.query.pages.findFirst({ where: and(eq(pages.id, pageId), eq(pages.storeId, ctx.storeId)) }),
  );
  if (!page) throw notFound("page", pageId);
  return page;
}

/**
 * Live URL path of each given page that is in the active publication. The storefront serves
 * a page under its published handle, so a rename that is only in the draft does not move it.
 */
export async function livePagePaths(db: Database, ctx: StoreContext, pageIds: string[]): Promise<Map<string, string>> {
  assertCan(ctx, "storefront:read");
  if (!pageIds.length) return new Map();
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const state = await tx.query.storefrontState.findFirst({ where: eq(storefrontState.storeId, ctx.storeId) });
    const live = state?.activePublicationId
      ? await tx.query.publications.findFirst({ where: eq(publications.id, state.activePublicationId) })
      : undefined;
    const versionIds = pageIds.flatMap((id) => (live?.pageVersions[id] ? [live.pageVersions[id]] : []));
    if (!versionIds.length) return new Map();
    const rows = await tx
      .select({ pageId: pageVersions.pageId, type: pageVersions.type, handle: pageVersions.handle })
      .from(pageVersions)
      .where(inArray(pageVersions.id, versionIds));
    const style = await pageUrlStyleTx(tx, ctx.storeId);
    return new Map(
      rows.flatMap((r) => {
        const path = pagePath(r.type, r.handle, style);
        return path ? [[r.pageId, path] as const] : [];
      }),
    );
  });
}

export async function createPage(
  db: Database,
  ctx: StoreContext,
  input: z.infer<typeof createPageSchema>,
  opts: { revision?: RevisionMeta } = {},
): Promise<PageRow> {
  assertCan(ctx, "content:write");
  assertPageLocales(ctx, input);
  const handle = input.handle ?? slugify(Object.values(input.title).find(Boolean) ?? "sayfa");
  let content: PageContent = { sections: [] };
  if (input.content) {
    const v = validatePageContent(input.content, input.type, sectionPolicyFor(ctx.store));
    if (!v.ok) contentIssues(v.issues);
    content = v.content;
    assertContentLocales(ctx, content);
  }
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    await assertHandleFree(tx, ctx.storeId, handle);
    const [row] = await tx
      .insert(pages)
      .values({
        id: newId(),
        organizationId: ctx.organizationId,
        storeId: ctx.storeId,
        type: input.type,
        handle,
        title: input.title as Record<string, string>,
        draftContent: content,
        draftSeo: (input.seo ?? {}) as SeoFields,
        campaignId: input.campaignId ?? null,
      })
      .returning();
    await setAssetReferences(tx, scopeOf(ctx), { type: "page", id: row!.id }, [
      ...collectAssetIds(content),
      ...(input.seo?.imageAssetId ? [input.seo.imageAssetId] : []),
    ]);
    await recordRevision(tx, scopeOf(ctx), {
      type: "page",
      id: row!.id,
      revision: row!.draftRevision,
      parent: null,
      snapshot: pageSnapshot(row!),
      ...(opts.revision ? { meta: opts.revision } : {}),
    });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      action: "page.created",
      resourceType: "page",
      resourceId: row!.id,
      after: { type: row!.type, handle, ...(opts.revision?.source ? { source: opts.revision.source } : {}) },
    });
    return row!;
  });
}

export async function updatePageDraft(db: Database, ctx: StoreContext, pageId: string, input: z.infer<typeof updatePageSchema>): Promise<PageRow> {
  const page = await getPage(db, ctx, pageId);
  assertCan(ctx, permissionForPageType(page.type, "write"));
  assertPageLocales(ctx, input, { title: page.title, seo: page.draftSeo });
  if (input.handle !== undefined && page.type !== "page" && page.type !== "landing") {
    throw invalid("errors.page.handle_not_editable");
  }
  const placement = placementOfPage(page);
  // A module's template (entries.post.detail) is edited only while its module is on.
  const owner = templateModule(placement);
  if (owner) assertModule(ctx, owner as ModuleKey);
  let content: PageContent | undefined;
  if (input.content) {
    const v = validatePageContent(input.content, placement, sectionPolicyFor(ctx.store));
    if (!v.ok) contentIssues(v.issues);
    content = v.content;
    assertContentLocales(ctx, content, page.draftContent);
  }
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    if (input.handle && input.handle !== page.handle) await assertHandleFree(tx, ctx.storeId, input.handle, page.id);
    await ensureBaseline(tx, scopeOf(ctx), "page", page.id, page.draftRevision, pageSnapshot(page));
    const revision = await nextRevisionNumber(tx, "page", page.id, page.draftRevision);
    const [updated] = await tx
      .update(pages)
      .set({
        title: (input.title as Record<string, string> | undefined) ?? page.title,
        handle: input.handle ?? page.handle,
        draftContent: content ?? page.draftContent,
        draftSeo: (input.seo as SeoFields | undefined) ?? page.draftSeo,
        campaignId: input.campaignId === undefined ? page.campaignId : input.campaignId,
        draftRevision: revision,
      })
      // Optimistic concurrency: the editor must send the revision it started from.
      .where(and(eq(pages.id, pageId), eq(pages.draftRevision, input.expectedRevision)))
      .returning();
    if (!updated) throw conflict("errors.content.revision_conflict", { currentRevision: page.draftRevision });
    await recordRevision(tx, scopeOf(ctx), { type: "page", id: page.id, revision, parent: page.draftRevision, snapshot: pageSnapshot(updated) });
    const seo = updated.draftSeo;
    await setAssetReferences(tx, scopeOf(ctx), { type: "page", id: page.id }, [
      ...collectAssetIds(updated.draftContent),
      ...(seo.imageAssetId ? [seo.imageAssetId] : []),
    ]);
    return updated;
  });
}

export async function deletePage(db: Database, ctx: StoreContext, pageId: string): Promise<void> {
  const page = await getPage(db, ctx, pageId);
  assertCan(ctx, "content:write");
  if (page.type !== "page" && page.type !== "landing") throw invalid("errors.page.template_not_deletable");
  if (page.status === "published") throw new AppError("precondition_failed", "errors.page.unpublish_first");
  await withTenantTx(db, scopeOf(ctx), async (tx) => {
    await setAssetReferences(tx, scopeOf(ctx), { type: "page", id: pageId }, []);
    await tx.delete(pages).where(eq(pages.id, pageId));
    // Incremental ekosistem content consumers learn about the deletion from the tombstone.
    await recordTombstone(tx, { ...scopeOf(ctx), resource: "content", ref: pageId });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      action: "page.deleted",
      resourceType: "page",
      resourceId: pageId,
      before: { handle: page.handle, type: page.type },
    });
  });
}

export async function schedulePage(db: Database, ctx: StoreContext, pageId: string, input: z.infer<typeof schedulePageSchema>): Promise<PageRow> {
  const page = await getPage(db, ctx, pageId);
  assertCan(ctx, permissionForPageType(page.type, "publish"));
  if (!isRoutablePageType(page.type)) throw invalid("errors.page.schedule_not_supported");
  const scheduled = Boolean(input.publishAt) && page.status !== "published";
  const [row] = await withTenantTx(db, scopeOf(ctx), async (tx) => {
    // Refused now rather than at publish time, when nobody is there to fix it.
    if (scheduled) await assertHandleFree(tx, ctx.storeId, page.handle, page.id);
    return tx
      .update(pages)
      .set({
        publishAt: input.publishAt,
        unpublishAt: input.unpublishAt,
        status: scheduled ? "scheduled" : page.status === "scheduled" ? "draft" : page.status,
      })
      .where(eq(pages.id, pageId))
      .returning();
  });
  return row!;
}

// ---------------------------------------------------------------------------
// Publish / unpublish / rollback
// ---------------------------------------------------------------------------

export const publishSchema = z.object({
  theme: z.boolean().default(false),
  pageIds: z.array(z.uuid()).max(200).default([]),
  all: z.boolean().default(false),
});

export async function publish(db: Database, ctx: StoreContext, input: z.infer<typeof publishSchema>): Promise<PublicationRow> {
  if (input.theme || input.all) assertCan(ctx, "storefront:publish");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    if (input.pageIds.length) {
      const rows = await tx.select({ type: pages.type }).from(pages).where(and(eq(pages.storeId, ctx.storeId), inArray(pages.id, input.pageIds)));
      for (const r of rows) assertCan(ctx, permissionForPageType(r.type, "publish"));
    }
    return publishCore(tx, scopeOf(ctx), {
      includeTheme: input.theme || input.all,
      pageIds: input.all ? "all" : input.pageIds,
      reason: input.all ? "publish_all" : input.theme ? "publish_theme" : "publish_pages",
      principalId: ctx.principal.userId,
    });
  });
}

export async function unpublishPage(db: Database, ctx: StoreContext, pageId: string): Promise<PublicationRow> {
  const page = await getPage(db, ctx, pageId);
  assertCan(ctx, permissionForPageType(page.type, "publish"));
  if (page.type !== "page" && page.type !== "landing") throw invalid("errors.page.template_not_unpublishable");
  return withTenantTx(db, scopeOf(ctx), (tx) =>
    publishCore(tx, scopeOf(ctx), {
      includeTheme: false,
      pageIds: [],
      removePageIds: [pageId],
      reason: "unpublish_page",
      principalId: ctx.principal.userId,
    }),
  );
}

/** Rolls back by creating a new publication that reuses an earlier publication's versions. */
export async function rollbackTo(db: Database, ctx: StoreContext, publicationId: string): Promise<PublicationRow> {
  assertCan(ctx, "storefront:publish");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const [state] = await tx.select().from(storefrontState).where(eq(storefrontState.storeId, ctx.storeId)).for("update");
    const target = await tx.query.publications.findFirst({
      where: and(eq(publications.id, publicationId), eq(publications.storeId, ctx.storeId)),
    });
    if (!target || !state) throw notFound("publication", publicationId);
    const current = state.activePublicationId
      ? await tx.query.publications.findFirst({ where: eq(publications.id, state.activePublicationId) })
      : undefined;
    // Pages deleted since then cannot be restored; keep only versions that still exist.
    const ids = Object.values(target.pageVersions);
    const existing = ids.length
      ? await tx
          .select({ id: pageVersions.id, pageId: pageVersions.pageId, type: pageVersions.type, handle: pageVersions.handle, sourceRevision: pageVersions.sourceRevision })
          .from(pageVersions)
          .where(inArray(pageVersions.id, ids))
      : [];
    const pageMap = Object.fromEntries(existing.map((e) => [e.pageId, e.id]));
    // A handle that goes live again must not be what another page is drafted or scheduled under.
    await assertLiveHandlesFree(tx, ctx.storeId, new Map(existing.filter((e) => isRoutablePageType(e.type)).map((e) => [e.pageId, e.handle])));
    const [{ next }] = (await tx
      .select({ next: sql<number>`coalesce(max(${publications.number}), 0) + 1` })
      .from(publications)
      .where(eq(publications.storeId, ctx.storeId))) as [{ next: number }];
    const [publication] = await tx
      .insert(publications)
      .values({
        id: newId(),
        organizationId: ctx.organizationId,
        storeId: ctx.storeId,
        number: Number(next),
        themeVersionId: target.themeVersionId,
        pageVersions: pageMap,
        navigation: target.navigation,
        reason: `rollback:${target.number}`,
        basedOnPublicationId: state.activePublicationId,
        createdByPrincipalId: ctx.principal.userId,
      })
      .returning();
    // Page status mirrors what is live after the rollback.
    const livePageIds = Object.keys(pageMap);
    await tx
      .update(pages)
      .set({ status: "unpublished", publishedRevision: null })
      .where(and(eq(pages.storeId, ctx.storeId), eq(pages.status, "published"), livePageIds.length ? notInArray(pages.id, livePageIds) : undefined));
    for (const e of existing) {
      await tx.update(pages).set({ status: "published", publishedRevision: e.sourceRevision }).where(eq(pages.id, e.pageId));
    }
    await switchPointer(tx, scopeOf(ctx), publication!, current);
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      action: "storefront.rolled_back",
      resourceType: "publication",
      resourceId: publication!.id,
      before: { publicationId: state.activePublicationId },
      after: { publicationId: publication!.id, restoredFrom: target.number },
    });
    return publication!;
  });
}

export async function listPublications(db: Database, ctx: StoreContext, limit = 50): Promise<(PublicationRow & { isActive: boolean })[]> {
  assertCan(ctx, "storefront:read");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const state = await tx.query.storefrontState.findFirst({ where: eq(storefrontState.storeId, ctx.storeId) });
    const rows = await tx
      .select()
      .from(publications)
      .where(eq(publications.storeId, ctx.storeId))
      .orderBy(desc(publications.number))
      .limit(limit);
    return rows.map((r) => ({ ...r, isActive: r.id === state?.activePublicationId }));
  });
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

const navLinkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("url"), url: z.string().max(2000).refine((v) => v.startsWith("/") || /^https?:\/\//.test(v)) }),
  z.object({ type: z.literal("page"), pageId: z.uuid() }),
  z.object({ type: z.literal("collection"), collectionId: z.uuid() }),
  z.object({ type: z.literal("product"), productId: z.uuid() }),
  /** A content entry: rendered with its live path in each language, hidden while it is not live. */
  z.object({ type: z.literal("entry"), entryId: z.uuid() }),
  /** The index route of a content type (/hizmetler, /en/services), hidden while the type has none. */
  z.object({ type: z.literal("entry_index"), typeId: z.uuid() }),
  z.object({ type: z.enum(["home", "search", "cart"]) }),
]);

type NavInput = { id?: string; label: Partial<Record<(typeof LOCALES)[number], string>>; link: z.infer<typeof navLinkSchema>; children?: NavInput[] };

const navItemSchema: z.ZodType<NavInput> = z.lazy(() =>
  z.object({
    id: z.string().max(64).optional(),
    label: z.partialRecord(z.enum(LOCALES), z.string().max(80)),
    link: navLinkSchema,
    children: z.array(navItemSchema).max(30).optional(),
  }),
);

export const upsertNavigationSchema = z.object({
  name: z.string().trim().min(1).max(80),
  items: z.array(navItemSchema).max(50),
});

/** Menu labels of a tree with their paths (`items.0.children.1.label`). */
function navLabels(items: { label: Record<string, unknown>; children?: unknown[] }[], path = "items"): { path: string; map: Record<string, unknown> }[] {
  return items.flatMap((item, i) => [
    { path: `${path}.${i}.label`, map: item.label },
    ...navLabels((item.children ?? []) as typeof items, `${path}.${i}.children`),
  ]);
}

/** Links of a menu tree, depth first. */
function navLinks(items: readonly NavigationItem[]): NavigationItem["link"][] {
  return items.flatMap((i) => [i.link, ...navLinks(i.children ?? [])]);
}

/**
 * Entry and content type links must point at records of this store: an entry that is not
 * archived, a type that is active. Whether they are live is decided when the menu renders
 * (an unpublished entry's link is hidden until it goes live).
 */
async function assertNavTargets(tx: Transaction, storeId: string, items: readonly NavigationItem[]): Promise<void> {
  const links = navLinks(items);
  const entryIds = [...new Set(links.flatMap((l) => (l.type === "entry" ? [l.entryId] : [])))];
  const typeIds = [...new Set(links.flatMap((l) => (l.type === "entry_index" ? [l.typeId] : [])))];
  if (entryIds.length) {
    const found = await tx
      .select({ id: contentEntries.id })
      .from(contentEntries)
      .where(and(eq(contentEntries.storeId, storeId), inArray(contentEntries.id, entryIds), ne(contentEntries.status, "archived")));
    const missing = entryIds.filter((id) => !found.some((f) => f.id === id));
    if (missing.length) throw invalid("errors.navigation.entry_not_found", { entryIds: missing });
  }
  if (typeIds.length) {
    const found = await tx
      .select({ id: contentTypes.id })
      .from(contentTypes)
      .where(and(eq(contentTypes.storeId, storeId), inArray(contentTypes.id, typeIds), eq(contentTypes.status, "active")));
    const missing = typeIds.filter((id) => !found.some((f) => f.id === id));
    if (missing.length) throw invalid("errors.navigation.content_type_not_found", { typeIds: missing });
  }
}

function normalizeNav(items: NavInput[], depth = 1): NavigationItem[] {
  if (depth > 3) throw invalid("errors.navigation.too_deep");
  return items.map((i) => ({
    id: i.id ?? newId(),
    label: i.label as LocalizedText,
    link: i.link as NavigationItem["link"],
    ...(i.children?.length ? { children: normalizeNav(i.children, depth + 1) } : {}),
  }));
}

export async function listNavigations(db: Database, ctx: StoreContext) {
  assertCan(ctx, "storefront:read");
  return withTenantTx(db, scopeOf(ctx), (tx) => tx.select().from(navigations).where(eq(navigations.storeId, ctx.storeId)).orderBy(asc(navigations.handle)));
}

/** Navigation edits are drafts; they go live with the next theme publish. */
export async function upsertNavigation(db: Database, ctx: StoreContext, handle: string, input: z.infer<typeof upsertNavigationSchema>) {
  assertCan(ctx, "storefront:write");
  if (!isValidSlug(handle)) throw invalid("errors.navigation.invalid_handle");
  const items = normalizeNav(input.items);
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const existing = await tx.query.navigations.findFirst({ where: and(eq(navigations.storeId, ctx.storeId), eq(navigations.handle, handle)) });
    assertLocalizedMaps(ctx, navLabels(items), textPairs(navLabels(existing?.items ?? []).map((l) => l.map)));
    await assertNavTargets(tx, ctx.storeId, items);
    let row: typeof navigations.$inferSelect;
    if (existing) {
      await ensureBaseline(tx, scopeOf(ctx), "navigation", existing.id, existing.revision, navigationSnapshot(existing));
      const revision = await nextRevisionNumber(tx, "navigation", existing.id, existing.revision);
      [row] = (await tx.update(navigations).set({ name: input.name, items, revision }).where(eq(navigations.id, existing.id)).returning()) as [typeof row];
      await recordRevision(tx, scopeOf(ctx), { type: "navigation", id: existing.id, revision, parent: existing.revision, snapshot: navigationSnapshot(row) });
    } else {
      [row] = (await tx.insert(navigations).values({ id: newId(), organizationId: ctx.organizationId, storeId: ctx.storeId, handle, name: input.name, items }).returning()) as [typeof row];
      await recordRevision(tx, scopeOf(ctx), { type: "navigation", id: row.id, revision: row.revision, parent: null, snapshot: navigationSnapshot(row) });
    }
    // Menus go live with the theme: record a theme revision so the theme draft shows unpublished changes.
    const { theme } = await getActiveThemeTx(tx, ctx.storeId);
    await ensureBaseline(tx, scopeOf(ctx), "theme", theme.id, theme.draftRevision, themeSnapshot(theme));
    const themeRevision = await nextRevisionNumber(tx, "theme", theme.id, theme.draftRevision);
    await tx.update(themes).set({ draftRevision: themeRevision }).where(eq(themes.id, theme.id));
    await recordRevision(tx, scopeOf(ctx), {
      type: "theme",
      id: theme.id,
      revision: themeRevision,
      parent: theme.draftRevision,
      snapshot: themeSnapshot(theme),
      meta: { source: "navigation_change", label: `navigation:${handle}` },
    });
    return row;
  });
}

// ---------------------------------------------------------------------------
// Redirects
// ---------------------------------------------------------------------------

const pathSchema = z
  .string()
  .trim()
  .max(1000)
  .refine((p) => p.startsWith("/") && !p.startsWith("//"), "errors.redirect.invalid_path");

/**
 * System routes can never be redirected or shadowed by merchant content (checkout, cart,
 * account, APIs, crawler files and framework assets).
 */
export const RESERVED_PATH = /^\/(?:[a-z]{2}\/)?(?:checkout|cart|account|api|_next|__edge|robots\.txt|sitemap\.xml|sitemaps)(?:\/|$|\?)/i;

export const createRedirectSchema = z.object({
  fromPath: pathSchema.refine((p) => !RESERVED_PATH.test(p), "errors.redirect.reserved_path"),
  toPath: z.union([pathSchema, z.url()]),
  statusCode: z.union([z.literal(301), z.literal(302)]).default(301),
});

export async function listRedirects(db: Database, ctx: StoreContext) {
  assertCan(ctx, "storefront:read");
  return withTenantTx(db, scopeOf(ctx), (tx) => tx.select().from(redirects).where(eq(redirects.storeId, ctx.storeId)).orderBy(asc(redirects.fromPath)));
}

/** Creates a redirect, or updates the one that already starts at fromPath. */
export async function createRedirect(db: Database, ctx: StoreContext, input: z.infer<typeof createRedirectSchema>) {
  assertCan(ctx, "storefront:write");
  if (input.fromPath === input.toPath) throw invalid("errors.redirect.loop");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const byFromPath = and(eq(redirects.storeId, ctx.storeId), eq(redirects.fromPath, input.fromPath));
    const before = await tx.query.redirects.findFirst({ where: byFromPath });
    await upsertRedirect(tx, scopeOf(ctx), input.fromPath, input.toPath, input.statusCode, "manual");
    const saved = await tx.query.redirects.findFirst({ where: byFromPath });
    if (!saved) throw notFound("redirect", input.fromPath);
    const contentVersion = await bumpContentVersion(tx, ctx.storeId);
    await appendEvent(tx, {
      type: "redirect.changed",
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      aggregateType: "redirect",
      aggregateId: saved.id,
      payload: { redirectId: saved.id, fromPath: saved.fromPath, toPath: saved.toPath, change: before ? "updated" : "created", contentVersion },
    });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      action: "redirect.saved",
      resourceType: "redirect",
      resourceId: saved.id,
      ...(before ? { before: { fromPath: before.fromPath, toPath: before.toPath, statusCode: before.statusCode } } : {}),
      after: input,
    });
    return saved;
  });
}

export async function deleteRedirect(db: Database, ctx: StoreContext, redirectId: string) {
  assertCan(ctx, "storefront:write");
  await withTenantTx(db, scopeOf(ctx), async (tx) => {
    const [deleted] = await tx.delete(redirects).where(and(eq(redirects.id, redirectId), eq(redirects.storeId, ctx.storeId))).returning();
    if (!deleted) throw notFound("redirect", redirectId);
    const contentVersion = await bumpContentVersion(tx, ctx.storeId);
    await appendEvent(tx, {
      type: "redirect.changed",
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      aggregateType: "redirect",
      aggregateId: deleted.id,
      payload: { redirectId: deleted.id, fromPath: deleted.fromPath, toPath: null, change: "deleted", contentVersion },
    });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      action: "redirect.deleted",
      resourceType: "redirect",
      resourceId: deleted.id,
      before: { fromPath: deleted.fromPath, toPath: deleted.toPath, statusCode: deleted.statusCode },
    });
  });
}

// ---------------------------------------------------------------------------
// Scheduled publishing (worker)
// ---------------------------------------------------------------------------

/** Where the scheduled publishing run reports pages it could not handle (the worker logger). */
export interface ScheduleLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

type DuePage = { id: string; organizationId: string; storeId: string; status: PageRow["status"]; publishAt: Date | null; unpublishAt: Date | null };

/**
 * Publishes scheduled pages whose time has come and unpublishes expired landing pages, the
 * longest overdue first. Every page runs in its own transaction and never holds up the rest
 * of the batch (other pages, other stores). A page the platform refuses (a domain error, such
 * as a handle another page is served under) leaves the schedule with an audit entry and a
 * page.schedule_failed event instead of failing again on every run; an unexpected error keeps
 * it scheduled for the next run. Returns the number of pages handled.
 */
export async function runScheduledPublishing(db: Database, logger?: ScheduleLogger): Promise<number> {
  const now = new Date();
  const dueAt = sql`case when ${pages.status} = 'scheduled' then ${pages.publishAt} else ${pages.unpublishAt} end`;
  const due: DuePage[] = await withPlatformTx(db, (tx) =>
    tx
      .select({ id: pages.id, organizationId: pages.organizationId, storeId: pages.storeId, status: pages.status, publishAt: pages.publishAt, unpublishAt: pages.unpublishAt })
      .from(pages)
      .where(
        sql`(${pages.status} = 'scheduled' and ${pages.publishAt} <= ${pgTimestamp(now)})
          or (${pages.status} = 'published' and ${pages.unpublishAt} <= ${pgTimestamp(now)})`,
      )
      .orderBy(asc(dueAt), asc(pages.id))
      .limit(100),
  );
  let handled = 0;
  for (const p of due) {
    const scope = { organizationId: p.organizationId, storeId: p.storeId };
    const expired = p.unpublishAt !== null && p.unpublishAt <= now;
    const operation = expired ? "unpublish" : "publish";
    try {
      await withTenantTx(db, scope, async (tx) => {
        // The merchant may have published, unpublished or rescheduled it since the batch was read.
        const [current] = await tx.select({ status: pages.status, publishAt: pages.publishAt, unpublishAt: pages.unpublishAt }).from(pages).where(eq(pages.id, p.id));
        const stillDue = expired
          ? current?.status === "published" && current.unpublishAt !== null && current.unpublishAt <= now
          : current?.status === "scheduled" && current.publishAt !== null && current.publishAt <= now;
        if (!stillDue) return;
        await publishCore(tx, scope, {
          includeTheme: false,
          pageIds: expired ? [] : [p.id],
          removePageIds: expired ? [p.id] : [],
          reason: expired ? "scheduled_unpublish" : "scheduled_publish",
          principalId: null,
        });
        if (expired) await tx.update(pages).set({ unpublishAt: null }).where(eq(pages.id, p.id));
      });
      handled++;
    } catch (err) {
      if (!(err instanceof AppError)) {
        logger?.error({ err, pageId: p.id, storeId: p.storeId, operation }, "scheduled page publishing failed; retrying on the next run");
        continue;
      }
      try {
        await withTenantTx(db, scope, (tx) => abandonSchedule(tx, scope, p.id, operation, err));
        logger?.warn({ pageId: p.id, storeId: p.storeId, operation, error: err.messageKey, details: err.details }, "scheduled page publishing refused; page left the schedule");
        handled++;
      } catch (abandonErr) {
        logger?.error({ err: abandonErr, pageId: p.id, storeId: p.storeId, operation }, "scheduled page could not leave the schedule; retrying on the next run");
      }
    }
  }
  return handled;
}

/**
 * Takes a page the platform refused to publish (or unpublish) on schedule off the schedule:
 * a refused publish goes back to draft, a refused unpublish keeps the page live without an
 * end date. The refusal is audited and announced (page.schedule_failed) for the merchant.
 */
async function abandonSchedule(tx: Transaction, scope: Scope, pageId: string, operation: "publish" | "unpublish", err: AppError): Promise<void> {
  const [row] =
    operation === "publish"
      ? await tx
          .update(pages)
          .set({ status: "draft", publishAt: null })
          .where(and(eq(pages.id, pageId), eq(pages.status, "scheduled")))
          .returning({ id: pages.id })
      : await tx
          .update(pages)
          .set({ unpublishAt: null })
          .where(and(eq(pages.id, pageId), eq(pages.status, "published")))
          .returning({ id: pages.id });
  if (!row) return;
  const details = err.details ?? {};
  await appendEvent(tx, {
    type: "page.schedule_failed",
    organizationId: scope.organizationId,
    storeId: scope.storeId,
    aggregateType: "page",
    aggregateId: pageId,
    payload: { pageId, operation, errorKey: err.messageKey, details },
  });
  await recordAudit(tx, {
    organizationId: scope.organizationId,
    storeId: scope.storeId,
    action: "page.schedule_failed",
    resourceType: "page",
    resourceId: pageId,
    after: { operation, error: err.messageKey, details },
  });
}
