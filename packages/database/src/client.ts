import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

export type Schema = typeof schema;
export type Database = PostgresJsDatabase<Schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything that can run queries: the root database handle or an open transaction. */
export type DbExecutor = Database | Transaction;

export interface DatabaseOptions {
  url: string;
  max?: number;
  ssl?: boolean;
  applicationName?: string;
}

export interface DatabaseHandle {
  db: Database;
  close: () => Promise<void>;
}

export function createDatabase(opts: DatabaseOptions): DatabaseHandle {
  const client = postgres(opts.url, {
    max: opts.max ?? 10,
    ssl: opts.ssl ? "require" : false,
    connection: { application_name: opts.applicationName ?? "altyapi" },
    // bigint columns (money minor units, counters) are returned as JS bigint
    types: { bigint: postgres.BigInt },
    onnotice: () => {},
  });
  const db = drizzle(client, { schema, casing: "snake_case" });
  return { db, close: () => client.end({ timeout: 5 }) };
}

export interface TenantScope {
  organizationId: string;
  storeId?: string | undefined;
}

/**
 * Runs fn in a transaction with the tenant scope published to PostgreSQL session settings.
 * RLS policies (second line of defense) read these settings; repositories still filter
 * explicitly by organization/store id.
 */
export async function withTenantTx<T>(db: Database, scope: TenantScope, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.organization_id', ${scope.organizationId}, true),
                 set_config('app.store_id', ${scope.storeId ?? ""}, true),
                 set_config('app.bypass_rls', 'off', true)`,
    );
    return fn(tx);
  });
}

/**
 * Platform-level transaction (hostname resolution, schedulers, cross-tenant maintenance).
 * Must only be used by system code paths, never with user-controlled scope.
 */
export async function withPlatformTx<T>(db: Database, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.bypass_rls', 'on', true)`);
    return fn(tx);
  });
}
