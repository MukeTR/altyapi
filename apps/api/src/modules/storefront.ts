import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  createPage,
  createPageSchema,
  createPreviewToken,
  createRedirect,
  createRedirectSchema,
  deletePage,
  deleteRedirect,
  getActiveTheme,
  getRevision,
  listRevisions,
  moveDraft,
  getPage,
  listNavigations,
  listPages,
  listPublications,
  listRedirects,
  livePagePaths,
  pagePath,
  pageUrlStyle,
  publish,
  publishSchema,
  rollbackTo,
  schedulePage,
  schedulePageSchema,
  SECTION_DEFINITIONS,
  definitionJsonSchema,
  unpublishPage,
  updatePageDraft,
  updatePageSchema,
  updateThemeDraft,
  updateThemeDraftSchema,
  upsertNavigation,
  upsertNavigationSchema,
  type PageRow,
} from "@altyapi/theme-engine";
import { assertCan, type StoreContext } from "@altyapi/tenancy";
import type { PageUrlStyle } from "@altyapi/site";
import type { AppDeps } from "../deps";
import { storeContext } from "../plugins/auth";
import { storeParams } from "./stores";

const json = z.record(z.string(), z.unknown());

/**
 * path is where the page is reachable on the storefront: its live URL while it is published
 * (a rename only in the draft does not move it), otherwise the URL it will go live under.
 * livePath and draftPath give both sides explicitly.
 */
export const pageView = (p: PageRow, livePaths: Map<string, string>, style: PageUrlStyle) => ({
  id: p.id,
  type: p.type,
  handle: p.handle,
  templateKey: p.templateKey,
  path: livePaths.get(p.id) ?? pagePath(p.type, p.handle, style),
  livePath: livePaths.get(p.id) ?? null,
  draftPath: pagePath(p.type, p.handle, style),
  title: p.title,
  status: p.status,
  draftContent: p.draftContent as unknown as Record<string, unknown>,
  draftSeo: p.draftSeo as Record<string, unknown>,
  draftRevision: p.draftRevision,
  publishedRevision: p.publishedRevision,
  hasUnpublishedChanges: p.draftRevision !== p.publishedRevision,
  publishAt: p.publishAt,
  unpublishAt: p.unpublishAt,
  campaignId: p.campaignId,
  updatedAt: p.updatedAt,
});

export const pageSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  handle: z.string(),
  /** Layout a template page provides ("entries.post.detail"); null for other page types. */
  templateKey: z.string().nullable(),
  path: z.string().nullable(),
  livePath: z.string().nullable(),
  draftPath: z.string().nullable(),
  title: z.record(z.string(), z.string()),
  status: z.string(),
  draftContent: json,
  draftSeo: json,
  draftRevision: z.number().int(),
  publishedRevision: z.number().int().nullable(),
  hasUnpublishedChanges: z.boolean(),
  publishAt: z.date().nullable(),
  unpublishAt: z.date().nullable(),
  campaignId: z.uuid().nullable(),
  updatedAt: z.date(),
});

const publicationSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  reason: z.string(),
  themeVersionId: z.uuid(),
  pageCount: z.number().int(),
  createdAt: z.date(),
  isActive: z.boolean().optional(),
});

const pubView = (p: { id: string; number: number; reason: string; themeVersionId: string; pageVersions: Record<string, string>; createdAt: Date; isActive?: boolean }) => ({
  id: p.id,
  number: p.number,
  reason: p.reason,
  themeVersionId: p.themeVersionId,
  pageCount: Object.keys(p.pageVersions).length,
  createdAt: p.createdAt,
  ...(p.isActive !== undefined ? { isActive: p.isActive } : {}),
});

const pageParams = storeParams.extend({ pageId: z.uuid() });

export const storefrontRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const base = "/v1/organizations/:organizationId/stores/:storeId/storefront";
  const withLivePath = async (ctx: StoreContext, load: (ctx: StoreContext) => Promise<PageRow>) => {
    const page = await load(ctx);
    return pageView(page, await livePagePaths(deps.db, ctx, [page.id]), await pageUrlStyle(deps.db, ctx));
  };

  app.get("/v1/section-definitions", { schema: { tags: ["storefront"] } }, async () => ({
    items: SECTION_DEFINITIONS.map((d) => ({
      type: d.type,
      version: d.version,
      name: d.name,
      category: d.category,
      module: d.module,
      policyTags: d.policyTags,
      propTags: d.propTags,
      allowedIn: d.allowedIn,
      requiredIn: d.requiredIn ?? [],
      contentBindings: d.contentBindings,
      maxBlocks: d.maxBlocks ?? null,
      singleton: d.singleton ?? false,
      ...definitionJsonSchema(d),
    })),
  }));

  app.get(`${base}/theme`, { schema: { tags: ["storefront"], params: storeParams } }, async (req) => {
    const { theme, hasUnpublishedChanges } = await getActiveTheme(deps.db, await storeContext(deps, req));
    return {
      id: theme.id,
      name: theme.name,
      baseTheme: theme.baseTheme,
      settings: theme.draftSettings,
      globalSections: theme.draftGlobalSections,
      draftRevision: theme.draftRevision,
      hasUnpublishedChanges,
    };
  });

  app.put(
    `${base}/theme`,
    { schema: { tags: ["storefront"], params: storeParams, body: updateThemeDraftSchema } },
    async (req) => {
      const t = await updateThemeDraft(deps.db, await storeContext(deps, req), req.body);
      return { id: t.id, name: t.name, settings: t.draftSettings, globalSections: t.draftGlobalSections, draftRevision: t.draftRevision };
    },
  );

  app.get(
    `${base}/pages`,
    {
      schema: {
        tags: ["storefront"],
        params: storeParams,
        querystring: z.object({ type: z.enum(["home", "product", "collection", "page", "landing", "cart", "search", "not_found", "template"]).optional() }),
        response: { 200: z.object({ items: z.array(pageSchema) }) },
      },
    },
    async (req) => {
      const ctx = await storeContext(deps, req);
      const rows = await listPages(deps.db, ctx, req.query);
      const [live, style] = await Promise.all([livePagePaths(deps.db, ctx, rows.map((r) => r.id)), pageUrlStyle(deps.db, ctx)]);
      return { items: rows.map((r) => pageView(r, live, style)) };
    },
  );

  app.post(
    `${base}/pages`,
    { schema: { tags: ["storefront"], params: storeParams, body: createPageSchema, response: { 201: pageSchema } } },
    // A new page is never live yet.
    async (req, reply) => {
      const ctx = await storeContext(deps, req);
      return reply.status(201).send(pageView(await createPage(deps.db, ctx, req.body), new Map(), await pageUrlStyle(deps.db, ctx)));
    },
  );

  app.get(
    `${base}/pages/:pageId`,
    { schema: { tags: ["storefront"], params: pageParams, response: { 200: pageSchema } } },
    async (req) => withLivePath(await storeContext(deps, req), (ctx) => getPage(deps.db, ctx, req.params.pageId)),
  );

  app.put(
    `${base}/pages/:pageId`,
    { schema: { tags: ["storefront"], params: pageParams, body: updatePageSchema, response: { 200: pageSchema } } },
    async (req) => withLivePath(await storeContext(deps, req), (ctx) => updatePageDraft(deps.db, ctx, req.params.pageId, req.body)),
  );

  app.delete(
    `${base}/pages/:pageId`,
    { schema: { tags: ["storefront"], params: pageParams, response: { 204: z.null() } } },
    async (req, reply) => {
      await deletePage(deps.db, await storeContext(deps, req), req.params.pageId);
      return reply.status(204).send(null);
    },
  );

  app.put(
    `${base}/pages/:pageId/schedule`,
    { schema: { tags: ["storefront"], params: pageParams, body: schedulePageSchema, response: { 200: pageSchema } } },
    async (req) => withLivePath(await storeContext(deps, req), (ctx) => schedulePage(deps.db, ctx, req.params.pageId, req.body)),
  );

  app.post(
    `${base}/pages/:pageId/unpublish`,
    { schema: { tags: ["storefront"], params: pageParams, response: { 200: publicationSchema } } },
    async (req) => pubView(await unpublishPage(deps.db, await storeContext(deps, req), req.params.pageId)),
  );

  app.post(
    `${base}/publish`,
    { schema: { tags: ["storefront"], params: storeParams, body: publishSchema, response: { 201: publicationSchema } } },
    async (req, reply) => reply.status(201).send(pubView(await publish(deps.db, await storeContext(deps, req), req.body))),
  );

  app.get(
    `${base}/publications`,
    { schema: { tags: ["storefront"], params: storeParams, response: { 200: z.object({ items: z.array(publicationSchema) }) } } },
    async (req) => ({ items: (await listPublications(deps.db, await storeContext(deps, req))).map(pubView) }),
  );

  app.post(
    `${base}/publications/:publicationId/rollback`,
    { schema: { tags: ["storefront"], params: storeParams.extend({ publicationId: z.uuid() }), response: { 201: publicationSchema } } },
    async (req, reply) => reply.status(201).send(pubView(await rollbackTo(deps.db, await storeContext(deps, req), req.params.publicationId))),
  );

  app.post(
    `${base}/preview-token`,
    { schema: { tags: ["storefront"], params: storeParams, response: { 201: z.object({ token: z.string(), expiresInSeconds: z.number() }) } } },
    async (req, reply) => {
      const ctx = await storeContext(deps, req);
      // Preview exposes drafts, so it requires the same permission as editing the storefront.
      assertCan(ctx, "storefront:read");
      return reply.status(201).send(createPreviewToken(deps.env.APP_SIGNING_SECRET, ctx.storeId));
    },
  );

  // Draft history: undo / redo / restore for theme, pages, menus and content entries (the live site changes only on publish).
  const historyParams = storeParams.extend({ resource: z.enum(["theme", "page", "navigation", "entry"]), resourceId: z.uuid() });
  app.get(`${base}/history/:resource/:resourceId`, { schema: { tags: ["storefront"], params: historyParams } }, async (req) =>
    listRevisions(deps.db, await storeContext(deps, req), req.params.resource, req.params.resourceId),
  );
  app.get(
    `${base}/history/:resource/:resourceId/:revision`,
    { schema: { tags: ["storefront"], params: historyParams.extend({ revision: z.coerce.number().int().positive() }) } },
    async (req) => getRevision(deps.db, await storeContext(deps, req), req.params.resource, req.params.resourceId, req.params.revision),
  );
  app.post(
    `${base}/history/:resource/:resourceId/undo`,
    { schema: { tags: ["storefront"], params: historyParams, body: z.object({ expectedRevision: z.number().int().positive() }) } },
    async (req) => moveDraft(deps.db, await storeContext(deps, req), req.params.resource, req.params.resourceId, { kind: "undo" }, req.body.expectedRevision),
  );
  app.post(
    `${base}/history/:resource/:resourceId/redo`,
    { schema: { tags: ["storefront"], params: historyParams, body: z.object({ expectedRevision: z.number().int().positive() }) } },
    async (req) => moveDraft(deps.db, await storeContext(deps, req), req.params.resource, req.params.resourceId, { kind: "redo" }, req.body.expectedRevision),
  );
  app.post(
    `${base}/history/:resource/:resourceId/restore`,
    { schema: { tags: ["storefront"], params: historyParams, body: z.object({ revision: z.number().int().positive(), expectedRevision: z.number().int().positive() }) } },
    async (req) =>
      moveDraft(deps.db, await storeContext(deps, req), req.params.resource, req.params.resourceId, { kind: "restore", revision: req.body.revision }, req.body.expectedRevision),
  );

  app.get(`${base}/navigations`, { schema: { tags: ["storefront"], params: storeParams } }, async (req) => ({
    items: await listNavigations(deps.db, await storeContext(deps, req)),
  }));

  app.put(
    `${base}/navigations/:handle`,
    { schema: { tags: ["storefront"], params: storeParams.extend({ handle: z.string().max(63) }), body: upsertNavigationSchema } },
    async (req) => upsertNavigation(deps.db, await storeContext(deps, req), req.params.handle, req.body),
  );

  app.get(`${base}/redirects`, { schema: { tags: ["storefront"], params: storeParams } }, async (req) => ({
    items: await listRedirects(deps.db, await storeContext(deps, req)),
  }));

  app.post(
    `${base}/redirects`,
    { schema: { tags: ["storefront"], params: storeParams, body: createRedirectSchema } },
    async (req, reply) => reply.status(201).send(await createRedirect(deps.db, await storeContext(deps, req), req.body)),
  );

  app.delete(
    `${base}/redirects/:redirectId`,
    { schema: { tags: ["storefront"], params: storeParams.extend({ redirectId: z.uuid() }), response: { 204: z.null() } } },
    async (req, reply) => {
      await deleteRedirect(deps.db, await storeContext(deps, req), req.params.redirectId);
      return reply.status(204).send(null);
    },
  );
};
