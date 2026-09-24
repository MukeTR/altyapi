import { z } from "zod";
import { decodeCursor, encodeCursor, notFound } from "@altyapi/commerce-core";
import { and, desc, eq, externalListings, externalOrders, ilike, integrationDiscrepancies, isNull, lt, or, sql, withTenantTx, type Database } from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { assertCan, type StoreContext } from "@altyapi/tenancy";

export const externalOrdersQuerySchema = z.object({
  connectionId: z.uuid().optional(),
  status: z.string().max(40).optional(),
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
});

/** Orders from every connected channel, newest first. */
export async function listExternalOrders(db: Database, ctx: StoreContext, q: z.infer<typeof externalOrdersQuerySchema>) {
  assertCan(ctx, "integrations:read");
  const after = q.cursor ? decodeCursor(q.cursor) : null;
  const rows = await withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, (tx) =>
    tx
      .select()
      .from(externalOrders)
      .where(
        and(
          eq(externalOrders.storeId, ctx.storeId),
          q.connectionId ? eq(externalOrders.connectionId, q.connectionId) : undefined,
          q.status ? eq(externalOrders.status, q.status as typeof externalOrders.$inferSelect.status) : undefined,
          q.q ? or(ilike(externalOrders.externalNumber, `%${q.q}%`), ilike(externalOrders.externalId, `%${q.q}%`)) : undefined,
          after ? sql`(${externalOrders.createdAt}, ${externalOrders.id}) < (${new Date(String(after[0]))}, ${String(after[1])})` : undefined,
        ),
      )
      .orderBy(desc(externalOrders.createdAt), desc(externalOrders.id))
      .limit(q.limit + 1),
  );
  const items = rows.slice(0, q.limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > q.limit && last ? encodeCursor([last.createdAt.toISOString(), last.id]) : null };
}

export const externalListingsQuerySchema = z.object({
  connectionId: z.uuid().optional(),
  unmatched: z.coerce.boolean().optional(),
  sku: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

export async function listExternalListings(db: Database, ctx: StoreContext, q: z.infer<typeof externalListingsQuerySchema>) {
  assertCan(ctx, "integrations:read");
  return withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, async (tx) => {
    const items = await tx
      .select()
      .from(externalListings)
      .where(
        and(
          eq(externalListings.storeId, ctx.storeId),
          q.connectionId ? eq(externalListings.connectionId, q.connectionId) : undefined,
          q.unmatched ? isNull(externalListings.variantId) : undefined,
          q.sku ? ilike(externalListings.sku, `%${q.sku}%`) : undefined,
        ),
      )
      .orderBy(externalListings.sku, externalListings.id)
      .limit(q.limit)
      .offset(q.offset);
    return { items };
  });
}

export const discrepancyQuerySchema = z.object({
  status: z.enum(["open", "acknowledged", "resolved"]).default("open"),
  field: z.enum(["stock", "price"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  before: z.iso.datetime().optional(),
});

/** Signals where systems disagree; the owner's value is marked in each entry. */
export async function listDiscrepancies(db: Database, ctx: StoreContext, q: z.infer<typeof discrepancyQuerySchema>) {
  assertCan(ctx, "integrations:read");
  const items = await withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, (tx) =>
    tx
      .select()
      .from(integrationDiscrepancies)
      .where(
        and(
          eq(integrationDiscrepancies.storeId, ctx.storeId),
          eq(integrationDiscrepancies.status, q.status),
          q.field ? eq(integrationDiscrepancies.field, q.field) : undefined,
          q.before ? lt(integrationDiscrepancies.detectedAt, new Date(q.before)) : undefined,
        ),
      )
      .orderBy(desc(integrationDiscrepancies.detectedAt))
      .limit(q.limit),
  );
  return { items };
}

export async function acknowledgeDiscrepancy(db: Database, ctx: StoreContext, id: string) {
  assertCan(ctx, "integrations:manage");
  return withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, async (tx) => {
    const [row] = await tx
      .update(integrationDiscrepancies)
      .set({ status: "acknowledged" })
      .where(and(eq(integrationDiscrepancies.id, id), eq(integrationDiscrepancies.storeId, ctx.storeId), eq(integrationDiscrepancies.status, "open")))
      .returning();
    if (!row) throw notFound("integration_discrepancy", id);
    await recordAudit(tx, { action: "integration.discrepancy_acknowledged", resourceType: "integration_discrepancy", resourceId: id });
    return row;
  });
}
