import { AppError, newId } from "@altyapi/commerce-core";
import {
  and,
  eq,
  inventoryItems,
  inventoryLedgerEntries,
  inventoryLevels,
  sql,
  type Transaction,
} from "@altyapi/database";
import { appendEvent } from "@altyapi/events";
import { currentContext } from "@altyapi/observability";

export type LedgerEntryType =
  | "initial_stock"
  | "manual_adjustment"
  | "order_reserved"
  | "reservation_released"
  | "order_confirmed"
  | "return_received"
  | "transfer_in"
  | "transfer_out";

export interface Scope {
  organizationId: string;
  storeId: string;
}

export interface LedgerInput {
  inventoryItemId: string;
  locationId: string;
  type: LedgerEntryType;
  /** Always positive; the entry type decides the direction. manual_adjustment uses signedDelta. */
  quantity: number;
  signedDelta?: number;
  referenceType?: string;
  referenceId?: string;
  reason?: string;
  idempotencyKey?: string;
  /** Permit available to go negative (backorders). */
  allowNegativeAvailable?: boolean;
}

export interface LevelSnapshot {
  inventoryItemId: string;
  locationId: string;
  onHand: number;
  reserved: number;
  available: number;
}

function deltas(input: LedgerInput): { onHand: number; reserved: number } {
  const q = input.quantity;
  switch (input.type) {
    case "initial_stock":
      return { onHand: q, reserved: 0 };
    case "manual_adjustment":
      return { onHand: input.signedDelta ?? 0, reserved: 0 };
    case "order_reserved":
      return { onHand: 0, reserved: q };
    case "reservation_released":
      return { onHand: 0, reserved: -q };
    case "order_confirmed":
      return { onHand: -q, reserved: -q };
    case "return_received":
    case "transfer_in":
      return { onHand: q, reserved: 0 };
    case "transfer_out":
      return { onHand: -q, reserved: 0 };
  }
}

/**
 * Locks the level rows in a deterministic order (item, location) so concurrent
 * multi-line operations cannot deadlock. Missing rows are created first.
 */
export async function lockLevels(tx: Transaction, scope: Scope, keys: { inventoryItemId: string; locationId: string }[]) {
  const sorted = [...new Map(keys.map((k) => [`${k.inventoryItemId}:${k.locationId}`, k])).values()].sort((a, b) =>
    a.inventoryItemId === b.inventoryItemId ? a.locationId.localeCompare(b.locationId) : a.inventoryItemId.localeCompare(b.inventoryItemId),
  );
  for (const k of sorted) {
    await tx
      .insert(inventoryLevels)
      .values({ ...k, storeId: scope.storeId, organizationId: scope.organizationId })
      .onConflictDoNothing();
    await tx
      .select({ v: inventoryLevels.version })
      .from(inventoryLevels)
      .where(and(eq(inventoryLevels.inventoryItemId, k.inventoryItemId), eq(inventoryLevels.locationId, k.locationId)))
      .for("update");
  }
}

/**
 * Appends one ledger entry and updates the level projection atomically. Caller must hold
 * the row lock (lockLevels) when combining several entries in one transaction.
 * Idempotency keys make retried operations (e.g. redelivered payment events) no-ops.
 */
export async function applyLedgerEntry(tx: Transaction, scope: Scope, input: LedgerInput): Promise<LevelSnapshot> {
  if (!Number.isInteger(input.quantity) || input.quantity < 0) throw new AppError("validation_failed", "errors.inventory.invalid_quantity");

  if (input.idempotencyKey) {
    const seen = await tx.query.inventoryLedgerEntries.findFirst({
      where: and(eq(inventoryLedgerEntries.storeId, scope.storeId), eq(inventoryLedgerEntries.idempotencyKey, input.idempotencyKey)),
    });
    if (seen) return { inventoryItemId: seen.inventoryItemId, locationId: seen.locationId, onHand: seen.onHandAfter, reserved: seen.reservedAfter, available: seen.onHandAfter - seen.reservedAfter };
  }

  await lockLevels(tx, scope, [{ inventoryItemId: input.inventoryItemId, locationId: input.locationId }]);
  const [level] = await tx
    .select()
    .from(inventoryLevels)
    .where(and(eq(inventoryLevels.inventoryItemId, input.inventoryItemId), eq(inventoryLevels.locationId, input.locationId)));
  const d = deltas(input);
  const onHand = level!.onHand + d.onHand;
  const reserved = level!.reserved + d.reserved;

  if (reserved < 0) throw new AppError("conflict", "errors.inventory.reservation_underflow");
  const available = onHand - reserved;
  const reducesAvailability = d.reserved > 0 || d.onHand < 0;
  if (reducesAvailability && available < 0 && !input.allowNegativeAvailable && input.type !== "order_confirmed") {
    throw new AppError("conflict", "errors.inventory.insufficient_stock", {
      inventoryItemId: input.inventoryItemId,
      locationId: input.locationId,
      available: level!.onHand - level!.reserved,
    });
  }

  await tx
    .update(inventoryLevels)
    .set({ onHand, reserved, version: sql`${inventoryLevels.version} + 1`, updatedAt: new Date() })
    .where(and(eq(inventoryLevels.inventoryItemId, input.inventoryItemId), eq(inventoryLevels.locationId, input.locationId)));

  const ctx = currentContext();
  await tx.insert(inventoryLedgerEntries).values({
    id: newId(),
    organizationId: scope.organizationId,
    storeId: scope.storeId,
    inventoryItemId: input.inventoryItemId,
    locationId: input.locationId,
    type: input.type,
    onHandDelta: d.onHand,
    reservedDelta: d.reserved,
    onHandAfter: onHand,
    reservedAfter: reserved,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    reason: input.reason ?? null,
    principalType: ctx?.principalType ?? "system",
    principalId: ctx?.principalId && /^[0-9a-f-]{36}$/.test(ctx.principalId) ? ctx.principalId : null,
    idempotencyKey: input.idempotencyKey ?? null,
  });

  const item = await tx.query.inventoryItems.findFirst({ where: eq(inventoryItems.id, input.inventoryItemId) });
  await appendEvent(tx, {
    type: "inventory.changed",
    organizationId: scope.organizationId,
    storeId: scope.storeId,
    aggregateType: "inventory_item",
    aggregateId: input.inventoryItemId,
    payload: { inventoryItemId: input.inventoryItemId, locationId: input.locationId, variantId: item?.variantId ?? "", available },
  });
  return { inventoryItemId: input.inventoryItemId, locationId: input.locationId, onHand, reserved, available };
}
