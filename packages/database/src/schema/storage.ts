import { sql } from "drizzle-orm";
import { bigint, index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamps, tstz } from "./_shared";
import { stores } from "./tenancy";

export const assetBucket = pgEnum("asset_bucket", [
  "storefront-public",
  "merchant-private",
  "imports-temporary",
  "exports-temporary",
  "audit-archive",
]);

export const assetStatus = pgEnum("asset_status", ["pending_upload", "uploaded", "processing", "ready", "failed"]);

export const assetKind = pgEnum("asset_kind", ["image", "video", "document", "font", "data", "other"]);

/**
 * Binary objects live in R2; PostgreSQL only stores metadata. Object key layout:
 * stores/{store_id}/assets/{asset_id}/{content_hash}.{extension}
 */
export const contentAssets = pgTable(
  "content_assets",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    bucket: assetBucket().notNull(),
    objectKey: text().notNull(),
    kind: assetKind().notNull(),
    status: assetStatus().notNull().default("pending_upload"),
    contentType: text().notNull(),
    extension: text().notNull(),
    byteSize: bigint({ mode: "number" }).notNull(),
    /** SHA-256 (hex) declared by the client and verified by the worker after upload. */
    contentHash: text().notNull(),
    originalFilename: text(),
    altText: jsonb().$type<Record<string, string>>().notNull().default({}),
    width: integer(),
    height: integer(),
    durationMs: integer(),
    failureReason: text(),
    uploadedByPrincipalId: uuid(),
    uploadExpiresAt: tstz(),
    readyAt: tstz(),
    /** Soft delete; the object is removed after retention if nothing references it. */
    deletedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("content_assets_object_uq").on(t.bucket, t.objectKey),
    index("content_assets_store_idx").on(t.storeId, t.createdAt),
    index("content_assets_store_hash_idx").on(t.storeId, t.contentHash),
    index("content_assets_cleanup_idx").on(t.deletedAt).where(sql`${t.deletedAt} is not null`),
  ],
);

/**
 * Where an asset is used (product media, section props, SEO images, …). Maintained by the
 * owning services so cleanup can tell whether a soft-deleted asset is still referenced.
 */
export const assetReferences = pgTable(
  "asset_references",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    assetId: uuid()
      .notNull()
      .references(() => contentAssets.id, { onDelete: "cascade" }),
    resourceType: text().notNull(),
    resourceId: text().notNull(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("asset_references_uq").on(t.assetId, t.resourceType, t.resourceId),
    index("asset_references_resource_idx").on(t.storeId, t.resourceType, t.resourceId),
  ],
);
