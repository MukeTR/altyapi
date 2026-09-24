import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { AppError, notFound } from "@altyapi/commerce-core";
import { and, contentTypes, eq, withTenantTx } from "@altyapi/database";
import {
  archiveEntry,
  archiveType,
  createCustomType,
  createCustomTypeSchema,
  createEntry,
  createEntrySchema,
  duplicateEntry,
  entryCountsByType,
  getEntry,
  getEntryRevision,
  getType,
  installType,
  installTypeSchema,
  listBuiltinTypes,
  listEntries,
  listEntriesQuerySchema,
  listEntryRevisions,
  listEntryVersions,
  listTypes,
  moveEntryDraft,
  publishEntry,
  scheduleEntry,
  scheduleEntrySchema,
  unarchiveEntry,
  unpublishEntry,
  updateEntryDraft,
  updateEntrySchema,
  updateType,
  updateTypeSchema,
} from "@altyapi/content";
import {
  ensureEntryTemplatePages,
  entryTemplateHooks,
  entryTemplateKey,
  listPages,
  livePagePaths,
  pageUrlStyle,
} from "@altyapi/theme-engine";
import { assertCan, tenantScope, type StoreContext } from "@altyapi/tenancy";
import type { AppDeps } from "../deps";
import { storeContext } from "../plugins/auth";
import { storeParams } from "./stores";
import { pageView } from "./storefront";

/** A content type by key or id. */
const typeParams = storeParams.extend({ typeKey: z.string().min(1).max(64) });
const entryParams = storeParams.extend({ entryId: z.uuid() });
const expectedRevision = z.number().int().positive();

type TypeSummary = Awaited<ReturnType<typeof listTypes>>[number];

/** Template pages a type renders with: the detail layout, and the index layout for collections. */
function templateKeysOf(type: Pick<TypeSummary, "key" | "kind">): string[] {
  if (type.kind === "taxonomy") return [];
  return type.kind === "collection" ? [entryTemplateKey(type.key, "detail"), entryTemplateKey(type.key, "index")] : [entryTemplateKey(type.key, "detail")];
}

/**
 * Content core admin API (docs/platform/site-turleri-ve-cms.md §3, Faz 1): content types
 * (built-in installs and custom types), entries with their draft history and record versions,
 * and the template pages entries render with. The content services check content:* and the
 * content module; template pages are storefront pages (storefront:*).
 */
export const contentRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const base = "/v1/organizations/:organizationId/stores/:storeId/content";
  const ctx = (req: Parameters<typeof storeContext>[1]) => storeContext(deps, req);

  /** A type of the store (archived ones included) by key or id; 404 when unknown. */
  const typeOf = async (c: StoreContext, ref: string): Promise<TypeSummary> => {
    const type = (await listTypes(deps.db, c, { includeArchived: true })).find((t) => t.key === ref || t.id === ref);
    if (!type) throw notFound("content_type", ref);
    return type;
  };

  /** The type's template pages in the page view the storefront editor uses. */
  const templatesOf = async (c: StoreContext, type: TypeSummary) => {
    const keys = templateKeysOf(type);
    const rows = (await listPages(deps.db, c, { type: "template" })).filter((p) => p.templateKey !== null && keys.includes(p.templateKey));
    const [live, style] = await Promise.all([livePagePaths(deps.db, c, rows.map((r) => r.id)), pageUrlStyle(deps.db, c)]);
    return {
      items: rows.map((r) => pageView(r, live, style)),
      /** Layouts of a routable type without a page: its entries render with the built-in default layout. */
      missing: type.routable ? keys.filter((k) => !rows.some((r) => r.templateKey === k)) : [],
    };
  };

  // ---------------------------------------------------------------------------
  // Types
  // ---------------------------------------------------------------------------

  app.get(
    `${base}/types`,
    { schema: { tags: ["content"], params: storeParams, querystring: z.object({ includeArchived: z.stringbool().optional() }) } },
    async (req) => {
      const c = await ctx(req);
      const [types, counts] = await Promise.all([listTypes(deps.db, c, { includeArchived: req.query.includeArchived }), entryCountsByType(deps.db, c)]);
      return {
        items: types.map((t) => ({
          ...t,
          entryCounts: Object.fromEntries(counts.filter((n) => n.typeId === t.id).map((n) => [n.status, n.count])),
        })),
      };
    },
  );

  // Built-in types the site can install, with the installed copy (if any).
  app.get(`${base}/types/available`, { schema: { tags: ["content"], params: storeParams } }, async (req) => {
    const installed = await listTypes(deps.db, await ctx(req), { includeArchived: true });
    return {
      items: listBuiltinTypes().map((d) => {
        const copy = installed.find((t) => t.builtinKey === d.key);
        return { ...d, installed: copy ? { id: copy.id, key: copy.key, status: copy.status, upgradeAvailable: copy.upgradeAvailable } : null };
      }),
    };
  });

  app.post(
    `${base}/types/install`,
    { schema: { tags: ["content"], params: storeParams, body: installTypeSchema.extend({ builtinKey: z.string().min(1).max(64) }) } },
    async (req, reply) => {
      const c = await ctx(req);
      const { builtinKey, ...input } = req.body;
      // entryTemplateHooks: a routable type gets its draft template pages in the same transaction.
      const row = await installType(deps.db, c, builtinKey, input, entryTemplateHooks);
      return reply.status(201).send(await getType(deps.db, c, row.id));
    },
  );

  app.post(`${base}/types`, { schema: { tags: ["content"], params: storeParams, body: createCustomTypeSchema } }, async (req, reply) => {
    const c = await ctx(req);
    const row = await createCustomType(deps.db, c, req.body, entryTemplateHooks);
    return reply.status(201).send(await getType(deps.db, c, row.id));
  });

  app.get(`${base}/types/:typeKey`, { schema: { tags: ["content"], params: typeParams } }, async (req) => getType(deps.db, await ctx(req), req.params.typeKey));

  app.patch(`${base}/types/:typeKey`, { schema: { tags: ["content"], params: typeParams, body: updateTypeSchema } }, async (req) => {
    const c = await ctx(req);
    const row = await updateType(deps.db, c, req.params.typeKey, req.body, entryTemplateHooks);
    return getType(deps.db, c, row.id);
  });

  app.post(`${base}/types/:typeKey/archive`, { schema: { tags: ["content"], params: typeParams } }, async (req) => {
    const c = await ctx(req);
    const row = await archiveType(deps.db, c, req.params.typeKey);
    return getType(deps.db, c, row.id);
  });

  // Template pages of a type (pages of type "template", edited like other storefront pages).
  app.get(`${base}/types/:typeKey/templates`, { schema: { tags: ["content"], params: typeParams } }, async (req) => {
    const c = await ctx(req);
    return templatesOf(c, await typeOf(c, req.params.typeKey));
  });

  // Creates the missing draft template pages again (e.g. after one was deleted); existing ones are left alone.
  app.post(`${base}/types/:typeKey/templates`, { schema: { tags: ["content"], params: typeParams } }, async (req, reply) => {
    const c = await ctx(req);
    assertCan(c, "storefront:write");
    const type = await typeOf(c, req.params.typeKey);
    if (!type.routable) throw new AppError("precondition_failed", "errors.content_type.not_routable", { typeKey: type.key });
    const created = await withTenantTx(deps.db, tenantScope(c), async (tx) => {
      // A share lock keeps the type from being archived while its templates are created.
      const [row] = await tx
        .select({ status: contentTypes.status })
        .from(contentTypes)
        .where(and(eq(contentTypes.storeId, c.storeId), eq(contentTypes.id, type.id)))
        .for("share");
      if (row?.status !== "active") throw new AppError("precondition_failed", "errors.content_type.archived", { typeId: type.id });
      return ensureEntryTemplatePages(tx, {
        organizationId: c.organizationId,
        storeId: c.storeId,
        typeId: type.id,
        key: type.key,
        builtinKey: type.builtinKey,
        kind: type.kind,
        labels: type.labels,
        routable: type.routable,
      });
    });
    return reply.status(created.length ? 201 : 200).send({ ...(await templatesOf(c, type)), created });
  });

  // ---------------------------------------------------------------------------
  // Entries
  // ---------------------------------------------------------------------------

  app.get(`${base}/entries`, { schema: { tags: ["content"], params: storeParams, querystring: listEntriesQuerySchema } }, async (req) =>
    listEntries(deps.db, await ctx(req), req.query),
  );

  app.post(`${base}/entries`, { schema: { tags: ["content"], params: storeParams, body: createEntrySchema } }, async (req, reply) => {
    const c = await ctx(req);
    const row = await createEntry(deps.db, c, req.body);
    return reply.status(201).send(await getEntry(deps.db, c, row.id));
  });

  app.get(`${base}/entries/:entryId`, { schema: { tags: ["content"], params: entryParams } }, async (req) => getEntry(deps.db, await ctx(req), req.params.entryId));

  // Draft save: optimistic concurrency on expectedRevision; data is merged per top-level field.
  app.patch(`${base}/entries/:entryId`, { schema: { tags: ["content"], params: entryParams, body: updateEntrySchema } }, async (req) => {
    const c = await ctx(req);
    await updateEntryDraft(deps.db, c, req.params.entryId, req.body);
    return getEntry(deps.db, c, req.params.entryId);
  });

  app.post(
    `${base}/entries/:entryId/publish`,
    { schema: { tags: ["content"], params: entryParams, body: z.object({ expectedRevision: expectedRevision.optional() }).nullish() } },
    async (req) => {
      const c = await ctx(req);
      const result = await publishEntry(deps.db, c, req.params.entryId, { expectedRevision: req.body?.expectedRevision });
      return {
        ...(await getEntry(deps.db, c, req.params.entryId)),
        version: { id: result.version.id, version: result.version.version, locales: result.version.locales, liveFrom: result.version.liveFrom },
        // Referenced entries that are not live yet; the editor offers to publish them too.
        unpublishedDependencies: result.unpublishedDependencies,
      };
    },
  );

  app.post(`${base}/entries/:entryId/unpublish`, { schema: { tags: ["content"], params: entryParams } }, async (req) => {
    const c = await ctx(req);
    await unpublishEntry(deps.db, c, req.params.entryId);
    return getEntry(deps.db, c, req.params.entryId);
  });

  app.put(`${base}/entries/:entryId/schedule`, { schema: { tags: ["content"], params: entryParams, body: scheduleEntrySchema } }, async (req) => {
    const c = await ctx(req);
    await scheduleEntry(deps.db, c, req.params.entryId, req.body);
    return getEntry(deps.db, c, req.params.entryId);
  });

  app.post(`${base}/entries/:entryId/archive`, { schema: { tags: ["content"], params: entryParams } }, async (req) => {
    const c = await ctx(req);
    await archiveEntry(deps.db, c, req.params.entryId);
    return getEntry(deps.db, c, req.params.entryId);
  });

  app.post(`${base}/entries/:entryId/unarchive`, { schema: { tags: ["content"], params: entryParams } }, async (req) => {
    const c = await ctx(req);
    await unarchiveEntry(deps.db, c, req.params.entryId);
    return getEntry(deps.db, c, req.params.entryId);
  });

  app.post(`${base}/entries/:entryId/duplicate`, { schema: { tags: ["content"], params: entryParams } }, async (req, reply) => {
    const c = await ctx(req);
    const copy = await duplicateEntry(deps.db, c, req.params.entryId);
    return reply.status(201).send(await getEntry(deps.db, c, copy.id));
  });

  // Published versions ("what was live when"), newest first.
  app.get(
    `${base}/entries/:entryId/versions`,
    { schema: { tags: ["content"], params: entryParams, querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }) } },
    async (req) => ({ items: await listEntryVersions(deps.db, await ctx(req), req.params.entryId, req.query.limit) }),
  );

  // Draft history: undo / redo / restore move the draft; the live version changes only on publish.
  app.get(`${base}/entries/:entryId/history`, { schema: { tags: ["content"], params: entryParams } }, async (req) =>
    listEntryRevisions(deps.db, await ctx(req), req.params.entryId),
  );
  app.get(
    `${base}/entries/:entryId/history/:revision`,
    { schema: { tags: ["content"], params: entryParams.extend({ revision: z.coerce.number().int().positive() }) } },
    async (req) => getEntryRevision(deps.db, await ctx(req), req.params.entryId, req.params.revision),
  );
  app.post(
    `${base}/entries/:entryId/history/undo`,
    { schema: { tags: ["content"], params: entryParams, body: z.object({ expectedRevision }) } },
    async (req) => moveEntryDraft(deps.db, await ctx(req), req.params.entryId, { kind: "undo" }, req.body.expectedRevision),
  );
  app.post(
    `${base}/entries/:entryId/history/redo`,
    { schema: { tags: ["content"], params: entryParams, body: z.object({ expectedRevision }) } },
    async (req) => moveEntryDraft(deps.db, await ctx(req), req.params.entryId, { kind: "redo" }, req.body.expectedRevision),
  );
  app.post(
    `${base}/entries/:entryId/history/restore`,
    { schema: { tags: ["content"], params: entryParams, body: z.object({ revision: z.number().int().positive(), expectedRevision }) } },
    async (req) =>
      moveEntryDraft(deps.db, await ctx(req), req.params.entryId, { kind: "restore", revision: req.body.revision }, req.body.expectedRevision),
  );
};
