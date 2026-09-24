import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { migrationEnvSchema, parseEnv } from "@altyapi/config";
import { createDatabase } from "./client";

const env = parseEnv(migrationEnvSchema);
const { db, close } = createDatabase({ url: env.DATABASE_URL, max: 1, ssl: env.DATABASE_SSL, applicationName: "altyapi-migrate" });
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");

try {
  await migrate(db, { migrationsFolder });
  console.log("migrations applied");
} finally {
  await close();
}
