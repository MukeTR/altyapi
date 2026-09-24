import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const csv = z
  .string()
  .transform((v) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

export const runtimeSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_ENV: z.enum(["local", "staging", "production"]).default("local"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

export const appUrlsSchema = z.object({
  ADMIN_URL: z.url(),
  API_URL: z.url(),
  STOREFRONT_INTERNAL_URL: z.url(),
  /** Root domain used for default store hostnames: {store_slug}.{STORE_ROOT_DOMAIN} */
  STORE_ROOT_DOMAIN: z.string().min(3).default("altyapi.store"),
  /** Hostname merchants point their CNAME records to (Cloudflare for SaaS fallback origin). */
  CUSTOM_DOMAIN_CNAME_TARGET: z.string().min(3).default("stores.altyapi.store"),
  CORS_ALLOWED_ORIGINS: csv.default([]),
});

export const postgresSchema = z.object({
  DATABASE_URL: z.url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  /** Optional read replica (Aurora reader endpoint). Falls back to DATABASE_URL. */
  DATABASE_READ_URL: z.url().optional(),
  DATABASE_SSL: bool.default(false),
});

export const redisSchema = z.object({
  REDIS_URL: z.url(),
  REDIS_KEY_PREFIX: z.string().default("altyapi:"),
});

export const queueSchema = z.object({
  QUEUE_DRIVER: z.enum(["sqs", "postgres"]).default("postgres"),
  SQS_EVENTS_QUEUE_URL: z.url().optional(),
  SQS_JOBS_QUEUE_URL: z.url().optional(),
  SQS_DEAD_LETTER_QUEUE_URL: z.url().optional(),
  QUEUE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
});

export const cloudflareSchema = z.object({
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  /** Zone that owns STORE_ROOT_DOMAIN and hosts Cloudflare for SaaS custom hostnames. */
  CLOUDFLARE_ZONE_ID: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_STOREFRONT_PUBLIC: z.string().default("storefront-public"),
  R2_BUCKET_MERCHANT_PRIVATE: z.string().default("merchant-private"),
  R2_BUCKET_IMPORTS_TEMPORARY: z.string().default("imports-temporary"),
  R2_BUCKET_EXPORTS_TEMPORARY: z.string().default("exports-temporary"),
  R2_BUCKET_AUDIT_ARCHIVE: z.string().default("audit-archive"),
  /** Public hostname in front of the storefront-public bucket with Image Transformations enabled. */
  MEDIA_PUBLIC_BASE_URL: z.url().optional(),
  /** Shared secret between edge-router and storefront/api for signed routing metadata. */
  EDGE_ROUTING_SECRET: z.string().min(32),
});

export const awsSchema = z.object({
  AWS_REGION: z.string().default("eu-central-1"),
  /** KMS key used to wrap data encryption keys (envelope encryption). */
  KMS_KEY_ID: z.string().optional(),
  SECRETS_DRIVER: z.enum(["aws-kms", "local"]).default("local"),
  /** Base64 32-byte key used only by the local secrets driver (development). */
  LOCAL_MASTER_KEY: z.string().optional(),
});

export const authSchema = z.object({
  SESSION_COOKIE_NAME: z.string().default("altyapi_session"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 14),
  COOKIE_DOMAIN: z.string().optional(),
  /** HMAC secret for approval links, CSRF tokens and other signed values. */
  APP_SIGNING_SECRET: z.string().min(32),
});

export const aiSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  MCP_ISSUER_URL: z.url().optional(),
  MCP_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
});

export const karmatikSchema = z.object({
  KARMATIK_API_URL: z.url().optional(),
  KARMATIK_API_KEY: z.string().optional(),
  KARMATIK_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
});

export const yanitSchema = z.object({
  YANIT_API_URL: z.url().optional(),
  YANIT_API_KEY: z.string().optional(),
  YANIT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
});

export const observabilitySchema = z.object({
  SENTRY_DSN: z.url().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  OTEL_SERVICE_NAME: z.string().optional(),
});

export type RuntimeEnv = z.infer<typeof runtimeSchema>;

/**
 * Parses the given source against the schema and throws a readable error listing every
 * invalid variable. Secrets are never echoed back; only variable names and issues are reported.
 */
export function parseEnv<S extends z.ZodType>(
  schema: S,
  source: Record<string, string | undefined> = process.env,
): z.infer<S> {
  // Empty values in .env files mean "not set" so optional variables fall back to defaults.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ""));
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}

export const apiEnvSchema = runtimeSchema
  .extend(appUrlsSchema.shape)
  .extend(postgresSchema.shape)
  .extend(redisSchema.shape)
  .extend(queueSchema.shape)
  .extend(cloudflareSchema.shape)
  .extend(awsSchema.shape)
  .extend(authSchema.shape)
  .extend(aiSchema.shape)
  .extend(karmatikSchema.shape)
  .extend(yanitSchema.shape)
  .extend(observabilitySchema.shape)
  .extend({
    API_HOST: z.string().default("0.0.0.0"),
    API_PORT: z.coerce.number().int().positive().default(4000),
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const workerEnvSchema = apiEnvSchema.omit({ API_HOST: true, API_PORT: true }).extend({
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(8),
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(4100),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export const migrationEnvSchema = runtimeSchema.extend(postgresSchema.shape);
