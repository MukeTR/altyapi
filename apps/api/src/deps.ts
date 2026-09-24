import { Redis } from "ioredis";
import { apiEnvSchema, parseEnv, type ApiEnv } from "@altyapi/config";
import { createDatabase, type Database } from "@altyapi/database";
import { createQueue, type Queue } from "@altyapi/events";
import { createKeyProvider, type KeyProvider } from "@altyapi/secrets";
import { createProviderRegistry, noDiscountEngine, type DiscountEngine } from "@altyapi/checkout";
import type { PaymentsDeps } from "@altyapi/payments";
import { createLogger, type Logger } from "@altyapi/observability";

export interface AppDeps {
  env: ApiEnv;
  db: Database;
  redis: Redis;
  queue: Queue;
  keys: KeyProvider | null;
  payments: PaymentsDeps;
  discounts: DiscountEngine;
  logger: Logger;
  close: () => Promise<void>;
}

export function createDeps(source: Record<string, string | undefined> = process.env): AppDeps {
  const env = parseEnv(apiEnvSchema, source);
  const logger = createLogger({ service: "api", level: env.LOG_LEVEL, pretty: env.APP_ENV === "local" });
  const database = createDatabase({
    url: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    ssl: env.DATABASE_SSL,
    applicationName: "altyapi-api",
  });
  const redis = new Redis(env.REDIS_URL, { keyPrefix: env.REDIS_KEY_PREFIX, maxRetriesPerRequest: 2, lazyConnect: false });
  const keys = createKeyProvider(env);
  return {
    env,
    db: database.db,
    redis,
    queue: createQueue(env, database.db),
    keys,
    payments: { db: database.db, keys, registry: createProviderRegistry() },
    discounts: noDiscountEngine,
    logger,
    close: async () => {
      await database.close();
      redis.disconnect();
    },
  };
}
