import { z } from "zod";
import { notFound } from "@altyapi/commerce-core";
import { and, dataOwnership, eq, externalListings, inArray, integrationConnections, productVariants, withTenantTx } from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { ensureDefaultLocation, getStockForVariants, setOnHand } from "@altyapi/inventory";
import { ensureBasePriceList, upsertPriceEntries } from "@altyapi/pricing";
import { assertCan, type StoreContext } from "@altyapi/tenancy";
import { openConnector, type IntegrationDeps } from "./connections";
import { PROVIDERS } from "./registry";
import type { WriteResult } from "./types";

/**
 * Stock and price changes are written only through the system that owns the data:
 * altyapi itself, or an integrator whose API supports the write. When the owner is
 * read-only here (a marketplace, a feed, an ERP), nothing is written and the merchant is
 * told where to make the change, because the owner's next sync would overwrite it anyway.
 */
export type WriteOutcome =
  | { mode: "altyapi"; results: WriteResult[] }
  | { mode: "owner"; owner: { connectionId: string; name: string; provider: string }; results: WriteResult[] }
  | { mode: "advice"; owner: { name: string; provider: string | null }; message: string; results: WriteResult[] };

const minor = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v));

export const stockWriteSchema = z.object({
  items: z.array(z.object({ variantId: z.uuid(), quantity: z.number().int().min(0).max(10_000_000) })).min(1).max(500),
});
export const priceWriteSchema = z.object({
  items: z.array(z.object({ variantId: z.uuid(), price: minor, listPrice: minor.nullable().optional() })).min(1).max(500),
});

async function resolveOwner(deps: IntegrationDeps, ctx: StoreContext, domain: "stock" | "price") {
  const scope = { organizationId: ctx.organizationId, storeId: ctx.storeId };
  return withTenantTx(deps.db, scope, async (tx) => {
    const row = await tx.query.dataOwnership.findFirst({ where: and(eq(dataOwnership.storeId, ctx.storeId), eq(dataOwnership.domain, domain)) });
    const conn = row?.ownerConnectionId
      ? await tx.query.integrationConnections.findFirst({ where: and(eq(integrationConnections.id, row.ownerConnectionId), eq(integrationConnections.storeId, ctx.storeId)) })
      : null;
    return { label: row?.externalOwnerLabel ?? null, conn: conn ?? null };
  });
}

async function variantsOf(deps: IntegrationDeps, ctx: StoreContext, ids: string[]) {
  const rows = await withTenantTx(deps.db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, (tx) =>
    tx.select({ id: productVariants.id, sku: productVariants.sku }).from(productVariants).where(and(eq(productVariants.storeId, ctx.storeId), inArray(productVariants.id, ids))),
  );
  if (rows.length !== new Set(ids).size) throw notFound("variant");
  return new Map(rows.map((r) => [r.id, r.sku ?? r.id]));
}

async function applyStockLocally(deps: IntegrationDeps, ctx: StoreContext, items: { variantId: string; quantity: number }[], reason: string) {
  const scope = { organizationId: ctx.organizationId, storeId: ctx.storeId };
  await withTenantTx(deps.db, scope, async (tx) => {
    const location = await ensureDefaultLocation(tx, scope);
    const stock = await getStockForVariants(tx, scope, items.map((i) => i.variantId));
    for (const i of items) {
      const other = (stock.get(i.variantId)?.byLocation ?? []).filter((b) => b.locationId !== location).reduce((s, b) => s + b.onHand, 0);
      await setOnHand(tx, scope, { variantId: i.variantId, locationId: location, quantity: Math.max(0, i.quantity - other), reason });
    }
  });
}

async function applyPricesLocally(deps: IntegrationDeps, ctx: StoreContext, items: { variantId: string; price: bigint; listPrice?: bigint | null }[]) {
  const scope = { organizationId: ctx.organizationId, storeId: ctx.storeId };
  const currency = ctx.store.defaultCurrency;
  await withTenantTx(deps.db, scope, async (tx) => {
    const listId = await ensureBasePriceList(tx, scope, currency);
    await upsertPriceEntries(
      tx,
      scope,
      { id: listId, currency },
      items.map((i) => ({ variantId: i.variantId, amount: i.price, compareAtAmount: i.listPrice && i.listPrice > i.price ? i.listPrice : null, minQuantity: 1 })),
    );
  });
}

function advice(domain: "stock" | "price", name: string, provider: string | null, skus: string[]): WriteOutcome {
  const what = domain === "stock" ? "Stok" : "Fiyat";
  return {
    mode: "advice",
    owner: { name, provider },
    message: `${what} ${name} üzerinde yönetiliyor. Bu değişikliği ${name} üzerinde yapın; altyapi bir sonraki senkronda güncel değeri okur.`,
    results: skus.map((sku) => ({ sku, ok: false, message: "owner_is_read_only" })),
  };
}

async function listingRefs(deps: IntegrationDeps, ctx: StoreContext, connectionId: string, variantIds: string[]) {
  const rows = await withTenantTx(deps.db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, (tx) =>
    tx
      .select({ variantId: externalListings.variantId, sku: externalListings.sku, externalId: externalListings.externalId })
      .from(externalListings)
      .where(and(eq(externalListings.connectionId, connectionId), inArray(externalListings.variantId, variantIds))),
  );
  return new Map(rows.map((r) => [r.variantId!, r]));
}

export async function writeStock(deps: IntegrationDeps, ctx: StoreContext, input: z.infer<typeof stockWriteSchema>): Promise<WriteOutcome> {
  assertCan(ctx, "inventory:write");
  const skus = await variantsOf(deps, ctx, input.items.map((i) => i.variantId));
  const { label, conn } = await resolveOwner(deps, ctx, "stock");
  let outcome: WriteOutcome;
  if (label && !conn) outcome = advice("stock", label, null, [...skus.values()]);
  else if (!conn) {
    await applyStockLocally(deps, ctx, input.items, "manual:altyapi_owner");
    outcome = { mode: "altyapi", results: input.items.map((i) => ({ sku: skus.get(i.variantId)!, ok: true })) };
  } else {
    const provider = PROVIDERS[conn.provider as keyof typeof PROVIDERS];
    if (!provider.capabilities.writeStock || conn.status !== "active") outcome = advice("stock", conn.name, conn.provider, [...skus.values()]);
    else {
      const refs = await listingRefs(deps, ctx, conn.id, input.items.map((i) => i.variantId));
      const missing = input.items.filter((i) => !refs.has(i.variantId));
      const { connector, persist } = await openConnector(deps, conn, ctx.store.defaultCurrency);
      const pushed = await connector.pushStock!(
        input.items.filter((i) => refs.has(i.variantId)).map((i) => ({ sku: refs.get(i.variantId)!.sku ?? skus.get(i.variantId)!, externalId: refs.get(i.variantId)!.externalId, quantity: i.quantity })),
      );
      await persist();
      // Mirror accepted writes locally so the storefront does not wait for the next sync.
      const okSkus = new Set(pushed.filter((r) => r.ok).map((r) => r.sku));
      const accepted = input.items.filter((i) => refs.has(i.variantId) && okSkus.has(refs.get(i.variantId)!.sku ?? skus.get(i.variantId)!));
      if (accepted.length) await applyStockLocally(deps, ctx, accepted, `integration:${conn.id}`);
      outcome = {
        mode: "owner",
        owner: { connectionId: conn.id, name: conn.name, provider: conn.provider },
        results: [...pushed, ...missing.map((i) => ({ sku: skus.get(i.variantId)!, ok: false, message: "not_listed_at_owner" }))],
      };
    }
  }
  await withTenantTx(deps.db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, (tx) =>
    recordAudit(tx, {
      action: "integration.stock_write",
      resourceType: "data_ownership",
      resourceId: "stock",
      after: { mode: outcome.mode, items: input.items, results: outcome.results },
    }),
  );
  return outcome;
}

export async function writePrices(deps: IntegrationDeps, ctx: StoreContext, input: z.infer<typeof priceWriteSchema>): Promise<WriteOutcome> {
  assertCan(ctx, "pricing:write");
  const skus = await variantsOf(deps, ctx, input.items.map((i) => i.variantId));
  const { label, conn } = await resolveOwner(deps, ctx, "price");
  let outcome: WriteOutcome;
  if (label && !conn) outcome = advice("price", label, null, [...skus.values()]);
  else if (!conn) {
    await applyPricesLocally(deps, ctx, input.items);
    outcome = { mode: "altyapi", results: input.items.map((i) => ({ sku: skus.get(i.variantId)!, ok: true })) };
  } else {
    const provider = PROVIDERS[conn.provider as keyof typeof PROVIDERS];
    if (!provider.capabilities.writePrice || conn.status !== "active") outcome = advice("price", conn.name, conn.provider, [...skus.values()]);
    else {
      const refs = await listingRefs(deps, ctx, conn.id, input.items.map((i) => i.variantId));
      const missing = input.items.filter((i) => !refs.has(i.variantId));
      const { connector, persist } = await openConnector(deps, conn, ctx.store.defaultCurrency);
      const pushed = await connector.pushPrice!(
        input.items
          .filter((i) => refs.has(i.variantId))
          .map((i) => ({ sku: refs.get(i.variantId)!.sku ?? skus.get(i.variantId)!, externalId: refs.get(i.variantId)!.externalId, price: i.price, listPrice: i.listPrice ?? null })),
        ctx.store.defaultCurrency,
      );
      await persist();
      const okSkus = new Set(pushed.filter((r) => r.ok).map((r) => r.sku));
      const accepted = input.items.filter((i) => refs.has(i.variantId) && okSkus.has(refs.get(i.variantId)!.sku ?? skus.get(i.variantId)!));
      if (accepted.length) await applyPricesLocally(deps, ctx, accepted);
      outcome = {
        mode: "owner",
        owner: { connectionId: conn.id, name: conn.name, provider: conn.provider },
        results: [...pushed, ...missing.map((i) => ({ sku: skus.get(i.variantId)!, ok: false, message: "not_listed_at_owner" }))],
      };
    }
  }
  await withTenantTx(deps.db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, (tx) =>
    recordAudit(tx, {
      action: "integration.price_write",
      resourceType: "data_ownership",
      resourceId: "price",
      after: { mode: outcome.mode, items: input.items.map((i) => ({ variantId: i.variantId, price: i.price, listPrice: i.listPrice ?? null })), results: outcome.results },
    }),
  );
  return outcome;
}
