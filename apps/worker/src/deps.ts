import { Redis } from "ioredis";
import { parseEnv, workerEnvSchema, type WorkerEnv } from "@altyapi/config";
import { createDatabase, type Database } from "@altyapi/database";
import { createDomainDeps, type DomainDeps } from "@altyapi/domains";
import { createQueue, type Queue } from "@altyapi/events";
import { createKeyProvider } from "@altyapi/secrets";
import { createProviderRegistry } from "@altyapi/checkout";
import { PeerClient, runEkosistemStartupChecks } from "@altyapi/ekosistem";
import type { PaymentsDeps } from "@altyapi/payments";
import { createLogger, type Logger } from "@altyapi/observability";

export interface WorkerDeps {
  env: WorkerEnv;
  db: Database;
  redis: Redis;
  queue: Queue;
  logger: Logger;
  domains: DomainDeps;
  payments: PaymentsDeps;
  /** Signed client for Kârmatik / Yanıt (ekosistem v1); bases from the static env map. */
  peers: PeerClient;
  close: () => Promise<void>;
}

export function createWorkerDeps(source: Record<string, string | undefined> = process.env): WorkerDeps {
  const env = parseEnv(workerEnvSchema, source);
  const logger = createLogger({ service: "worker", level: env.LOG_LEVEL, pretty: env.APP_ENV === "local" });
  // Refuses to start when request signing disagrees with the contract's test vectors.
  const peerBases = runEkosistemStartupChecks(env, logger);
  const database = createDatabase({
    url: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    ssl: env.DATABASE_SSL,
    applicationName: "altyapi-worker",
  });
  const redis = new Redis(env.REDIS_URL, { keyPrefix: env.REDIS_KEY_PREFIX, maxRetriesPerRequest: 2 });
  return {
    env,
    db: database.db,
    redis,
    queue: createQueue(env, database.db),
    logger,
    domains: createDomainDeps(env, database.db),
    payments: { db: database.db, keys: createKeyProvider(env), registry: createProviderRegistry() },
    peers: new PeerClient({ bases: peerBases, redis, logger }),
    close: async () => {
      await database.close();
      redis.disconnect();
    },
  };
}
