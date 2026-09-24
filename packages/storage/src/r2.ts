import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";

export type BucketName = "storefront-public" | "merchant-private" | "imports-temporary" | "exports-temporary" | "audit-archive";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Logical bucket → actual R2 bucket name (allows per-environment prefixes). */
  buckets: Record<BucketName, string>;
  endpoint?: string;
}

export interface ObjectHead {
  byteSize: number;
  contentType: string | undefined;
  etag: string | undefined;
}

/** Cloudflare R2 through its S3-compatible API. */
export class R2Storage {
  private readonly client: S3Client;

  constructor(private readonly cfg: R2Config) {
    this.client = new S3Client({
      region: "auto",
      endpoint: cfg.endpoint ?? `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      forcePathStyle: true,
      // Checksums are verified by the worker from the object bytes.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  private bucket(name: BucketName): string {
    return this.cfg.buckets[name];
  }

  /** Short-lived presigned PUT; content type and length are part of the signature. */
  presignPut(bucket: BucketName, key: string, contentType: string, byteSize: number, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket(bucket), Key: key, ContentType: contentType, ContentLength: byteSize }),
      { expiresIn: expiresInSeconds, signableHeaders: new Set(["content-type", "content-length"]) },
    );
  }

  presignGet(bucket: BucketName, key: string, expiresInSeconds: number, downloadName?: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket(bucket),
        Key: key,
        ...(downloadName ? { ResponseContentDisposition: `attachment; filename="${downloadName.replace(/"/g, "")}"` } : {}),
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  async head(bucket: BucketName, key: string): Promise<ObjectHead | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket(bucket), Key: key }));
      return { byteSize: res.ContentLength ?? 0, contentType: res.ContentType, etag: res.ETag };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw err;
    }
  }

  async getStream(bucket: BucketName, key: string): Promise<Readable> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket(bucket), Key: key }));
    return res.Body as Readable;
  }

  async put(bucket: BucketName, key: string, body: Buffer | Uint8Array | string, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket(bucket), Key: key, Body: body, ContentType: contentType }));
  }

  async delete(bucket: BucketName, key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket(bucket), Key: key }));
  }
}

export interface StorageEnv {
  R2_ACCOUNT_ID?: string | undefined;
  R2_ACCESS_KEY_ID?: string | undefined;
  R2_SECRET_ACCESS_KEY?: string | undefined;
  R2_BUCKET_STOREFRONT_PUBLIC: string;
  R2_BUCKET_MERCHANT_PRIVATE: string;
  R2_BUCKET_IMPORTS_TEMPORARY: string;
  R2_BUCKET_EXPORTS_TEMPORARY: string;
  R2_BUCKET_AUDIT_ARCHIVE: string;
}

/** Returns null when R2 credentials are missing; upload endpoints then fail with a clear error. */
export function createR2Storage(env: StorageEnv): R2Storage | null {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) return null;
  return new R2Storage({
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    buckets: {
      "storefront-public": env.R2_BUCKET_STOREFRONT_PUBLIC,
      "merchant-private": env.R2_BUCKET_MERCHANT_PRIVATE,
      "imports-temporary": env.R2_BUCKET_IMPORTS_TEMPORARY,
      "exports-temporary": env.R2_BUCKET_EXPORTS_TEMPORARY,
      "audit-archive": env.R2_BUCKET_AUDIT_ARCHIVE,
    },
  });
}
