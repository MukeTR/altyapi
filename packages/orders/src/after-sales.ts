import { z } from "zod";
import { AppError, invalid, newId, notFound } from "@altyapi/commerce-core";
import {
  and,
  eq,
  fulfillmentLines,
  fulfillments,
  inArray,
  orderLines,
  orders,
  paymentAttempts,
  refunds,
  returnLines,
  returnRequests,
  sql,
  stockReservations,
  withTenantTx,
  type Database,
  type Transaction,
} from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { appendEvent } from "@altyapi/events";
import { applyLedgerEntry, receiveReturn } from "@altyapi/inventory";
import { recordRefund, type AttemptRow } from "@altyapi/payments";
import { assertCan, type StoreContext } from "@altyapi/tenancy";
import { cancelUnpaidOrder, recordOrderHistory, type Scope } from "./orders";
import { assertOrderTransition, canCancel, type OrderStatus } from "./state";
import { trackingUrlFor } from "./shipping";

const scopeOf = (ctx: StoreContext): Scope => ({ organizationId: ctx.organizationId, storeId: ctx.storeId });

/** Executes refunds with the payment provider; implemented where provider adapters are available. */
export interface RefundGateway {
  refund(input: { attempt: AttemptRow; amount: bigint; refundId: string; ip: string }): Promise<{
    ok: boolean;
    providerRefundIds: string[];
    allocations: { transactionId: string; amount: bigint }[];
    errorCode: string | null;
    errorMessage: string | null;
  }>;
}

async function lockOrder(tx: Transaction, storeId: string, orderId: string) {
  const [order] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.storeId, storeId))).for("update");
  if (!order) throw notFound("order", orderId);
  return order;
}

/** Recomputes the fulfillment summary and order status after fulfillment/return changes. */
async function refreshFulfillmentState(tx: Transaction, orderId: string) {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, orderId));
  const ordered = lines.reduce((s, l) => s + l.quantity, 0);
  const fulfilled = lines.reduce((s, l) => s + l.fulfilledQuantity, 0);
  const returned = lines.reduce((s, l) => s + l.returnedQuantity, 0);
  const fulfillmentStatus =
    returned > 0 ? (returned >= ordered ? "returned" : "partially_returned") : fulfilled === 0 ? "unfulfilled" : fulfilled >= ordered ? "fulfilled" : "partially_fulfilled";
  let status = order!.status as OrderStatus;
  if (["confirmed", "processing", "partially_fulfilled"].includes(status)) {
    if (fulfilled >= ordered) status = "fulfilled";
    else if (fulfilled > 0) status = "partially_fulfilled";
  }
  if (returned >= ordered && (status === "fulfilled" || status === "partially_fulfilled")) status = "returned";
  if (status !== order!.status) {
    assertOrderTransition(order!.status as OrderStatus, status);
    await recordOrderHistory(tx, order!, "status", order!.status, status);
  }
  if (fulfillmentStatus !== order!.fulfillmentStatus) await recordOrderHistory(tx, order!, "fulfillment_status", order!.fulfillmentStatus, fulfillmentStatus);
  await tx.update(orders).set({ status, fulfillmentStatus }).where(eq(orders.id, orderId));
  return { order: order!, status, fulfillmentStatus };
}

// ---------------------------------------------------------------------------
// Fulfillment
// ---------------------------------------------------------------------------

export const createFulfillmentSchema = z.object({
  lines: z.array(z.object({ orderLineId: z.uuid(), quantity: z.number().int().positive() })).optional(),
  locationId: z.uuid().nullable().optional(),
  carrierCode: z.string().max(40).nullable().optional(),
  trackingNumber: z.string().trim().max(100).nullable().optional(),
  trackingUrl: z.url().nullable().optional(),
  notifyCustomer: z.boolean().default(true),
});

export async function createFulfillment(db: Database, ctx: StoreContext, orderId: string, input: z.infer<typeof createFulfillmentSchema>) {
  assertCan(ctx, "orders:write");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const order = await lockOrder(tx, ctx.storeId, orderId);
    if (!["confirmed", "processing", "partially_fulfilled"].includes(order.status)) {
      throw new AppError("precondition_failed", "errors.order.not_fulfillable", { status: order.status });
    }
    const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, orderId));
    const requested = input.lines ?? lines.map((l) => ({ orderLineId: l.id, quantity: l.quantity - l.fulfilledQuantity })).filter((l) => l.quantity > 0);
    if (!requested.length) throw invalid("errors.fulfillment.nothing_to_fulfill");
    for (const r of requested) {
      const line = lines.find((l) => l.id === r.orderLineId);
      if (!line) throw notFound("order_line", r.orderLineId);
      if (r.quantity > line.quantity - line.fulfilledQuantity) throw invalid("errors.fulfillment.quantity_exceeds_remaining", { orderLineId: line.id });
    }
    const id = newId();
    const shipped = Boolean(input.trackingNumber);
    const [fulfillment] = await tx
      .insert(fulfillments)
      .values({
        id,
        ...scopeOf(ctx),
        orderId,
        locationId: input.locationId ?? null,
        status: shipped ? "shipped" : "pending",
        carrierCode: input.carrierCode ?? null,
        trackingNumber: input.trackingNumber ?? null,
        trackingUrl: input.trackingUrl ?? trackingUrlFor(input.carrierCode ?? null, input.trackingNumber ?? null),
        notifyCustomer: input.notifyCustomer,
        shippedAt: shipped ? new Date() : null,
      })
      .returning();
    for (const r of requested) {
      await tx.insert(fulfillmentLines).values({ id: newId(), ...scopeOf(ctx), fulfillmentId: id, orderLineId: r.orderLineId, quantity: r.quantity });
      await tx.update(orderLines).set({ fulfilledQuantity: sql`${orderLines.fulfilledQuantity} + ${r.quantity}` }).where(eq(orderLines.id, r.orderLineId));
    }
    const state = await refreshFulfillmentState(tx, orderId);
    if (state.status === "fulfilled" || shipped) {
      await appendEvent(tx, { type: "order.fulfilled", ...scopeOf(ctx), aggregateType: "order", aggregateId: orderId, payload: { orderId, fulfillmentId: id } });
    }
    await recordAudit(tx, { action: "fulfillment.created", resourceType: "fulfillment", resourceId: id, after: { orderId, lines: requested, carrier: input.carrierCode, tracking: input.trackingNumber } });
    return fulfillment!;
  });
}

export const updateTrackingSchema = z.object({
  carrierCode: z.string().max(40).nullable(),
  trackingNumber: z.string().trim().max(100).nullable(),
  trackingUrl: z.url().nullable().optional(),
  status: z.enum(["in_progress", "shipped", "delivered"]).optional(),
});

export async function updateFulfillment(db: Database, ctx: StoreContext, fulfillmentId: string, input: z.infer<typeof updateTrackingSchema>) {
  assertCan(ctx, "orders:write");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const f = await tx.query.fulfillments.findFirst({ where: and(eq(fulfillments.id, fulfillmentId), eq(fulfillments.storeId, ctx.storeId)) });
    if (!f) throw notFound("fulfillment", fulfillmentId);
    if (f.status === "cancelled") throw new AppError("precondition_failed", "errors.fulfillment.cancelled");
    const status = input.status ?? (input.trackingNumber && f.status === "pending" ? "shipped" : f.status);
    const [row] = await tx
      .update(fulfillments)
      .set({
        carrierCode: input.carrierCode,
        trackingNumber: input.trackingNumber,
        trackingUrl: input.trackingUrl ?? trackingUrlFor(input.carrierCode, input.trackingNumber),
        status,
        shippedAt: status === "shipped" && !f.shippedAt ? new Date() : f.shippedAt,
        deliveredAt: status === "delivered" ? new Date() : f.deliveredAt,
      })
      .where(eq(fulfillments.id, fulfillmentId))
      .returning();
    await recordAudit(tx, { action: "fulfillment.updated", resourceType: "fulfillment", resourceId: fulfillmentId, before: { status: f.status, tracking: f.trackingNumber }, after: input });
    return row!;
  });
}

export async function cancelFulfillment(db: Database, ctx: StoreContext, fulfillmentId: string) {
  assertCan(ctx, "orders:write");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const f = await tx.query.fulfillments.findFirst({ where: and(eq(fulfillments.id, fulfillmentId), eq(fulfillments.storeId, ctx.storeId)) });
    if (!f) throw notFound("fulfillment", fulfillmentId);
    if (f.status === "delivered" || f.status === "cancelled") throw new AppError("precondition_failed", "errors.fulfillment.not_cancellable");
    await lockOrder(tx, ctx.storeId, f.orderId);
    const lines = await tx.select().from(fulfillmentLines).where(eq(fulfillmentLines.fulfillmentId, fulfillmentId));
    for (const l of lines) await tx.update(orderLines).set({ fulfilledQuantity: sql`${orderLines.fulfilledQuantity} - ${l.quantity}` }).where(eq(orderLines.id, l.orderLineId));
    await tx.update(fulfillments).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(fulfillments.id, fulfillmentId));
    // Status goes back from (partially_)fulfilled to processing when fulfillment is withdrawn.
    const order = await tx.query.orders.findFirst({ where: eq(orders.id, f.orderId) });
    const all = await tx.select().from(orderLines).where(eq(orderLines.orderId, f.orderId));
    const fulfilledQty = all.reduce((s, l) => s + l.fulfilledQuantity, 0);
    const status = fulfilledQty === 0 ? "processing" : "partially_fulfilled";
    await tx.update(orders).set({ status, fulfillmentStatus: fulfilledQty === 0 ? "unfulfilled" : "partially_fulfilled" }).where(eq(orders.id, f.orderId));
    await recordOrderHistory(tx, order!, "status", order!.status, status, "fulfillment_cancelled");
    await recordAudit(tx, { action: "fulfillment.cancelled", resourceType: "fulfillment", resourceId: fulfillmentId });
  });
}

export async function listFulfillments(db: Database, ctx: StoreContext, orderId: string) {
  assertCan(ctx, "orders:read");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const rows = await tx.select().from(fulfillments).where(and(eq(fulfillments.orderId, orderId), eq(fulfillments.storeId, ctx.storeId)));
    const lines = rows.length ? await tx.select().from(fulfillmentLines).where(inArray(fulfillmentLines.fulfillmentId, rows.map((r) => r.id))) : [];
    return rows.map((r) => ({ ...r, lines: lines.filter((l) => l.fulfillmentId === r.id).map((l) => ({ orderLineId: l.orderLineId, quantity: l.quantity })) }));
  });
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

export const createRefundSchema = z.object({
  lines: z.array(z.object({ orderLineId: z.uuid(), quantity: z.number().int().positive() })).default([]),
  shippingAmount: z.union([z.bigint(), z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v)).default(0n),
  /** Additional goodwill amount not tied to lines. */
  additionalAmount: z.union([z.bigint(), z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v)).default(0n),
  reason: z.string().max(500).optional(),
  returnId: z.uuid().optional(),
  idempotencyKey: z.string().min(8).max(100),
});

/** Amount already refunded per order line (from succeeded refunds). */
async function refundedPerLine(tx: Transaction, orderId: string): Promise<Map<string, { amount: bigint; quantity: number }>> {
  const rows = await tx.select().from(refunds).where(and(eq(refunds.orderId, orderId), eq(refunds.status, "succeeded")));
  const out = new Map<string, { amount: bigint; quantity: number }>();
  for (const r of rows) {
    for (const l of r.lines) {
      const cur = out.get(l.orderLineId) ?? { amount: 0n, quantity: 0 };
      out.set(l.orderLineId, { amount: cur.amount + BigInt(l.amount), quantity: cur.quantity + l.quantity });
    }
  }
  return out;
}

/**
 * Refunds through the merchant's own provider account. The refund row is written first
 * (idempotency key), the provider is called outside the transaction, and the result is
 * recorded afterwards so a crash never loses track of money movement.
 */
export async function createRefund(db: Database, gateway: RefundGateway, ctx: StoreContext, orderId: string, raw: z.input<typeof createRefundSchema>, ip: string) {
  assertCan(ctx, "orders:refund");
  const input = createRefundSchema.parse(raw);
  const scope = scopeOf(ctx);
  const prepared = await withTenantTx(db, scope, async (tx) => {
    const existing = await tx.query.refunds.findFirst({ where: and(eq(refunds.storeId, ctx.storeId), eq(refunds.idempotencyKey, input.idempotencyKey)) });
    if (existing) return { existing };
    const order = await lockOrder(tx, ctx.storeId, orderId);
    if (!["paid", "partially_refunded"].includes(order.paymentStatus)) throw new AppError("precondition_failed", "errors.refund.order_not_paid");
    const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, orderId));
    const already = await refundedPerLine(tx, orderId);
    const allocations: { orderLineId: string; quantity: number; amount: string }[] = [];
    let linesAmount = 0n;
    for (const r of input.lines) {
      const line = lines.find((l) => l.id === r.orderLineId);
      if (!line) throw notFound("order_line", r.orderLineId);
      const done = already.get(line.id) ?? { amount: 0n, quantity: 0 };
      if (r.quantity > line.quantity - done.quantity) throw invalid("errors.refund.quantity_exceeds_remaining", { orderLineId: line.id });
      // Refunding the last units takes exactly what is left, so rounding never leaves cents behind.
      const amount = r.quantity === line.quantity - done.quantity ? line.total - done.amount : (line.total * BigInt(r.quantity)) / BigInt(line.quantity);
      allocations.push({ orderLineId: line.id, quantity: r.quantity, amount: amount.toString() });
      linesAmount += amount;
    }
    const amount = linesAmount + input.shippingAmount + input.additionalAmount;
    if (amount <= 0n) throw invalid("errors.refund.amount_required");
    if (amount > order.total - order.refundedTotal) throw invalid("errors.refund.exceeds_refundable", { refundable: (order.total - order.refundedTotal).toString() });
    if (input.shippingAmount > order.shippingTotal) throw invalid("errors.refund.shipping_exceeds");
    const [attempt] = await tx
      .select()
      .from(paymentAttempts)
      .where(and(eq(paymentAttempts.orderId, orderId), inArray(paymentAttempts.status, ["paid", "partially_refunded"])))
      .limit(1);
    if (!attempt) throw new AppError("precondition_failed", "errors.refund.no_paid_attempt");
    const id = newId();
    await tx.insert(refunds).values({
      id,
      ...scope,
      orderId,
      paymentAttemptId: attempt.id,
      returnId: input.returnId ?? null,
      amount,
      shippingAmount: input.shippingAmount,
      currency: order.currency,
      reason: input.reason ?? null,
      lines: allocations,
      status: "pending",
      idempotencyKey: input.idempotencyKey,
      createdByPrincipalId: ctx.principal.userId,
    });
    return { refundId: id, attempt, amount, allocations };
  });
  if ("existing" in prepared) return prepared.existing!;

  const result = await gateway
    .refund({ attempt: prepared.attempt, amount: prepared.amount, refundId: prepared.refundId, ip })
    .catch((err: Error) => ({ ok: false, providerRefundIds: [], allocations: [], errorCode: "provider_error", errorMessage: err.message }));

  return withTenantTx(db, scope, async (tx) => {
    if (!result.ok) {
      const [failed] = await tx
        .update(refunds)
        .set({ status: "failed", failureReason: `${result.errorCode}: ${result.errorMessage ?? ""}`.slice(0, 500), processedAt: new Date() })
        .where(eq(refunds.id, prepared.refundId))
        .returning();
      await recordAudit(tx, { action: "refund.failed", resourceType: "refund", resourceId: prepared.refundId, metadata: { errorCode: result.errorCode } });
      return failed!;
    }
    const [attempt] = await tx.select().from(paymentAttempts).where(eq(paymentAttempts.id, prepared.attempt.id)).for("update");
    await recordRefund(tx, attempt!, { amount: prepared.amount, providerRefundIds: result.providerRefundIds, allocations: result.allocations });
    const order = await lockOrder(tx, ctx.storeId, orderId);
    const refundedTotal = order.refundedTotal + prepared.amount;
    const paymentStatus = refundedTotal >= order.total ? "refunded" : "partially_refunded";
    await tx.update(orders).set({ refundedTotal, paymentStatus }).where(eq(orders.id, orderId));
    for (const a of prepared.allocations) {
      await tx.update(orderLines).set({ refundedQuantity: sql`${orderLines.refundedQuantity} + ${a.quantity}` }).where(eq(orderLines.id, a.orderLineId));
    }
    const [done] = await tx
      .update(refunds)
      .set({ status: "succeeded", providerRefundId: result.providerRefundIds.join(",").slice(0, 500) || null, processedAt: new Date() })
      .where(eq(refunds.id, prepared.refundId))
      .returning();
    await recordOrderHistory(tx, order, "payment_status", order.paymentStatus, paymentStatus, `refund:${prepared.refundId}`);
    if (input.returnId) await tx.update(returnRequests).set({ status: "refunded" }).where(eq(returnRequests.id, input.returnId));
    await appendEvent(tx, { type: "refund.completed", ...scope, aggregateType: "refund", aggregateId: prepared.refundId, payload: { refundId: prepared.refundId, orderId } });
    await recordAudit(tx, {
      action: "refund.succeeded",
      resourceType: "refund",
      resourceId: prepared.refundId,
      after: { orderId, amount: prepared.amount, lines: prepared.allocations, reason: input.reason },
    });
    return done!;
  });
}

export async function listRefunds(db: Database, ctx: StoreContext, orderId: string) {
  assertCan(ctx, "orders:read");
  return withTenantTx(db, scopeOf(ctx), (tx) => tx.select().from(refunds).where(and(eq(refunds.orderId, orderId), eq(refunds.storeId, ctx.storeId))));
}

// ---------------------------------------------------------------------------
// Cancellation of paid orders
// ---------------------------------------------------------------------------

export const cancelOrderSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  refund: z.boolean().default(true),
  restock: z.boolean().default(true),
});

/**
 * Cancels an order before fulfillment. Paid orders are fully refunded through the provider
 * first; stock that was sold is returned to the locations it was taken from.
 */
export async function cancelOrder(db: Database, gateway: RefundGateway, ctx: StoreContext, orderId: string, input: z.infer<typeof cancelOrderSchema>, ip: string) {
  assertCan(ctx, "orders:write");
  const scope = scopeOf(ctx);
  const order = await withTenantTx(db, scope, (tx) => lockOrder(tx, ctx.storeId, orderId));
  if (!canCancel(order.status as OrderStatus)) throw new AppError("precondition_failed", "errors.order.not_cancellable", { status: order.status });
  if (order.status === "awaiting_payment") {
    await withTenantTx(db, scope, (tx) => cancelUnpaidOrder(tx, scope, orderId, input.reason));
    return { status: "cancelled" as const, refund: null };
  }
  let refund = null;
  if (input.refund && ["paid", "partially_refunded"].includes(order.paymentStatus) && order.total > order.refundedTotal) {
    const lines = await withTenantTx(db, scope, (tx) => tx.select().from(orderLines).where(eq(orderLines.orderId, orderId)));
    const already = await withTenantTx(db, scope, (tx) => refundedPerLine(tx, orderId));
    refund = await createRefund(
      db,
      gateway,
      ctx,
      orderId,
      {
        lines: lines.map((l) => ({ orderLineId: l.id, quantity: l.quantity - (already.get(l.id)?.quantity ?? 0) })).filter((l) => l.quantity > 0),
        shippingAmount: order.shippingTotal,
        reason: input.reason,
        idempotencyKey: `cancel:${orderId}`,
      },
      ip,
    );
    if (refund.status !== "succeeded") throw new AppError("dependency_unavailable", "errors.order.cancel_refund_failed", { refundId: refund.id, reason: refund.failureReason });
  }
  return withTenantTx(db, scope, async (tx) => {
    const current = await lockOrder(tx, ctx.storeId, orderId);
    assertOrderTransition(current.status as OrderStatus, "cancelled");
    if (input.restock) {
      const consumed = await tx.select().from(stockReservations).where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, "consumed")));
      for (const r of consumed) {
        await applyLedgerEntry(tx, scope, {
          inventoryItemId: r.inventoryItemId,
          locationId: r.locationId,
          type: "return_received",
          quantity: r.quantity,
          referenceType: "order_cancel",
          referenceId: orderId,
          idempotencyKey: `cancel-restock:${r.id}`,
        });
      }
    }
    await tx.update(orders).set({ status: "cancelled", cancelledAt: new Date(), cancelReason: input.reason }).where(eq(orders.id, orderId));
    await recordOrderHistory(tx, current, "status", current.status, "cancelled", input.reason);
    await appendEvent(tx, { type: "order.cancelled", ...scope, aggregateType: "order", aggregateId: orderId, payload: { orderId, reason: input.reason } });
    await recordAudit(tx, { action: "order.cancelled", resourceType: "order", resourceId: orderId, after: { reason: input.reason, refunded: refund?.amount ?? null, restock: input.restock } });
    return { status: "cancelled" as const, refund };
  });
}

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

export const createReturnSchema = z.object({
  lines: z.array(z.object({ orderLineId: z.uuid(), quantity: z.number().int().positive(), reason: z.string().max(200).optional(), restock: z.boolean().default(true) })).min(1),
  reason: z.string().max(500).optional(),
  customerNote: z.string().max(2000).optional(),
});

export async function createReturnRequest(db: Database, scope: Scope, orderId: string, input: z.infer<typeof createReturnSchema>, approved: boolean) {
  return withTenantTx(db, scope, async (tx) => {
    const order = await lockOrder(tx, scope.storeId, orderId);
    if (!["fulfilled", "partially_fulfilled"].includes(order.status)) throw new AppError("precondition_failed", "errors.return.order_not_fulfilled");
    const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, orderId));
    const open = await tx
      .select({ orderLineId: returnLines.orderLineId, quantity: returnLines.quantity })
      .from(returnLines)
      .innerJoin(returnRequests, eq(returnRequests.id, returnLines.returnId))
      .where(and(eq(returnRequests.orderId, orderId), inArray(returnRequests.status, ["requested", "approved"])));
    for (const r of input.lines) {
      const line = lines.find((l) => l.id === r.orderLineId);
      if (!line) throw notFound("order_line", r.orderLineId);
      const pending = open.filter((o) => o.orderLineId === line.id).reduce((s, o) => s + o.quantity, 0);
      if (r.quantity > line.fulfilledQuantity - line.returnedQuantity - pending) throw invalid("errors.return.quantity_exceeds", { orderLineId: line.id });
    }
    const id = newId();
    const [ret] = await tx
      .insert(returnRequests)
      .values({ id, ...scope, orderId, status: approved ? "approved" : "requested", reason: input.reason ?? null, customerNote: input.customerNote ?? null })
      .returning();
    for (const r of input.lines) {
      await tx.insert(returnLines).values({ id: newId(), ...scope, returnId: id, orderLineId: r.orderLineId, quantity: r.quantity, reason: r.reason ?? null, restock: r.restock });
    }
    await recordAudit(tx, { ...scope, action: "return.created", resourceType: "return_request", resourceId: id, after: { orderId, lines: input.lines, approved } });
    return ret!;
  });
}

export async function decideReturn(db: Database, ctx: StoreContext, returnId: string, decision: "approved" | "rejected" | "cancelled") {
  assertCan(ctx, "orders:write");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const ret = await tx.query.returnRequests.findFirst({ where: and(eq(returnRequests.id, returnId), eq(returnRequests.storeId, ctx.storeId)) });
    if (!ret) throw notFound("return_request", returnId);
    const allowed = decision === "cancelled" ? ["requested", "approved"] : ["requested"];
    if (!allowed.includes(ret.status)) throw new AppError("precondition_failed", "errors.return.invalid_transition");
    const [row] = await tx.update(returnRequests).set({ status: decision }).where(eq(returnRequests.id, returnId)).returning();
    await recordAudit(tx, { action: `return.${decision}`, resourceType: "return_request", resourceId: returnId });
    return row!;
  });
}

export const receiveReturnSchema = z.object({ restockLocationId: z.uuid() });

/** Goods arrived back: restock (per line setting) and update returned quantities. */
export async function receiveReturnedGoods(db: Database, ctx: StoreContext, returnId: string, input: z.infer<typeof receiveReturnSchema>) {
  assertCan(ctx, "orders:write");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const ret = await tx.query.returnRequests.findFirst({ where: and(eq(returnRequests.id, returnId), eq(returnRequests.storeId, ctx.storeId)) });
    if (!ret) throw notFound("return_request", returnId);
    if (ret.status !== "approved") throw new AppError("precondition_failed", "errors.return.not_approved");
    await lockOrder(tx, ctx.storeId, ret.orderId);
    const lines = await tx.select().from(returnLines).where(eq(returnLines.returnId, returnId));
    for (const l of lines) {
      const ol = await tx.query.orderLines.findFirst({ where: eq(orderLines.id, l.orderLineId) });
      if (l.restock && ol?.variantId) {
        await receiveReturn(tx, scopeOf(ctx), { variantId: ol.variantId, locationId: input.restockLocationId, quantity: l.quantity, returnId: `${returnId}:${l.id}` });
      }
      await tx.update(orderLines).set({ returnedQuantity: sql`${orderLines.returnedQuantity} + ${l.quantity}` }).where(eq(orderLines.id, l.orderLineId));
    }
    const [row] = await tx
      .update(returnRequests)
      .set({ status: "received", receivedAt: new Date(), restockLocationId: input.restockLocationId })
      .where(eq(returnRequests.id, returnId))
      .returning();
    await refreshFulfillmentState(tx, ret.orderId);
    await recordAudit(tx, { action: "return.received", resourceType: "return_request", resourceId: returnId, after: input });
    return row!;
  });
}

export async function listReturns(db: Database, ctx: StoreContext, orderId: string) {
  assertCan(ctx, "orders:read");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const rows = await tx.select().from(returnRequests).where(and(eq(returnRequests.orderId, orderId), eq(returnRequests.storeId, ctx.storeId)));
    const lines = rows.length ? await tx.select().from(returnLines).where(inArray(returnLines.returnId, rows.map((r) => r.id))) : [];
    return rows.map((r) => ({ ...r, lines: lines.filter((l) => l.returnId === r.id) }));
  });
}
