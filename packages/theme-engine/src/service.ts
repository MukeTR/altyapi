import { z } from "zod";
import { AppError, conflict, invalid, isValidSlug, newId, notFound, slugify } from "@altyapi/commerce-core";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  navigations,
  notInArray,
  pgTimestamp,
  pages,
  pageVersions,
  publications,
  redirects,
  slugHistory,
  sql,
  storefrontState,
  stores,
  themes,
  themeVersions,
  withPlatformTx,
  withTenantTx,
  type Database,
  type NavigationItem,
  type PageContent,
  type SeoFields,
  type Transaction,
  upsertRedirect,
} from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { appendEvent } from "@altyapi/events";
import { setAssetReferences } from "@altyapi/storage";
import { assertCan, type StoreContext } from "@altyapi/tenancy";
import { defaultGlobalSections, defaultNavigations, defaultPages } from "./defaults";
import type { PageTypeName } from "./sections/definitions";
import { themeSettingsSchema } from "./theme-settings";
import { collectAssetIds, pageContentInputSchema, validatePageContent } from "./validation";
import { LOCALES } from "./sections/primitives";

type Scope = { organizationId: string; storeId: string };
const scopeOf = (ctx: StoreContext): Scope => ({ organizationId: ctx.organizationId, storeId: ctx.storeId });

export type PageRow = typeof pages.$inferSelect;
export type PublicationRow = typeof publications.$inferSelect;

/** Public URL path of routable page types. */
export function pagePath(type: string, handle: string): string | null {
  if (type === "home") return "/";
  if (type === "page" || type === "landing") return `/pages/${handle}`;
  return null;
}

function contentIssues(issues: { path: string; message: string }[]): never {
  throw new AppError("validation_failed", "errors.content.invalid", { issues });
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/**
 * Creates the default theme, template pages, menus and the first publication for a new
 * store. Idempotent: a store that already has storefront state is left unchanged.
 */
export async function bootstrapStorefront(tx: Transaction, scope: Scope & { storeName: string; principalId: string | null }): Promise<void> {
  const existing = await tx.query.storefrontState.findFirst({ where: eq(storefrontState.storeId, scope.storeId) });
  if (existing) return;

  const themeId = newId();
  await tx.insert(themes).values({
    id: themeId,
    organizationId: scope.organizationId,
    storeId: scope.storeId,
    name: "Varsayılan tema",
    status: "active",
    draftSettings: themeSettingsSchema.parse({}),
    draftGlobalSections: defaultGlobalSections(),
  });
  for (const p of defaultPages(scope.storeName)) {
    await tx.insert(pages).values({
      id: newId(),
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      type: p.type,
      handle: p.handle,
      title: p.title,
      draftContent: p.content,
      status: "draft",
    });
  }
  for (const n of defaultNavigations()) {
    await tx.insert(navigations).values({ id: newId(), organizationId: scope.organizationId, storeId: scope.storeId, ...n });
  }
  await tx.insert(storefrontState).values({ storeId: scope.storeId, organizationId: scope.organizationId, activeThemeId: themeId });
  await publishCore(tx, scope, { includeTheme: true, pageIds: "all", reason: "initial", principalId: scope.principalId });
}

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
  if (opts.includeTheme && (!latestThemeVersion || theme.draftRevision > latestThemeVersion.sourceRevision)) {
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
  for (const page of candidates) {
    const needsVersion = !pageMap[page.id] || page.draftRevision > (page.publishedRevision ?? 0);
    if (!needsVersion) continue;
    const previous = pageMap[page.id]
      ? await tx.query.pageVersions.findFirst({ where: eq(pageVersions.id, pageMap[page.id]!) })
      : undefined;
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

    // Handle changed on a routable page: keep the old URL working with a 301.
    const oldPath = previous ? pagePath(previous.type, previous.handle) : null;
    const newPath = pagePath(page.type, page.handle);
    if (oldPath && newPath && oldPath !== newPath) {
      await upsertRedirect(tx, scope, oldPath, newPath, 301, "slug_change");
      await tx
        .insert(slugHistory)
        .values({
          id: newId(),
          organizationId: scope.organizationId,
          storeId: scope.storeId,
          resourceType: "page",
          resourceId: page.id,
          locale: "*",
          slug: previous!.handle,
        })
        .onConflictDoNothing();
    }
  }

  for (const pageId of opts.removePageIds ?? []) {
    delete pageMap[pageId];
    await tx.update(pages).set({ status: "unpublished", publishedRevision: null }).where(eq(pages.id, pageId));
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

  await switchPointer(tx, scope, publication!.id);

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

/** Atomic live switch: pointer update and content cache version bump in one transaction. */
async function switchPointer(tx: Transaction, scope: Scope, publicationId: string): Promise<void> {
  await tx
    .update(storefrontState)
    .set({ activePublicationId: publicationId, updatedAt: new Date() })
    .where(eq(storefrontState.storeId, scope.storeId));
  await tx
    .update(stores)
    .set({ contentVersion: sql`${stores.contentVersion} + 1` })
    .where(eq(stores.id, scope.storeId));
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
    return { theme: theme!, hasUnpublishedChanges: !latest || theme!.draftRevision > latest.sourceRevision };
  });
}

export async function updateThemeDraft(db: Database, ctx: StoreContext, input: z.infer<typeof updateThemeDraftSchema>) {
  assertCan(ctx, "storefront:write");
  const settings = input.settings === undefined ? undefined : themeSettingsSchema.parse(input.settings);
  let globalSections: PageContent | undefined;
  if (input.globalSections) {
    const v = validatePageContent(input.globalSections, "global");
    if (!v.ok) contentIssues(v.issues);
    globalSections = v.content;
  }
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const { theme } = await getActiveThemeTx(tx, ctx.storeId);
    if (theme.draftRevision !== input.expectedRevision) {
      throw conflict("errors.content.revision_conflict", { currentRevision: theme.draftRevision });
    }
    const [updated] = await tx
      .update(themes)
      .set({
        name: input.name ?? theme.name,
        draftSettings: settings ?? theme.draftSettings,
        draftGlobalSections: globalSections ?? theme.draftGlobalSections,
        draftRevision: theme.draftRevision + 1,
      })
      .where(eq(themes.id, theme.id))
      .returning();
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
  canonicalPath: z.string().startsWith("/").max(500).nullable().optional(),
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

async function assertHandleFree(tx: Transaction, storeId: string, handle: string, exceptId?: string) {
  if (!isValidSlug(handle)) throw invalid("errors.page.invalid_handle", { handle });
  const clash = await tx.query.pages.findFirst({
    where: and(eq(pages.storeId, storeId), inArray(pages.type, ["page", "landing"]), eq(pages.handle, handle)),
  });
  if (clash && clash.id !== exceptId) throw conflict("errors.page.handle_taken", { handle });
}

export async function createPage(db: Database, ctx: StoreContext, input: z.infer<typeof createPageSchema>): Promise<PageRow> {
  assertCan(ctx, "content:write");
  const handle = input.handle ?? slugify(Object.values(input.title).find(Boolean) ?? "sayfa");
  let content: PageContent = { sections: [] };
  if (input.content) {
    const v = validatePageContent(input.content, input.type);
    if (!v.ok) contentIssues(v.issues);
    content = v.content;
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
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      action: "page.created",
      resourceType: "page",
      resourceId: row!.id,
      after: { type: row!.type, handle },
    });
    return row!;
  });
}

export async function updatePageDraft(db: Database, ctx: StoreContext, pageId: string, input: z.infer<typeof updatePageSchema>): Promise<PageRow> {
  const page = await getPage(db, ctx, pageId);
  assertCan(ctx, permissionForPageType(page.type, "write"));
  if (input.handle !== undefined && page.type !== "page" && page.type !== "landing") {
    throw invalid("errors.page.handle_not_editable");
  }
  let content: PageContent | undefined;
  if (input.content) {
    const v = validatePageContent(input.content, page.type);
    if (!v.ok) contentIssues(v.issues);
    content = v.content;
  }
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    if (input.handle && input.handle !== page.handle) await assertHandleFree(tx, ctx.storeId, input.handle, page.id);
    const [updated] = await tx
      .update(pages)
      .set({
        title: (input.title as Record<string, string> | undefined) ?? page.title,
        handle: input.handle ?? page.handle,
        draftContent: content ?? page.draftContent,
        draftSeo: (input.seo as SeoFields | undefined) ?? page.draftSeo,
        campaignId: input.campaignId === undefined ? page.campaignId : input.campaignId,
        draftRevision: page.draftRevision + 1,
      })
      // Optimistic concurrency: the editor must send the revision it started from.
      .where(and(eq(pages.id, pageId), eq(pages.draftRevision, input.expectedRevision)))
      .returning();
    if (!updated) throw conflict("errors.content.revision_conflict", { currentRevision: page.draftRevision });
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
  if (page.type !== "page" && page.type !== "landing") throw invalid("errors.page.schedule_not_supported");
  const [row] = await withTenantTx(db, scopeOf(ctx), (tx) =>
    tx
      .update(pages)
      .set({
        publishAt: input.publishAt,
        unpublishAt: input.unpublishAt,
        status: input.publishAt && page.status !== "published" ? "scheduled" : page.status === "scheduled" ? "draft" : page.status,
      })
      .where(eq(pages.id, pageId))
      .returning(),
  );
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
    // Pages deleted since then cannot be restored; keep only versions that still exist.
    const ids = Object.values(target.pageVersions);
    const existing = ids.length
      ? await tx.select({ id: pageVersions.id, pageId: pageVersions.pageId }).from(pageVersions).where(inArray(pageVersions.id, ids))
      : [];
    const pageMap = Object.fromEntries(existing.map((e) => [e.pageId, e.id]));
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
      const v = await tx.query.pageVersions.findFirst({ where: eq(pageVersions.id, e.id) });
      await tx.update(pages).set({ status: "published", publishedRevision: v!.sourceRevision }).where(eq(pages.id, e.pageId));
    }
    await switchPointer(tx, scopeOf(ctx), publication!.id);
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
  z.object({ type: z.enum(["home", "search", "cart"]) }),
]);

type NavInput = { id?: string; label: Record<string, string>; link: z.infer<typeof navLinkSchema>; children?: NavInput[] };

const navItemSchema: z.ZodType<NavInput> = z.lazy(() =>
  z.object({
    id: z.string().max(64).optional(),
    label: z.record(z.string(), z.string().max(80)),
    link: navLinkSchema,
    children: z.array(navItemSchema).max(30).optional(),
  }),
);

export const upsertNavigationSchema = z.object({
  name: z.string().trim().min(1).max(80),
  items: z.array(navItemSchema).max(50),
});

function normalizeNav(items: NavInput[], depth = 1): NavigationItem[] {
  if (depth > 3) throw invalid("errors.navigation.too_deep");
  return items.map((i) => ({
    id: i.id ?? newId(),
    label: i.label,
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
    const [row] = await tx
      .insert(navigations)
      .values({ id: newId(), organizationId: ctx.organizationId, storeId: ctx.storeId, handle, name: input.name, items })
      .onConflictDoUpdate({
        target: [navigations.storeId, navigations.handle],
        set: { name: input.name, items, revision: sql`${navigations.revision} + 1`, updatedAt: new Date() },
      })
      .returning();
    // Mark the theme draft dirty so the change is picked up by the next theme publish.
    const { theme } = await getActiveThemeTx(tx, ctx.storeId);
    await tx.update(themes).set({ draftRevision: theme.draftRevision + 1 }).where(eq(themes.id, theme.id));
    return row!;
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

export const createRedirectSchema = z.object({
  fromPath: pathSchema,
  toPath: z.union([pathSchema, z.url()]),
  statusCode: z.union([z.literal(301), z.literal(302)]).default(301),
});

export async function listRedirects(db: Database, ctx: StoreContext) {
  assertCan(ctx, "storefront:read");
  return withTenantTx(db, scopeOf(ctx), (tx) => tx.select().from(redirects).where(eq(redirects.storeId, ctx.storeId)).orderBy(asc(redirects.fromPath)));
}

export async function createRedirect(db: Database, ctx: StoreContext, input: z.infer<typeof createRedirectSchema>) {
  assertCan(ctx, "storefront:write");
  if (input.fromPath === input.toPath) throw invalid("errors.redirect.loop");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    await upsertRedirect(tx, scopeOf(ctx), input.fromPath, input.toPath, input.statusCode, "manual");
    await tx.update(stores).set({ contentVersion: sql`${stores.contentVersion} + 1` }).where(eq(stores.id, ctx.storeId));
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      action: "redirect.saved",
      resourceType: "redirect",
      resourceId: input.fromPath,
      after: input,
    });
    return tx.query.redirects.findFirst({ where: and(eq(redirects.storeId, ctx.storeId), eq(redirects.fromPath, input.fromPath)) });
  });
}

export async function deleteRedirect(db: Database, ctx: StoreContext, redirectId: string) {
  assertCan(ctx, "storefront:write");
  await withTenantTx(db, scopeOf(ctx), async (tx) => {
    const deleted = await tx.delete(redirects).where(and(eq(redirects.id, redirectId), eq(redirects.storeId, ctx.storeId))).returning();
    if (!deleted.length) throw notFound("redirect", redirectId);
    await tx.update(stores).set({ contentVersion: sql`${stores.contentVersion} + 1` }).where(eq(stores.id, ctx.storeId));
  });
}

// ---------------------------------------------------------------------------
// Scheduled publishing (worker)
// ---------------------------------------------------------------------------

/** Publishes scheduled pages whose time has come and unpublishes expired landing pages. */
export async function runScheduledPublishing(db: Database): Promise<number> {
  const now = new Date();
  const due = await withPlatformTx(db, (tx) =>
    tx
      .select({ id: pages.id, organizationId: pages.organizationId, storeId: pages.storeId, status: pages.status, publishAt: pages.publishAt, unpublishAt: pages.unpublishAt })
      .from(pages)
      .where(
        sql`(${pages.status} = 'scheduled' and ${pages.publishAt} <= ${pgTimestamp(now)})
          or (${pages.status} = 'published' and ${pages.unpublishAt} <= ${pgTimestamp(now)})`,
      )
      .limit(100),
  );
  for (const p of due) {
    const scope = { organizationId: p.organizationId, storeId: p.storeId };
    await withTenantTx(db, scope, async (tx) => {
      const expired = p.unpublishAt !== null && p.unpublishAt <= now;
      await publishCore(tx, scope, {
        includeTheme: false,
        pageIds: expired ? [] : [p.id],
        removePageIds: expired ? [p.id] : [],
        reason: expired ? "scheduled_unpublish" : "scheduled_publish",
        principalId: null,
      });
      if (expired) await tx.update(pages).set({ unpublishAt: null }).where(eq(pages.id, p.id));
    });
  }
  return due.length;
}

