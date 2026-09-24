import { Redis } from "ioredis";
import { apiEnvSchema, parseEnv, type ApiEnv } from "@altyapi/config";
import { createDatabase, type Database } from "@altyapi/database";
import { createLogger, type Logger } from "@altyapi/observability";

export interface AppDeps {
  env: ApiEnv;
  db: Database;
  redis: Redis;
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
  return {
    env,
    db: database.db,
    redis,
    logger,
    close: async () => {
      await database.close();
      redis.disconnect();
    },
  };
}
