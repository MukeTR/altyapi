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
  getPage,
  listNavigations,
  listPages,
  listPublications,
  listRedirects,
  pagePath,
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
import { assertCan } from "@altyapi/tenancy";
import type { AppDeps } from "../deps";
import { storeContext } from "../plugins/auth";
import { storeParams } from "./stores";

const json = z.record(z.string(), z.unknown());

const pageView = (p: PageRow) => ({
  id: p.id,
  type: p.type,
  handle: p.handle,
  path: pagePath(p.type, p.handle),
  title: p.title,
  status: p.status,
  draftContent: p.draftContent as unknown as Record<string, unknown>,
  draftSeo: p.draftSeo as Record<string, unknown>,
  draftRevision: p.draftRevision,
  publishedRevision: p.publishedRevision,
  hasUnpublishedChanges: p.publishedRevision === null || p.draftRevision > p.publishedRevision,
  publishAt: p.publishAt,
  unpublishAt: p.unpublishAt,
  campaignId: p.campaignId,
  updatedAt: p.updatedAt,
});

const pageSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  handle: z.string(),
  path: z.string().nullable(),
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

  app.get("/v1/section-definitions", { schema: { tags: ["storefront"] } }, async () => ({
    items: SECTION_DEFINITIONS.map((d) => ({
      type: d.type,
      version: d.version,
      name: d.name,
      category: d.category,
      allowedIn: d.allowedIn,
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
        querystring: z.object({ type: z.enum(["home", "product", "collection", "page", "landing", "cart", "search", "not_found"]).optional() }),
        response: { 200: z.object({ items: z.array(pageSchema) }) },
      },
    },
    async (req) => ({ items: (await listPages(deps.db, await storeContext(deps, req), req.query)).map(pageView) }),
  );

  app.post(
    `${base}/pages`,
    { schema: { tags: ["storefront"], params: storeParams, body: createPageSchema, response: { 201: pageSchema } } },
    async (req, reply) => reply.status(201).send(pageView(await createPage(deps.db, await storeContext(deps, req), req.body))),
  );

  app.get(
    `${base}/pages/:pageId`,
    { schema: { tags: ["storefront"], params: pageParams, response: { 200: pageSchema } } },
    async (req) => pageView(await getPage(deps.db, await storeContext(deps, req), req.params.pageId)),
  );

  app.put(
    `${base}/pages/:pageId`,
    { schema: { tags: ["storefront"], params: pageParams, body: updatePageSchema, response: { 200: pageSchema } } },
    async (req) => pageView(await updatePageDraft(deps.db, await storeContext(deps, req), req.params.pageId, req.body)),
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
    async (req) => pageView(await schedulePage(deps.db, await storeContext(deps, req), req.params.pageId, req.body)),
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
