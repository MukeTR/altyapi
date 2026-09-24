import { sql, type SQL } from "drizzle-orm";

/**
 * Binds a JS array as a single typed PostgreSQL array parameter for use with = any(...).
 * (Arrays interpolated directly into sql`` templates are expanded into value lists.)
 */
export function pgArray(values: readonly string[], type: "uuid" | "text"): SQL {
  return sql`${sql.param(values)}::${sql.raw(type)}[]`;
}

/** Binds a Date as timestamptz inside raw sql`` fragments, where column encoders do not apply. */
export function pgTimestamp(date: Date): SQL {
  return sql`${date.toISOString()}::timestamptz`;
}
