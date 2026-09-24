import { z } from "zod";
import { AppError, invalid, newId, notFound } from "@altyapi/commerce-core";
import {
  and,
  asc,
  eq,
  inArray,
  inventoryItems,
  inventoryLevels,
  inventoryLocations,
  lte,
  productVariants,
  stockReservations,
  stockTransferLines,
  stockTransfers,
  withPlatformTx,
  withTenantTx,
  type Database,
  type Transaction,
} from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { assertCan, type StoreContext } from "@altyapi/tenancy";
import { applyLedgerEntry, lockLevels, type LevelSnapshot, type Scope } from "./ledger";

const scopeOf = (ctx: StoreContext): Scope => ({ organizationId: ctx.organizationId, storeId: ctx.storeId });

// ---------------------------------------------------------------------------
// Locations & items
// ---------------------------------------------------------------------------

export async function ensureDefaultLocation(tx: Transaction, scope: Scope): Promise<string> {
  const existing = await tx.query.inventoryLocations.findFirst({ where: eq(inventoryLocations.storeId, scope.storeId), orderBy: asc(inventoryLocations.priority) });
  if (existing) return existing.id;
  const id = newId();
  await tx.insert(inventoryLocations).values({ id, ...scope, code: "main", name: "Ana depo", priority: 0 });
  return id;
}

export const locationSchema = z.object({
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().trim().min(1).max(120),
  address: z.record(z.string(), z.string().max(200)).optional(),
  isActive: z.boolean().default(true),
  fulfillsOnlineOrders: z.boolean().default(true),
  priority: z.number().int().min(0).max(1000).default(0),
});

export async function listLocations(db: Database, ctx: StoreContext) {
  assertCan(ctx, "inventory:read");
  return withTenantTx(db, scopeOf(ctx), (tx) =>
    tx.select().from(inventoryLocations).where(eq(inventoryLocations.storeId, ctx.storeId)).orderBy(asc(inventoryLocations.priority)),
  );
}

export async function createLocation(db: Database, ctx: StoreContext, input: z.infer<typeof locationSchema>) {
  assertCan(ctx, "inventory:write");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const [row] = await tx.insert(inventoryLocations).values({ id: newId(), ...scopeOf(ctx), ...input }).returning();
    await recordAudit(tx, { action: "inventory.location_created", resourceType: "inventory_location", resourceId: row!.id, after: input });
    return row!;
  });
}

/** Inventory item for a variant, created on first use. */
export async function ensureInventoryItem(tx: Transaction, scope: Scope, variantId: string, sku: string | null): Promise<string> {
  const existing = await tx.query.inventoryItems.findFirst({ where: eq(inventoryItems.variantId, variantId) });
  if (existing) {
    if (existing.sku !== sku) await tx.update(inventoryItems).set({ sku }).where(eq(inventoryItems.id, existing.id));
    return existing.id;
  }
  const id = newId();
  await tx.insert(inventoryItems).values({ id, ...scope, variantId, sku });
  return id;
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

export interface VariantStock {
  variantId: string;
  inventoryItemId: string | null;
  tracked: boolean;
  allowBackorder: boolean;
  onHand: number;
  reserved: number;
  available: number;
  byLocation: LevelSnapshot[];
}

/** Stock per variant, summed over active locations that fulfill online orders. */
export async function getStockForVariants(tx: Transaction, scope: Scope, variantIds: string[]): Promise<Map<string, VariantStock>> {
  const out = new Map<string, VariantStock>();
  if (!variantIds.length) return out;
  const variants = await tx
    .select({ id: productVariants.id, track: productVariants.trackInventory, backorder: productVariants.allowBackorder })
    .from(productVariants)
    .where(and(eq(productVariants.storeId, scope.storeId), inArray(productVariants.id, variantIds)));
  const items = await tx.select().from(inventoryItems).where(and(eq(inventoryItems.storeId, scope.storeId), inArray(inventoryItems.variantId, variantIds)));
  const levels = items.length
    ? await tx
        .select({ level: inventoryLevels, location: inventoryLocations })
        .from(inventoryLevels)
        .innerJoin(inventoryLocations, eq(inventoryLocations.id, inventoryLevels.locationId))
        .where(
          and(
            inArray(inventoryLevels.inventoryItemId, items.map((i) => i.id)),
            eq(inventoryLocations.isActive, true),
            eq(inventoryLocations.fulfillsOnlineOrders, true),
          ),
        )
    : [];
  for (const v of variants) {
    const item = items.find((i) => i.variantId === v.id);
    const byLocation = levels
      .filter((l) => l.level.inventoryItemId === item?.id)
      .map((l) => ({
        inventoryItemId: l.level.inventoryItemId,
        locationId: l.level.locationId,
        onHand: l.level.onHand,
        reserved: l.level.reserved,
        available: l.level.onHand - l.level.reserved,
      }));
    const onHand = byLocation.reduce((s, l) => s + l.onHand, 0);
    const reserved = byLocation.reduce((s, l) => s + l.reserved, 0);
    out.set(v.id, {
      variantId: v.id,
      inventoryItemId: item?.id ?? null,
      tracked: v.track,
      allowBackorder: v.backorder,
      onHand,
      reserved,
      available: onHand - reserved,
      byLocation,
    });
  }
  return out;
}

export async function getInventoryLevels(db: Database, ctx: StoreContext, variantIds: string[]) {
  assertCan(ctx, "inventory:read");
  return withTenantTx(db, scopeOf(ctx), async (tx) => [...(await getStockForVariants(tx, scopeOf(ctx), variantIds)).values()]);
}

export const adjustStockSchema = z
  .object({
    variantId: z.uuid(),
    locationId: z.uuid(),
    delta: z.number().int().min(-1_000_000).max(1_000_000).optional(),
    setOnHand: z.number().int().min(0).max(10_000_000).optional(),
    reason: z.string().trim().min(1).max(200),
    idempotencyKey: z.string().max(100).optional(),
  })
  .refine((v) => (v.delta === undefined) !== (v.setOnHand === undefined), "errors.inventory.delta_or_set");

/** Manual stock correction (or absolute count) recorded as a ledger entry. */
export async function adjustStock(db: Database, ctx: StoreContext, input: z.infer<typeof adjustStockSchema>): Promise<LevelSnapshot> {
  assertCan(ctx, "inventory:write");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const variant = await tx.query.productVariants.findFirst({ where: and(eq(productVariants.id, input.variantId), eq(productVariants.storeId, ctx.storeId)) });
    if (!variant) throw notFound("variant", input.variantId);
    const location = await tx.query.inventoryLocations.findFirst({ where: and(eq(inventoryLocations.id, input.locationId), eq(inventoryLocations.storeId, ctx.storeId)) });
    if (!location) throw notFound("inventory_location", input.locationId);
    const itemId = await ensureInventoryItem(tx, scopeOf(ctx), variant.id, variant.sku);
    await lockLevels(tx, scopeOf(ctx), [{ inventoryItemId: itemId, locationId: location.id }]);
    const [level] = await tx
      .select()
      .from(inventoryLevels)
      .where(and(eq(inventoryLevels.inventoryItemId, itemId), eq(inventoryLevels.locationId, location.id)));
    const delta = input.setOnHand !== undefined ? input.setOnHand - level!.onHand : input.delta!;
    if (level!.onHand + delta < 0) throw invalid("errors.inventory.negative_on_hand");
    const result = await applyLedgerEntry(tx, scopeOf(ctx), {
      inventoryItemId: itemId,
      locationId: location.id,
      type: "manual_adjustment",
      quantity: Math.abs(delta),
      signedDelta: delta,
      reason: input.reason,
      ...(input.idempotencyKey ? { idempotencyKey: `adjust:${input.idempotencyKey}` } : {}),
      // Reducing on-hand below reserved would break existing reservations.
      allowNegativeAvailable: false,
    });
    await recordAudit(tx, {
      action: "inventory.adjusted",
      resourceType: "product_variant",
      resourceId: variant.id,
      before: { onHand: level!.onHand, locationId: location.id },
      after: { onHand: result.onHand, reason: input.reason },
    });
    return result;
  });
}

// ---------------------------------------------------------------------------
// Reservations (checkout)
// ---------------------------------------------------------------------------

export interface ReservationLine {
  variantId: string;
  quantity: number;
}

export interface ReservationResult {
  reservationIds: string[];
  /** Lines that could not be reserved (only when failOnShortage = false). */
  shortages: { variantId: string; requested: number; available: number }[];
}

/**
 * Reserves stock for checkout inside the caller's transaction. Levels are locked in a
 * fixed order, then each line is allocated to locations by priority (splitting across
 * locations when needed). Untracked variants are skipped; backorder variants may go
 * below zero at the primary location.
 */
export async function reserveStock(
  tx: Transaction,
  scope: Scope,
  opts: { lines: ReservationLine[]; cartId?: string; orderId?: string; ttlMinutes: number; failOnShortage?: boolean },
): Promise<ReservationResult> {
  const merged = new Map<string, number>();
  for (const l of opts.lines) merged.set(l.variantId, (merged.get(l.variantId) ?? 0) + l.quantity);
  const stock = await getStockForVariants(tx, scope, [...merged.keys()]);
  const locations = await tx
    .select()
    .from(inventoryLocations)
    .where(and(eq(inventoryLocations.storeId, scope.storeId), eq(inventoryLocations.isActive, true), eq(inventoryLocations.fulfillsOnlineOrders, true)))
    .orderBy(asc(inventoryLocations.priority), asc(inventoryLocations.id));
  if (!locations.length) throw new AppError("precondition_failed", "errors.inventory.no_location");

  const keys: { inventoryItemId: string; locationId: string }[] = [];
  for (const [variantId] of merged) {
    const s = stock.get(variantId);
    if (!s) throw notFound("variant", variantId);
    if (!s.tracked) continue;
    if (!s.inventoryItemId) {
      const v = await tx.query.productVariants.findFirst({ where: eq(productVariants.id, variantId) });
      s.inventoryItemId = await ensureInventoryItem(tx, scope, variantId, v?.sku ?? null);
    }
    for (const loc of locations) keys.push({ inventoryItemId: s.inventoryItemId, locationId: loc.id });
  }
  await lockLevels(tx, scope, keys);

  const expiresAt = new Date(Date.now() + opts.ttlMinutes * 60_000);
  const reservationIds: string[] = [];
  const shortages: ReservationResult["shortages"] = [];

  for (const [variantId, requested] of merged) {
    const s = stock.get(variantId)!;
    if (!s.tracked) continue;
    const levels = await tx
      .select()
      .from(inventoryLevels)
      .where(and(eq(inventoryLevels.inventoryItemId, s.inventoryItemId!), inArray(inventoryLevels.locationId, locations.map((l) => l.id))));
    let remaining = requested;
    const plan: { locationId: string; qty: number }[] = [];
    for (const loc of locations) {
      if (remaining === 0) break;
      const lvl = levels.find((l) => l.locationId === loc.id);
      const avail = lvl ? lvl.onHand - lvl.reserved : 0;
      const take = Math.min(remaining, Math.max(0, avail));
      if (take > 0) {
        plan.push({ locationId: loc.id, qty: take });
        remaining -= take;
      }
    }
    if (remaining > 0) {
      if (s.allowBackorder) {
        const primary = plan[0]?.locationId ?? locations[0]!.id;
        const existing = plan.find((p) => p.locationId === primary);
        if (existing) existing.qty += remaining;
        else plan.push({ locationId: primary, qty: remaining });
        remaining = 0;
      } else {
        const available = requested - remaining;
        if (opts.failOnShortage !== false) {
          throw new AppError("conflict", "errors.inventory.insufficient_stock", { variantId, requested, available });
        }
        shortages.push({ variantId, requested, available });
        continue;
      }
    }
    for (const p of plan) {
      const id = newId();
      await applyLedgerEntry(tx, scope, {
        inventoryItemId: s.inventoryItemId!,
        locationId: p.locationId,
        type: "order_reserved",
        quantity: p.qty,
        referenceType: opts.orderId ? "order" : "cart",
        referenceId: opts.orderId ?? opts.cartId ?? id,
        allowNegativeAvailable: s.allowBackorder,
        idempotencyKey: `reserve:${id}`,
      });
      await tx.insert(stockReservations).values({
        id,
        ...scope,
        inventoryItemId: s.inventoryItemId!,
        locationId: p.locationId,
        quantity: p.qty,
        cartId: opts.cartId ?? null,
        orderId: opts.orderId ?? null,
        expiresAt,
      });
      reservationIds.push(id);
    }
  }
  return { reservationIds, shortages };
}

async function settleReservations(
  tx: Transaction,
  scope: Scope,
  where: { orderId?: string; cartId?: string; reservationIds?: string[] },
  outcome: "released" | "consumed" | "expired",
  reason: string,
): Promise<number> {
  const filters = [eq(stockReservations.storeId, scope.storeId), eq(stockReservations.status, "active")];
  if (where.orderId) filters.push(eq(stockReservations.orderId, where.orderId));
  if (where.cartId) filters.push(eq(stockReservations.cartId, where.cartId));
  if (where.reservationIds) filters.push(inArray(stockReservations.id, where.reservationIds));
  const rows = await tx.select().from(stockReservations).where(and(...filters)).for("update");
  await lockLevels(tx, scope, rows.map((r) => ({ inventoryItemId: r.inventoryItemId, locationId: r.locationId })));
  for (const r of rows) {
    await applyLedgerEntry(tx, scope, {
      inventoryItemId: r.inventoryItemId,
      locationId: r.locationId,
      type: outcome === "consumed" ? "order_confirmed" : "reservation_released",
      quantity: r.quantity,
      referenceType: r.orderId ? "order" : "cart",
      referenceId: r.orderId ?? r.cartId ?? r.id,
      reason,
      idempotencyKey: `settle:${r.id}`,
      allowNegativeAvailable: true,
    });
    await tx.update(stockReservations).set({ status: outcome }).where(eq(stockReservations.id, r.id));
  }
  return rows.length;
}

/** Payment succeeded: reserved stock becomes sold (on_hand and reserved both decrease). */
export function consumeReservations(tx: Transaction, scope: Scope, orderId: string) {
  return settleReservations(tx, scope, { orderId }, "consumed", "order_confirmed");
}

/** Payment failed / order cancelled before fulfilment: stock returns to available. */
export function releaseReservations(tx: Transaction, scope: Scope, where: { orderId?: string; cartId?: string }, reason: string) {
  return settleReservations(tx, scope, where, "released", reason);
}

/** Worker: releases reservations whose checkout window elapsed. */
export async function expireReservations(db: Database, limit = 200): Promise<number> {
  const due = await withPlatformTx(db, (tx) =>
    tx
      .select({ id: stockReservations.id, organizationId: stockReservations.organizationId, storeId: stockReservations.storeId })
      .from(stockReservations)
      .where(and(eq(stockReservations.status, "active"), lte(stockReservations.expiresAt, new Date())))
      .limit(limit),
  );
  let n = 0;
  for (const r of due) {
    n += await withTenantTx(db, { organizationId: r.organizationId, storeId: r.storeId }, (tx) =>
      settleReservations(tx, { organizationId: r.organizationId, storeId: r.storeId }, { reservationIds: [r.id] }, "expired", "reservation_expired"),
    );
  }
  return n;
}

/** Restock after a return is received at a location. */
export async function receiveReturn(tx: Transaction, scope: Scope, input: { variantId: string; locationId: string; quantity: number; returnId: string }) {
  const v = await tx.query.productVariants.findFirst({ where: eq(productVariants.id, input.variantId) });
  if (!v) throw notFound("variant", input.variantId);
  const itemId = await ensureInventoryItem(tx, scope, v.id, v.sku);
  return applyLedgerEntry(tx, scope, {
    inventoryItemId: itemId,
    locationId: input.locationId,
    type: "return_received",
    quantity: input.quantity,
    referenceType: "return",
    referenceId: input.returnId,
    idempotencyKey: `return:${input.returnId}:${input.variantId}:${input.locationId}`,
  });
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

export const createTransferSchema = z.object({
  fromLocationId: z.uuid(),
  toLocationId: z.uuid(),
  note: z.string().max(500).optional(),
  lines: z.array(z.object({ variantId: z.uuid(), quantity: z.number().int().positive() })).min(1).max(500),
});

export async function createTransfer(db: Database, ctx: StoreContext, input: z.infer<typeof createTransferSchema>) {
  assertCan(ctx, "inventory:write");
  if (input.fromLocationId === input.toLocationId) throw invalid("errors.inventory.same_location");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const locs = await tx.select().from(inventoryLocations).where(and(eq(inventoryLocations.storeId, ctx.storeId), inArray(inventoryLocations.id, [input.fromLocationId, input.toLocationId])));
    if (locs.length !== 2) throw notFound("inventory_location");
    const id = newId();
    await tx.insert(stockTransfers).values({ id, ...scopeOf(ctx), fromLocationId: input.fromLocationId, toLocationId: input.toLocationId, note: input.note ?? null });
    for (const line of input.lines) {
      const v = await tx.query.productVariants.findFirst({ where: and(eq(productVariants.id, line.variantId), eq(productVariants.storeId, ctx.storeId)) });
      if (!v) throw notFound("variant", line.variantId);
      const itemId = await ensureInventoryItem(tx, scopeOf(ctx), v.id, v.sku);
      await tx.insert(stockTransferLines).values({ id: newId(), ...scopeOf(ctx), transferId: id, inventoryItemId: itemId, quantity: line.quantity });
    }
    return tx.query.stockTransfers.findFirst({ where: eq(stockTransfers.id, id) });
  });
}

/** Ships a draft transfer: stock leaves the source location (transfer_out). */
export async function shipTransfer(db: Database, ctx: StoreContext, transferId: string) {
  assertCan(ctx, "inventory:write");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const [t] = await tx.select().from(stockTransfers).where(and(eq(stockTransfers.id, transferId), eq(stockTransfers.storeId, ctx.storeId))).for("update");
    if (!t) throw notFound("stock_transfer", transferId);
    if (t.status !== "draft") throw new AppError("precondition_failed", "errors.inventory.transfer_not_draft");
    const lines = await tx.select().from(stockTransferLines).where(eq(stockTransferLines.transferId, t.id));
    await lockLevels(tx, scopeOf(ctx), lines.map((l) => ({ inventoryItemId: l.inventoryItemId, locationId: t.fromLocationId })));
    for (const l of lines) {
      await applyLedgerEntry(tx, scopeOf(ctx), {
        inventoryItemId: l.inventoryItemId,
        locationId: t.fromLocationId,
        type: "transfer_out",
        quantity: l.quantity,
        referenceType: "stock_transfer",
        referenceId: t.id,
        idempotencyKey: `transfer_out:${l.id}`,
      });
    }
    await tx.update(stockTransfers).set({ status: "in_transit", shippedAt: new Date() }).where(eq(stockTransfers.id, t.id));
    return { ...t, status: "in_transit" as const };
  });
}

/** Receives an in-transit transfer (optionally partially): stock arrives (transfer_in). */
export async function receiveTransfer(db: Database, ctx: StoreContext, transferId: string, received?: Record<string, number>) {
  assertCan(ctx, "inventory:write");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const [t] = await tx.select().from(stockTransfers).where(and(eq(stockTransfers.id, transferId), eq(stockTransfers.storeId, ctx.storeId))).for("update");
    if (!t) throw notFound("stock_transfer", transferId);
    if (t.status !== "in_transit") throw new AppError("precondition_failed", "errors.inventory.transfer_not_in_transit");
    const lines = await tx.select().from(stockTransferLines).where(eq(stockTransferLines.transferId, t.id));
    for (const l of lines) {
      const qty = received?.[l.id] ?? l.quantity;
      if (qty < 0 || qty > l.quantity) throw invalid("errors.inventory.invalid_received_quantity", { lineId: l.id });
      if (qty > 0) {
        await applyLedgerEntry(tx, scopeOf(ctx), {
          inventoryItemId: l.inventoryItemId,
          locationId: t.toLocationId,
          type: "transfer_in",
          quantity: qty,
          referenceType: "stock_transfer",
          referenceId: t.id,
          idempotencyKey: `transfer_in:${l.id}`,
        });
      }
      await tx.update(stockTransferLines).set({ receivedQuantity: qty }).where(eq(stockTransferLines.id, l.id));
    }
    await tx.update(stockTransfers).set({ status: "received", receivedAt: new Date() }).where(eq(stockTransfers.id, t.id));
    return { ...t, status: "received" as const };
  });
}

/** Sets absolute on-hand quantity at a location (stock sync, imports) as a manual adjustment. */
export async function setOnHand(
  tx: Transaction,
  scope: Scope,
  input: { variantId: string; locationId: string; quantity: number; reason: string; idempotencyKey?: string },
): Promise<LevelSnapshot | null> {
  const v = await tx.query.productVariants.findFirst({ where: and(eq(productVariants.id, input.variantId), eq(productVariants.storeId, scope.storeId)) });
  if (!v) throw notFound("variant", input.variantId);
  const itemId = await ensureInventoryItem(tx, scope, v.id, v.sku);
  await lockLevels(tx, scope, [{ inventoryItemId: itemId, locationId: input.locationId }]);
  const [level] = await tx
    .select()
    .from(inventoryLevels)
    .where(and(eq(inventoryLevels.inventoryItemId, itemId), eq(inventoryLevels.locationId, input.locationId)));
  const delta = input.quantity - level!.onHand;
  if (delta === 0) return null;
  return applyLedgerEntry(tx, scope, {
    inventoryItemId: itemId,
    locationId: input.locationId,
    type: "manual_adjustment",
    quantity: Math.abs(delta),
    signedDelta: delta,
    reason: input.reason,
    // Stock syncs may set on-hand below current reservations (oversold); orders keep their reservation.
    allowNegativeAvailable: true,
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
  });
}
