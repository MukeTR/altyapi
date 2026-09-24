import { Redis } from "ioredis";
import { apiEnvSchema, parseEnv, type ApiEnv } from "@altyapi/config";
import { createDatabase, type Database } from "@altyapi/database";
import { createQueue, type Queue } from "@altyapi/events";
import { createKeyProvider, type KeyProvider } from "@altyapi/secrets";
import { createProviderRegistry, noDiscountEngine, type DiscountEngine } from "@altyapi/checkout";
import { PeerClient, runEkosistemStartupChecks, type EkosistemServerDeps } from "@altyapi/ekosistem";
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
  /** Signed client for Kârmatik / Yanıt (ekosistem v1); bases from the static env map. */
  peers: PeerClient;
  /** Server-side ekosistem services (links, exports, push receiver). */
  ekosistem: EkosistemServerDeps;
  logger: Logger;
  close: () => Promise<void>;
}

export function createDeps(source: Record<string, string | undefined> = process.env): AppDeps {
  const env = parseEnv(apiEnvSchema, source);
  const logger = createLogger({ service: "api", level: env.LOG_LEVEL, pretty: env.APP_ENV === "local" });
  // Refuses to start when request signing disagrees with the contract's test vectors.
  const peerBases = runEkosistemStartupChecks(env, logger);
  const database = createDatabase({
    url: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    ssl: env.DATABASE_SSL,
    applicationName: "altyapi-api",
  });
  const redis = new Redis(env.REDIS_URL, { keyPrefix: env.REDIS_KEY_PREFIX, maxRetriesPerRequest: 2, lazyConnect: false });
  const keys = createKeyProvider(env);
  const queue = createQueue(env, database.db);
  const peers = new PeerClient({ bases: peerBases, redis, logger });
  return {
    env,
    db: database.db,
    redis,
    queue,
    keys,
    payments: { db: database.db, keys, registry: createProviderRegistry() },
    discounts: noDiscountEngine,
    peers,
    ekosistem: {
      db: database.db,
      keys,
      redis,
      peers,
      logger,
      queue,
      storeRootDomain: env.STORE_ROOT_DOMAIN,
      mediaBaseUrl: env.MEDIA_PUBLIC_BASE_URL ?? null,
    },
    logger,
    close: async () => {
      await database.close();
      redis.disconnect();
    },
  };
}
