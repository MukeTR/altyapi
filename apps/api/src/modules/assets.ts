import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  completeUpload,
  createUpload,
  createUploadSchema,
  deleteAsset,
  getAsset,
  IMAGE_PRESETS,
  imageUrl,
  listAssets,
  listAssetsQuerySchema,
  publicObjectUrl,
  updateAssetAltText,
  type AssetRow,
  type R2Storage,
} from "@altyapi/storage";
import { AppError } from "@altyapi/commerce-core";
import type { AppDeps } from "../deps";
import { storeContext } from "../plugins/auth";
import { storeParams } from "./stores";

const assetSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  status: z.string(),
  contentType: z.string(),
  byteSize: z.number().int(),
  originalFilename: z.string().nullable(),
  altText: z.record(z.string(), z.string()),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  url: z.string().nullable(),
  variants: z.record(z.string(), z.string()).nullable(),
  failureReason: z.string().nullable(),
  createdAt: z.date(),
});

const assetParams = storeParams.extend({ assetId: z.uuid() });

export const assetRoutes: FastifyPluginAsyncZod<{ deps: AppDeps; r2: R2Storage | null }> = async (app, { deps, r2 }) => {
  const mediaBase = deps.env.MEDIA_PUBLIC_BASE_URL;

  const view = (a: AssetRow) => {
    const isPublic = a.bucket === "storefront-public" && a.status === "ready" && mediaBase;
    return {
      id: a.id,
      kind: a.kind,
      status: a.status,
      contentType: a.contentType,
      byteSize: a.byteSize,
      originalFilename: a.originalFilename,
      altText: a.altText,
      width: a.width,
      height: a.height,
      url: isPublic ? publicObjectUrl(mediaBase, a.objectKey) : null,
      variants:
        isPublic && a.kind === "image"
          ? Object.fromEntries(
              (Object.keys(IMAGE_PRESETS) as (keyof typeof IMAGE_PRESETS)[]).map((p) => [p, imageUrl(mediaBase, a.objectKey, { preset: p })]),
            )
          : null,
      failureReason: a.failureReason,
      createdAt: a.createdAt,
    };
  };

  const base = "/v1/organizations/:organizationId/stores/:storeId/assets";

  app.post(
    `${base}/uploads`,
    {
      schema: {
        tags: ["media"],
        params: storeParams,
        body: createUploadSchema,
        response: {
          201: z.object({
            assetId: z.uuid(),
            uploadUrl: z.string(),
            method: z.literal("PUT"),
            headers: z.record(z.string(), z.string()),
            expiresAt: z.date(),
          }),
        },
      },
    },
    async (req, reply) => reply.status(201).send(await createUpload(deps.db, r2, await storeContext(deps, req), req.body)),
  );

  app.post(
    `${base}/:assetId/complete`,
    { schema: { tags: ["media"], params: assetParams, response: { 200: assetSchema } } },
    async (req) => view(await completeUpload(deps.db, r2, await storeContext(deps, req), req.params.assetId)),
  );

  app.get(
    base,
    { schema: { tags: ["media"], params: storeParams, querystring: listAssetsQuerySchema, response: { 200: z.object({ items: z.array(assetSchema) }) } } },
    async (req) => ({ items: (await listAssets(deps.db, await storeContext(deps, req), req.query)).map(view) }),
  );

  app.get(
    `${base}/:assetId`,
    { schema: { tags: ["media"], params: assetParams, response: { 200: assetSchema } } },
    async (req) => view(await getAsset(deps.db, await storeContext(deps, req), req.params.assetId)),
  );

  /** Short-lived download link for private (non-public bucket) assets. */
  app.get(
    `${base}/:assetId/download`,
    { schema: { tags: ["media"], params: assetParams, response: { 200: z.object({ url: z.string(), expiresInSeconds: z.number() }) } } },
    async (req) => {
      const ctx = await storeContext(deps, req);
      const asset = await getAsset(deps.db, ctx, req.params.assetId);
      if (!r2) throw new AppError("dependency_unavailable", "errors.storage.not_configured");
      if (asset.status !== "ready") throw new AppError("precondition_failed", "errors.asset.not_ready");
      const expiresInSeconds = 300;
      return { url: await r2.presignGet(asset.bucket, asset.objectKey, expiresInSeconds, asset.originalFilename ?? undefined), expiresInSeconds };
    },
  );

  app.patch(
    `${base}/:assetId`,
    {
      schema: {
        tags: ["media"],
        params: assetParams,
        body: z.object({ altText: z.record(z.string(), z.string().max(500)) }),
        response: { 200: assetSchema },
      },
    },
    async (req) => view(await updateAssetAltText(deps.db, await storeContext(deps, req), req.params.assetId, req.body.altText)),
  );

  app.delete(
    `${base}/:assetId`,
    { schema: { tags: ["media"], params: assetParams, response: { 204: z.null() } } },
    async (req, reply) => {
      await deleteAsset(deps.db, await storeContext(deps, req), req.params.assetId);
      return reply.status(204).send(null);
    },
  );
};
