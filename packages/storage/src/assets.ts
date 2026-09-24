import { createHash } from "node:crypto";
import { z } from "zod";
import { imageSize } from "image-size";
import { AppError, invalid, newId, notFound } from "@altyapi/commerce-core";
import {
  and,
  assetReferences,
  contentAssets,
  desc,
  eq,
  isNull,
  lt,
  pgTimestamp,
  sql,
  withPlatformTx,
  withTenantTx,
  type Database,
} from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { appendEvent } from "@altyapi/events";
import { assertCan, type StoreContext } from "@altyapi/tenancy";
import type { BucketName, R2Storage } from "./r2";

type AssetKind = "image" | "video" | "document" | "font" | "data" | "other";
export type UploadPurpose = "media" | "private_document" | "import";

interface TypeRule {
  kind: AssetKind;
  extension: string;
  maxBytes: number;
}

const MB = 1024 * 1024;

/**
 * Accepted content types per upload purpose. SVG is excluded from public media because it
 * can carry scripts; the bucket is chosen by purpose, never by the client.
 */
const ALLOWED: Record<UploadPurpose, { bucket: BucketName; types: Record<string, TypeRule> }> = {
  media: {
    bucket: "storefront-public",
    types: {
      "image/jpeg": { kind: "image", extension: "jpg", maxBytes: 20 * MB },
      "image/png": { kind: "image", extension: "png", maxBytes: 20 * MB },
      "image/webp": { kind: "image", extension: "webp", maxBytes: 20 * MB },
      "image/avif": { kind: "image", extension: "avif", maxBytes: 20 * MB },
      "image/gif": { kind: "image", extension: "gif", maxBytes: 15 * MB },
      "video/mp4": { kind: "video", extension: "mp4", maxBytes: 200 * MB },
      "video/webm": { kind: "video", extension: "webm", maxBytes: 200 * MB },
      "font/woff2": { kind: "font", extension: "woff2", maxBytes: 2 * MB },
    },
  },
  private_document: {
    bucket: "merchant-private",
    types: {
      "application/pdf": { kind: "document", extension: "pdf", maxBytes: 25 * MB },
      "image/jpeg": { kind: "image", extension: "jpg", maxBytes: 20 * MB },
      "image/png": { kind: "image", extension: "png", maxBytes: 20 * MB },
    },
  },
  import: {
    bucket: "imports-temporary",
    types: {
      "text/csv": { kind: "data", extension: "csv", maxBytes: 200 * MB },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { kind: "data", extension: "xlsx", maxBytes: 100 * MB },
      "application/xml": { kind: "data", extension: "xml", maxBytes: 200 * MB },
      "text/xml": { kind: "data", extension: "xml", maxBytes: 200 * MB },
    },
  },
};

export const DEFAULT_STORE_QUOTA_BYTES = 10 * 1024 * MB;
const UPLOAD_URL_TTL_SECONDS = 600;
export const SOFT_DELETE_RETENTION_DAYS = 30;

export const createUploadSchema = z.object({
  purpose: z.enum(["media", "private_document", "import"]).default("media"),
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().toLowerCase(),
  byteSize: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, "errors.asset.invalid_hash"),
  altText: z.record(z.string(), z.string().max(500)).optional(),
});

export interface UploadTicket {
  assetId: string;
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: Date;
}

export type AssetRow = typeof contentAssets.$inferSelect;

function requireR2(r2: R2Storage | null): R2Storage {
  if (!r2) throw new AppError("dependency_unavailable", "errors.storage.not_configured");
  return r2;
}

export function objectKeyFor(storeId: string, assetId: string, contentHash: string, extension: string): string {
  return `stores/${storeId}/assets/${assetId}/${contentHash}.${extension}`;
}

function permissionFor(purpose: UploadPurpose) {
  return purpose === "import" ? ("catalog:write" as const) : ("media:write" as const);
}

/**
 * Step 1–2 of the upload flow: validate type, size, quota and permission, then return a
 * short-lived presigned URL the browser uses to PUT the file directly to R2.
 */
export async function createUpload(
  db: Database,
  r2: R2Storage | null,
  ctx: StoreContext,
  input: z.infer<typeof createUploadSchema>,
  quotaBytes = DEFAULT_STORE_QUOTA_BYTES,
): Promise<UploadTicket> {
  assertCan(ctx, permissionFor(input.purpose));
  const storage = requireR2(r2);
  const policy = ALLOWED[input.purpose];
  const rule = policy.types[input.contentType];
  if (!rule) throw invalid("errors.asset.content_type_not_allowed", { contentType: input.contentType, purpose: input.purpose });
  if (input.byteSize > rule.maxBytes) throw invalid("errors.asset.too_large", { maxBytes: rule.maxBytes });

  const assetId = newId();
  const objectKey = objectKeyFor(ctx.storeId, assetId, input.sha256, rule.extension);
  const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000);

  await withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, async (tx) => {
    // Serialize quota checks per store so concurrent uploads cannot overshoot the quota.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`asset-quota:${ctx.storeId}`}))`);
    const [usage] = await tx
      .select({ used: sql<string>`coalesce(sum(${contentAssets.byteSize}), 0)` })
      .from(contentAssets)
      .where(and(eq(contentAssets.storeId, ctx.storeId), isNull(contentAssets.deletedAt)));
    if (Number(usage?.used ?? 0) + input.byteSize > quotaBytes) {
      throw new AppError("precondition_failed", "errors.asset.quota_exceeded", { quotaBytes });
    }
    await tx.insert(contentAssets).values({
      id: assetId,
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      bucket: policy.bucket,
      objectKey,
      kind: rule.kind,
      status: "pending_upload",
      contentType: input.contentType,
      extension: rule.extension,
      byteSize: input.byteSize,
      contentHash: input.sha256,
      originalFilename: input.filename,
      altText: input.altText ?? {},
      uploadedByPrincipalId: ctx.principal.userId,
      uploadExpiresAt: expiresAt,
    });
  });

  const uploadUrl = await storage.presignPut(policy.bucket, objectKey, input.contentType, input.byteSize, UPLOAD_URL_TTL_SECONDS);
  return {
    assetId,
    uploadUrl,
    method: "PUT",
    headers: { "content-type": input.contentType },
    expiresAt,
  };
}

/**
 * Step 4: the client reports the upload finished. The object must exist with the declared
 * size and type; processing (hash verification, dimensions) continues in the worker.
 */
export async function completeUpload(db: Database, r2: R2Storage | null, ctx: StoreContext, assetId: string): Promise<AssetRow> {
  const storage = requireR2(r2);
  const asset = await getAsset(db, ctx, assetId);
  assertCan(ctx, permissionFor(asset.bucket === "imports-temporary" ? "import" : "media"));
  if (asset.status !== "pending_upload") return asset;

  const head = await storage.head(asset.bucket, asset.objectKey);
  if (!head) throw new AppError("precondition_failed", "errors.asset.object_missing");
  if (head.byteSize !== asset.byteSize) throw new AppError("precondition_failed", "errors.asset.size_mismatch");
  if (head.contentType && head.contentType.toLowerCase() !== asset.contentType) {
    throw new AppError("precondition_failed", "errors.asset.content_type_mismatch");
  }

  return withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, async (tx) => {
    const [row] = await tx
      .update(contentAssets)
      .set({ status: "uploaded", uploadExpiresAt: null })
      .where(and(eq(contentAssets.id, assetId), eq(contentAssets.status, "pending_upload")))
      .returning();
    if (row) {
      await appendEvent(tx, {
        type: "asset.uploaded",
        organizationId: ctx.organizationId,
        storeId: ctx.storeId,
        aggregateType: "content_asset",
        aggregateId: assetId,
        payload: { assetId },
      });
    }
    return row ?? asset;
  });
}

/**
 * Step 5 (worker): streams the object, verifies the SHA-256 declared at upload time and
 * extracts image dimensions. Mismatching or unreadable objects are deleted and marked failed.
 */
export async function processAsset(db: Database, r2: R2Storage, assetId: string): Promise<AssetRow | null> {
  const asset = await withPlatformTx(db, (tx) => tx.query.contentAssets.findFirst({ where: eq(contentAssets.id, assetId) }));
  if (!asset || asset.deletedAt || (asset.status !== "uploaded" && asset.status !== "processing")) return asset ?? null;
  const scope = { organizationId: asset.organizationId, storeId: asset.storeId };
  await withTenantTx(db, scope, (tx) => tx.update(contentAssets).set({ status: "processing" }).where(eq(contentAssets.id, assetId)));

  const hash = createHash("sha256");
  const head: Buffer[] = [];
  let headBytes = 0;
  const stream = await r2.getStream(asset.bucket, asset.objectKey);
  for await (const chunk of stream) {
    const buf = chunk as Buffer;
    hash.update(buf);
    // Image headers live in the first bytes; 512 KiB covers JPEG EXIF-heavy files.
    if (headBytes < 512 * 1024) {
      head.push(buf);
      headBytes += buf.length;
    }
  }
  const digest = hash.digest("hex");

  let failure: string | null = null;
  let width: number | null = null;
  let height: number | null = null;
  if (digest !== asset.contentHash) failure = "hash_mismatch";
  else if (asset.kind === "image") {
    try {
      const dims = imageSize(Buffer.concat(head));
      width = dims.width ?? null;
      height = dims.height ?? null;
      if (!width || !height) failure = "unreadable_image";
    } catch {
      failure = "unreadable_image";
    }
  }

  if (failure) await r2.delete(asset.bucket, asset.objectKey);
  const [row] = await withTenantTx(db, scope, (tx) =>
    tx
      .update(contentAssets)
      .set(
        failure
          ? { status: "failed", failureReason: failure }
          : { status: "ready", width, height, readyAt: new Date(), failureReason: null },
      )
      .where(eq(contentAssets.id, assetId))
      .returning(),
  );
  return row ?? null;
}

export async function getAsset(db: Database, ctx: StoreContext, assetId: string): Promise<AssetRow> {
  const row = await withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, (tx) =>
    tx.query.contentAssets.findFirst({ where: and(eq(contentAssets.id, assetId), eq(contentAssets.storeId, ctx.storeId)) }),
  );
  if (!row || row.deletedAt) throw notFound("asset", assetId);
  return row;
}

export const listAssetsQuerySchema = z.object({
  kind: z.enum(["image", "video", "document", "font", "data", "other"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.date().optional(),
});

export async function listAssets(db: Database, ctx: StoreContext, q: z.infer<typeof listAssetsQuerySchema>): Promise<AssetRow[]> {
  assertCan(ctx, "media:read");
  return withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, (tx) =>
    tx
      .select()
      .from(contentAssets)
      .where(
        and(
          eq(contentAssets.storeId, ctx.storeId),
          isNull(contentAssets.deletedAt),
          eq(contentAssets.status, "ready"),
          q.kind ? eq(contentAssets.kind, q.kind) : undefined,
          q.before ? lt(contentAssets.createdAt, q.before) : undefined,
        ),
      )
      .orderBy(desc(contentAssets.createdAt))
      .limit(q.limit),
  );
}

export async function updateAssetAltText(db: Database, ctx: StoreContext, assetId: string, altText: Record<string, string>): Promise<AssetRow> {
  assertCan(ctx, "media:write");
  await getAsset(db, ctx, assetId);
  const [row] = await withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, (tx) =>
    tx.update(contentAssets).set({ altText }).where(eq(contentAssets.id, assetId)).returning(),
  );
  return row!;
}

/** Soft delete. The object stays in R2 until retention passes and no references remain. */
export async function deleteAsset(db: Database, ctx: StoreContext, assetId: string): Promise<void> {
  assertCan(ctx, "media:write");
  const asset = await getAsset(db, ctx, assetId);
  await withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, async (tx) => {
    await tx.update(contentAssets).set({ deletedAt: new Date() }).where(eq(contentAssets.id, assetId));
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      action: "asset.deleted",
      resourceType: "content_asset",
      resourceId: assetId,
      before: { filename: asset.originalFilename, objectKey: asset.objectKey },
    });
  });
}

/** Records that a resource uses an asset. Called by catalog/theme services inside their transaction. */
export async function setAssetReferences(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  ctx: { organizationId: string; storeId: string },
  resource: { type: string; id: string },
  assetIds: string[],
): Promise<void> {
  await tx
    .delete(assetReferences)
    .where(
      and(
        eq(assetReferences.storeId, ctx.storeId),
        eq(assetReferences.resourceType, resource.type),
        eq(assetReferences.resourceId, resource.id),
      ),
    );
  const unique = [...new Set(assetIds)];
  if (unique.length === 0) return;
  await tx.insert(assetReferences).values(
    unique.map((assetId) => ({
      id: newId(),
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      assetId,
      resourceType: resource.type,
      resourceId: resource.id,
    })),
  );
}

/**
 * Cleanup (worker): removes objects for assets soft-deleted beyond retention with no
 * references, and abandoned uploads whose presigned URL expired a day ago.
 */
export async function cleanupAssets(db: Database, r2: R2Storage, limit = 200): Promise<number> {
  const retentionCutoff = new Date(Date.now() - SOFT_DELETE_RETENTION_DAYS * 24 * 3600_000);
  const abandonedCutoff = new Date(Date.now() - 24 * 3600_000);
  const candidates = await withPlatformTx(db, (tx) =>
    tx
      .select({ id: contentAssets.id, bucket: contentAssets.bucket, objectKey: contentAssets.objectKey })
      .from(contentAssets)
      .where(
        sql`((${contentAssets.deletedAt} < ${pgTimestamp(retentionCutoff)}
              and not exists (select 1 from ${assetReferences} r where r.asset_id = ${contentAssets.id}))
          or (${contentAssets.status} = 'pending_upload' and ${contentAssets.uploadExpiresAt} < ${pgTimestamp(abandonedCutoff)})
          or (${contentAssets.status} = 'failed' and ${contentAssets.updatedAt} < ${pgTimestamp(abandonedCutoff)}))`,
      )
      .limit(limit),
  );
  for (const c of candidates) {
    await r2.delete(c.bucket, c.objectKey);
    await withPlatformTx(db, (tx) => tx.delete(contentAssets).where(eq(contentAssets.id, c.id)));
  }
  return candidates.length;
}
