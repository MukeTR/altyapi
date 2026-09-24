import { newId } from "@altyapi/commerce-core";
import {
  and,
  dataOwnership,
  eq,
  externalListings,
  inArray,
  integrationConnections,
  integrationDiscrepancies,
  isNotNull,
  lt,
  ne,
  pgArray,
  sql,
  stores,
  withTenantTx,
  type DiscrepancyValue,
  type Transaction,
} from "@altyapi/database";
import { ensureDefaultLocation, getStockForVariants, setOnHand } from "@altyapi/inventory";
import type { IntegrationDeps } from "./connections";

type Scope = { organizationId: string; storeId: string };

export interface ReconcileSummary {
  removed: number;
  matched: number;
  stockApplied: number;
  discrepanciesOpen: number;
  discrepanciesResolved: number;
}

/** Links external listings to altyapi variants: exact SKU first, then barcode. */
async function matchVariants(tx: Transaction, storeId: string, connectionId: string): Promise<number> {
  const bySku = await tx.execute(sql`
    update external_listings el set variant_id = pv.id
    from product_variants pv
    where el.connection_id = ${connectionId} and el.variant_id is null and el.sku is not null
      and pv.store_id = ${storeId} and pv.archived_at is null and pv.sku = el.sku`);
  const byBarcode = await tx.execute(sql`
    update external_listings el set variant_id = pv.id
    from product_variants pv
    where el.connection_id = ${connectionId} and el.variant_id is null and el.barcode is not null
      and pv.store_id = ${storeId} and pv.archived_at is null and pv.barcode = el.barcode`);
  return Number((bySku as unknown as { count?: number }).count ?? 0) + Number((byBarcode as unknown as { count?: number }).count ?? 0);
}

async function basePrices(tx: Transaction, storeId: string, currency: string, variantIds: string[]): Promise<Map<string, bigint>> {
  if (!variantIds.length) return new Map();
  const rows = await tx.execute<{ variant_id: string; amount: string }>(sql`
    select ma.variant_id, ma.amount::text as amount
    from money_amounts ma join price_lists pl on pl.id = ma.price_list_id
    where pl.store_id = ${storeId} and pl.kind = 'base' and pl.currency = ${currency} and ma.min_quantity = 1
      and ma.variant_id = any(${pgArray(variantIds, "uuid")})`);
  return new Map(rows.map((r) => [r.variant_id, BigInt(r.amount)]));
}

/**
 * After a complete listing pass: drops listings the provider no longer reports, matches
 * listings to variants, applies stock from the stock owner (when that owner is this
 * connection) and records or resolves discrepancies between systems.
 */
export async function reconcileStore(deps: IntegrationDeps, scope: Scope, connectionId: string, passStartedAt: Date): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { removed: 0, matched: 0, stockApplied: 0, discrepanciesOpen: 0, discrepanciesResolved: 0 };
  const { store, owners, connections } = await withTenantTx(deps.db, scope, async (tx) => {
    const removed = await tx
      .delete(externalListings)
      .where(and(eq(externalListings.connectionId, connectionId), lt(externalListings.lastSeenAt, passStartedAt)))
      .returning({ id: externalListings.id });
    summary.removed = removed.length;
    summary.matched = await matchVariants(tx, scope.storeId, connectionId);
    return {
      store: await tx.query.stores.findFirst({ where: eq(stores.id, scope.storeId) }),
      owners: await tx.select().from(dataOwnership).where(eq(dataOwnership.storeId, scope.storeId)),
      connections: await tx.select().from(integrationConnections).where(and(eq(integrationConnections.storeId, scope.storeId), ne(integrationConnections.status, "paused"))),
    };
  });
  const currency = store?.defaultCurrency ?? "TRY";
  const stockOwner = owners.find((o) => o.domain === "stock")?.ownerConnectionId ?? null;
  const priceOwner = owners.find((o) => o.domain === "price")?.ownerConnectionId ?? null;
  const connById = new Map(connections.map((c) => [c.id, c]));

  const variantIds = (
    await withTenantTx(deps.db, scope, (tx) =>
      tx
        .selectDistinct({ id: externalListings.variantId })
        .from(externalListings)
        .where(and(eq(externalListings.connectionId, connectionId), isNotNull(externalListings.variantId))),
    )
  ).map((r) => r.id!);

  for (let i = 0; i < variantIds.length; i += 500) {
    const batch = variantIds.slice(i, i + 500);
    await withTenantTx(deps.db, scope, async (tx) => {
      const listings = await tx
        .select()
        .from(externalListings)
        .where(and(eq(externalListings.storeId, scope.storeId), inArray(externalListings.variantId, batch)));

      // The stock owner is the source of truth: altyapi follows it instead of flagging it.
      if (stockOwner === connectionId) {
        const location = await ensureDefaultLocation(tx, scope);
        const stock = await getStockForVariants(tx, scope, batch);
        for (const l of listings.filter((x) => x.connectionId === connectionId && x.stock !== null)) {
          const s = stock.get(l.variantId!);
          if (!s || !s.tracked || s.onHand === l.stock) continue;
          const other = s.byLocation.filter((b) => b.locationId !== location).reduce((sum, b) => sum + b.onHand, 0);
          const res = await setOnHand(tx, scope, { variantId: l.variantId!, locationId: location, quantity: Math.max(0, l.stock! - other), reason: `integration:${connectionId}` });
          if (res) summary.stockApplied += 1;
        }
      }

      const stock = await getStockForVariants(tx, scope, batch);
      const prices = await basePrices(tx, scope.storeId, currency, batch);
      const skuOf = new Map<string, string>();
      for (const l of listings) if (l.sku && !skuOf.has(l.variantId!)) skuOf.set(l.variantId!, l.sku);

      for (const variantId of batch) {
        const own = listings.filter((l) => l.variantId === variantId && connById.has(l.connectionId));
        const sku = skuOf.get(variantId) ?? own[0]?.barcode ?? variantId;
        const s = stock.get(variantId);
        const stockValues: DiscrepancyValue[] = [
          ...(s?.tracked ? [{ source: "altyapi", label: "altyapi", value: String(s.onHand), owner: stockOwner === null }] : []),
          ...own
            .filter((l) => l.stock !== null)
            .map((l) => ({ source: l.connectionId, label: connById.get(l.connectionId)!.name, value: String(l.stock), owner: stockOwner === l.connectionId })),
        ];
        // Marketplace prices include channel commission by design; compare only systems that
        // hold the merchant's own price (altyapi, integrators, exports).
        const base = prices.get(variantId);
        const priceValues: DiscrepancyValue[] = [
          ...(base !== undefined ? [{ source: "altyapi", label: "altyapi", value: base.toString(), owner: priceOwner === null }] : []),
          ...own
            .filter((l) => l.price !== null && l.currency === currency && connById.get(l.connectionId)!.kind !== "marketplace")
            .map((l) => ({ source: l.connectionId, label: connById.get(l.connectionId)!.name, value: l.price!.toString(), owner: priceOwner === l.connectionId })),
        ];
        for (const [field, values] of [
          ["stock", stockValues],
          ["price", priceValues],
        ] as const) {
          const differs = values.length > 1 && new Set(values.map((v) => v.value)).size > 1;
          const open = await tx.query.integrationDiscrepancies.findFirst({
            where: and(eq(integrationDiscrepancies.storeId, scope.storeId), eq(integrationDiscrepancies.sku, sku), eq(integrationDiscrepancies.field, field), ne(integrationDiscrepancies.status, "resolved")),
          });
          if (differs) {
            summary.discrepanciesOpen += 1;
            if (open) await tx.update(integrationDiscrepancies).set({ values, variantId, lastCheckedAt: new Date() }).where(eq(integrationDiscrepancies.id, open.id));
            else await tx.insert(integrationDiscrepancies).values({ id: newId(), ...scope, variantId, sku, field, values });
          } else if (open) {
            summary.discrepanciesResolved += 1;
            await tx.update(integrationDiscrepancies).set({ status: "resolved", resolvedAt: new Date(), values, lastCheckedAt: new Date() }).where(eq(integrationDiscrepancies.id, open.id));
          }
        }
      }
    });
  }
  deps.logger.info({ connectionId, ...summary }, "integration reconciled");
  return summary;
}
