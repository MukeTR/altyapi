import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";

/** All timestamps are stored as timestamptz and handled in UTC. */
export const tstz = (name?: string) =>
  name ? timestamp(name, { withTimezone: true, mode: "date" }) : timestamp({ withTimezone: true, mode: "date" });

export const timestamps = {
  createdAt: tstz().notNull().defaultNow(),
  updatedAt: tstz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * Tenant columns. Every tenant-owned row carries both organization and store so that
 * repository filters and RLS policies can rely on them without joins.
 */
export const tenantColumns = () => ({
  organizationId: uuid().notNull(),
  storeId: uuid().notNull(),
});

export const now = sql`now()`;
