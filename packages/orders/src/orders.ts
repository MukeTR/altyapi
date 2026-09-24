import { z } from "zod";
import { decodeCursor, encodeCursor, newId, notFound } from "@altyapi/commerce-core";
import {
  and,
  asc,
  carts,
  customers,
  desc,
  eq,
  ilike,
  inArray,
  lt,
  or,
  orderAddresses,
  orderAdjustments,
  orderLines,
  orderNumberSequences,
  orders,
  orderStatusHistory,
  paymentAttempts,
  sql,
  withTenantTx,
  type AttributionSnapshot,
  type Database,
  type PostalAddress,
  type Transaction,
} from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { appendEvent } from "@altyapi/events";
import { consumeReservations, releaseReservations } from "@altyapi/inventory";
import { currentContext } from "@altyapi/observability";
import { assertCan, type StoreContext } from "@altyapi/tenancy";
import { generateToken, sha256 } from "@altyapi/auth";
import { assertOrderTransition, type OrderStatus } from "./state";

export type Scope = { organizationId: string; storeId: string };
export type OrderRow = typeof orders.$inferSelect;
export type OrderLineRow = typeof orderLines.$inferSelect;

export interface OrderDraftLine {
  productId: string;
  variantId: string;
  sku: string | null;
  title: string;
  variantTitle: string | null;
  imageObjectKey: string | null;
  quantity: number;
  unitPrice: bigint;
  compareAtUnitPrice: bigint | null;
  unitCost: bigint | null;
  discountAmount: bigint;
  /** null when the tax class was not resolved; never replaced by a guessed 0. */
  taxRateBps: number | null;
  taxAmount: bigint;
  taxIncluded: boolean;
  total: bigint;
  requiresShipping: boolean;
  properties: Record<string, string>;
}

export interface OrderDraft {
  cartId: string | null;
  customerId: string | null;
  email: string | null;
  phone: string | null;
  currency: string;
  locale: string;
  channelId: string | null;
  note: string | null;
  lines: OrderDraftLine[];
  adjustments: { lineIndex: number | null; type: string; campaignId: string | null; code: string | null; amount: bigint; description: string }[];
  totals: { subtotal: bigint; discountTotal: bigint; shippingTotal: bigint; taxTotal: bigint; total: bigint };
  shippingAddress: PostalAddress | null;
  billingAddress: PostalAddress | null;
  shippingMethod: { rateId: string; name: string; carrierCode: string | null; amount: bigint } | null;
  attribution: AttributionSnapshot;
  couponCodes: string[];
  source: string;
}

/** Allocates the next display number under a row lock (gap-free per store). */
export async function nextOrderNumber(tx: Transaction, scope: Scope): Promise<string> {
  await tx.insert(orderNumberSequences).values({ storeId: scope.storeId, organizationId: scope.organizationId }).onConflictDoNothing();
  const [seq] = await tx
    .update(orderNumberSequences)
    .set({ nextValue: sql`${orderNumberSequences.nextValue} + 1` })
    .where(eq(orderNumberSequences.storeId, scope.storeId))
    .returning({ value: sql<number>`${orderNumberSequences.nextValue} - 1`, prefix: orderNumberSequences.prefix });
  return `${seq!.prefix}${seq!.value}`;
}

async function history(tx: Transaction, order: { id: string; organizationId: string; storeId: string }, field: string, from: string | null, to: string, reason?: string | null) {
  const ctx = currentContext();
  await tx.insert(orderStatusHistory).values({
    id: newId(),
    organizationId: order.organizationId,
    storeId: order.storeId,
    orderId: order.id,
    field,
    fromValue: from,
    toValue: to,
    reason: reason ?? null,
    principalType: ctx?.principalType ?? "system",
    principalId: ctx?.principalId && /^[0-9a-f-]{36}$/.test(ctx.principalId) ? ctx.principalId : null,
  });
}

/**
 * Creates an order awaiting payment from a checkout snapshot. Returns the order and a
 * one-time access token for the customer-facing status page (only its hash is stored).
 */
export async function createOrder(tx: Transaction, scope: Scope, draft: OrderDraft): Promise<{ order: OrderRow; accessToken: string }> {
  const id = newId();
  const number = await nextOrderNumber(tx, scope);
  const accessToken = generateToken(24);
  const [order] = await tx
    .insert(orders)
    .values({
      id,
      ...scope,
      number,
      cartId: draft.cartId,
      customerId: draft.customerId,
      email: draft.email,
      phone: draft.phone,
      status: "awaiting_payment",
      paymentStatus: "pending",
      currency: draft.currency,
      ...draft.totals,
      locale: draft.locale,
      channelId: draft.channelId,
      note: draft.note,
      attribution: draft.attribution,
      couponCodes: draft.couponCodes,
      shippingMethod: draft.shippingMethod ? { ...draft.shippingMethod, amount: draft.shippingMethod.amount.toString() } : null,
      source: draft.source,
      placedAt: new Date(),
      accessTokenHash: sha256(accessToken),
    })
    .returning();
  const lineIds: string[] = [];
  for (const l of draft.lines) {
    const lineId = newId();
    lineIds.push(lineId);
    await tx.insert(orderLines).values({ id: lineId, ...scope, orderId: id, ...l });
  }
  for (const a of draft.adjustments) {
    await tx.insert(orderAdjustments).values({
      id: newId(),
      ...scope,
      orderId: id,
      orderLineId: a.lineIndex !== null ? lineIds[a.lineIndex] ?? null : null,
      type: a.type,
      campaignId: a.campaignId,
      code: a.code,
      amount: a.amount,
      description: a.description,
    });
  }
  if (draft.shippingAddress) await tx.insert(orderAddresses).values({ orderId: id, ...scope, type: "shipping", address: draft.shippingAddress });
  if (draft.billingAddress) await tx.insert(orderAddresses).values({ orderId: id, ...scope, type: "billing", address: draft.billingAddress });
  await history(tx, order!, "status", null, "awaiting_payment", "checkout");
  await appendEvent(tx, { type: "order.created", ...scope, aggregateType: "order", aggregateId: id, payload: { orderId: id, orderNumber: number } });
  await appendEvent(tx, {
    type: "checkout.started",
    ...scope,
    aggregateType: "cart",
    aggregateId: draft.cartId ?? id,
    payload: { cartId: draft.cartId ?? "", orderId: id },
  });
  return { order: order!, accessToken };
}

/**
 * Verified payment received: confirms the order, turns reservations into sold stock, closes
 * the cart and updates customer statistics. Idempotent for repeated notifications.
 */
export async function confirmOrderPayment(tx: Transaction, scope: Scope, orderId: string, attemptId: string): Promise<{ confirmed: boolean; paidAfterCancel: boolean }> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!order) throw notFound("order", orderId);
  if (order.paymentStatus === "paid" || order.paymentStatus === "partially_refunded" || order.paymentStatus === "refunded") {
    return { confirmed: false, paidAfterCancel: false };
  }
  if (order.status === "cancelled") {
    // Money arrived for an order that already expired: keep it cancelled and flag for a refund.
    await tx
      .update(orders)
      .set({ paymentStatus: "paid", tags: sql`array_append(${orders.tags}, 'payment_after_cancel')` })
      .where(eq(orders.id, orderId));
    await history(tx, order, "payment_status", order.paymentStatus, "paid", "payment_after_cancel");
    await recordAudit(tx, { ...scope, action: "order.payment_after_cancel", resourceType: "order", resourceId: orderId, metadata: { attemptId } });
    return { confirmed: false, paidAfterCancel: true };
  }
  assertOrderTransition(order.status as OrderStatus, "confirmed");
  await tx.update(orders).set({ status: "confirmed", paymentStatus: "paid", confirmedAt: new Date() }).where(eq(orders.id, orderId));
  await history(tx, order, "status", order.status, "confirmed", "payment_verified");
  await history(tx, order, "payment_status", order.paymentStatus, "paid", attemptId);
  await consumeReservations(tx, scope, orderId);
  if (order.cartId) await tx.update(carts).set({ status: "completed", completedOrderId: orderId }).where(eq(carts.id, order.cartId));
  if (order.customerId) {
    await tx
      .update(customers)
      .set({
        ordersCount: sql`${customers.ordersCount} + 1`,
        totalSpentMinor: sql`${customers.totalSpentMinor} + ${order.total}`,
        totalSpentCurrency: order.currency,
        firstOrderAt: sql`coalesce(${customers.firstOrderAt}, now())`,
        lastOrderAt: new Date(),
      })
      .where(eq(customers.id, order.customerId));
  }
  await appendEvent(tx, { type: "order.confirmed", ...scope, aggregateType: "order", aggregateId: orderId, payload: { orderId, orderNumber: order.number } });
  return { confirmed: true, paidAfterCancel: false };
}

export async function markOrderPaymentFailed(tx: Transaction, orderId: string, reason: string | null) {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!order || order.paymentStatus === "paid") return;
  // The order stays awaiting_payment so the shopper can retry until the reservation expires.
  await tx.update(orders).set({ paymentStatus: "failed" }).where(eq(orders.id, orderId));
  await history(tx, order, "payment_status", order.paymentStatus, "failed", reason);
}

/** Cancels an unpaid order (checkout abandoned, expiry, merchant) and releases its stock. */
export async function cancelUnpaidOrder(tx: Transaction, scope: Scope, orderId: string, reason: string): Promise<boolean> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!order || order.status !== "awaiting_payment") return false;
  await tx.update(orders).set({ status: "cancelled", cancelledAt: new Date(), cancelReason: reason, paymentStatus: order.paymentStatus === "failed" ? "failed" : "voided" }).where(eq(orders.id, orderId));
  await tx
    .update(paymentAttempts)
    .set({ status: "cancelled" })
    .where(and(eq(paymentAttempts.orderId, orderId), inArray(paymentAttempts.status, ["created", "session_created", "pending", "requires_action"])));
  await releaseReservations(tx, scope, { orderId }, reason);
  if (order.cartId) await tx.update(carts).set({ status: "active" }).where(and(eq(carts.id, order.cartId), eq(carts.status, "checking_out")));
  await history(tx, order, "status", order.status, "cancelled", reason);
  await appendEvent(tx, { type: "order.cancelled", ...scope, aggregateType: "order", aggregateId: orderId, payload: { orderId, reason } });
  return true;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const listOrdersQuerySchema = z.object({
  q: z.string().max(100).optional(),
  status: z.enum(["draft", "awaiting_payment", "confirmed", "processing", "partially_fulfilled", "fulfilled", "cancelled", "returned"]).optional(),
  paymentStatus: z.enum(["unpaid", "pending", "paid", "partially_refunded", "refunded", "failed", "voided"]).optional(),
  customerId: z.uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export async function listOrders(db: Database, ctx: StoreContext, q: z.infer<typeof listOrdersQuerySchema>) {
  assertCan(ctx, "orders:read");
  return withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, async (tx) => {
    const filters = [eq(orders.storeId, ctx.storeId)];
    if (q.status) filters.push(eq(orders.status, q.status));
    if (q.paymentStatus) filters.push(eq(orders.paymentStatus, q.paymentStatus));
    if (q.customerId) filters.push(eq(orders.customerId, q.customerId));
    if (q.from) filters.push(sql`${orders.createdAt} >= ${q.from.toISOString()}::timestamptz`);
    if (q.to) filters.push(sql`${orders.createdAt} < ${q.to.toISOString()}::timestamptz`);
    if (q.q) {
      const term = q.q.trim().replace(/^#/, "");
      filters.push(or(eq(orders.number, term), ilike(orders.email, `%${term.replace(/[%_\\]/g, "\\$&")}%`), ilike(orders.phone, `%${term.replace(/[%_\\]/g, "\\$&")}%`))!);
    }
    if (q.cursor) {
      const [ts, id] = decodeCursor(q.cursor) as [string, string];
      const at = new Date(ts);
      filters.push(or(lt(orders.createdAt, at), and(eq(orders.createdAt, at), lt(orders.id, id)))!);
    }
    const rows = await tx.select().from(orders).where(and(...filters)).orderBy(desc(orders.createdAt), desc(orders.id)).limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const counts = page.length
      ? await tx
          .select({ orderId: orderLines.orderId, items: sql<number>`sum(${orderLines.quantity})::int` })
          .from(orderLines)
          .where(inArray(orderLines.orderId, page.map((o) => o.id)))
          .groupBy(orderLines.orderId)
      : [];
    const last = page.at(-1);
    return {
      items: page.map((o) => ({
        id: o.id,
        number: o.number,
        email: o.email,
        status: o.status,
        paymentStatus: o.paymentStatus,
        fulfillmentStatus: o.fulfillmentStatus,
        currency: o.currency,
        total: o.total,
        itemCount: counts.find((c) => c.orderId === o.id)?.items ?? 0,
        tags: o.tags,
        createdAt: o.createdAt,
      })),
      nextCursor: rows.length > q.limit && last ? encodeCursor([last.createdAt.toISOString(), last.id]) : null,
    };
  });
}

export async function loadOrderAggregate(tx: Transaction, storeId: string, orderId: string) {
  const order = await tx.query.orders.findFirst({ where: and(eq(orders.id, orderId), eq(orders.storeId, storeId)) });
  if (!order) throw notFound("order", orderId);
  const [lines, addresses, adjustments, historyRows, attempts] = await Promise.all([
    tx.select().from(orderLines).where(eq(orderLines.orderId, orderId)),
    tx.select().from(orderAddresses).where(eq(orderAddresses.orderId, orderId)),
    tx.select().from(orderAdjustments).where(eq(orderAdjustments.orderId, orderId)),
    tx.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, orderId)).orderBy(asc(orderStatusHistory.createdAt)),
    tx.select().from(paymentAttempts).where(eq(paymentAttempts.orderId, orderId)).orderBy(asc(paymentAttempts.createdAt)),
  ]);
  return {
    order,
    lines,
    shippingAddress: addresses.find((a) => a.type === "shipping")?.address ?? null,
    billingAddress: addresses.find((a) => a.type === "billing")?.address ?? null,
    adjustments,
    history: historyRows,
    payments: attempts.map((a) => ({
      id: a.id,
      provider: a.provider,
      mode: a.mode,
      status: a.status,
      amount: a.amount,
      refundedAmount: a.refundedAmount,
      currency: a.currency,
      failureCode: a.failureCode,
      failureMessage: a.failureMessage,
      paidAt: a.paidAt,
      createdAt: a.createdAt,
    })),
  };
}

export async function getOrder(db: Database, ctx: StoreContext, orderId: string) {
  assertCan(ctx, "orders:read");
  return withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, (tx) => loadOrderAggregate(tx, ctx.storeId, orderId));
}

/** Order status page for shoppers, authorized by the access token issued at checkout. */
export async function getOrderByAccessToken(db: Database, scope: Scope, orderId: string, token: string) {
  return withTenantTx(db, scope, async (tx) => {
    const order = await tx.query.orders.findFirst({ where: and(eq(orders.id, orderId), eq(orders.storeId, scope.storeId)) });
    if (!order || !order.accessTokenHash || order.accessTokenHash !== sha256(token)) throw notFound("order", orderId);
    return loadOrderAggregate(tx, scope.storeId, orderId);
  });
}

export const updateOrderSchema = z.object({
  note: z.string().max(5000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  email: z.email().optional(),
  phone: z.string().max(32).nullable().optional(),
});

export async function updateOrder(db: Database, ctx: StoreContext, orderId: string, input: z.infer<typeof updateOrderSchema>) {
  assertCan(ctx, "orders:write");
  return withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, async (tx) => {
    const before = await tx.query.orders.findFirst({ where: and(eq(orders.id, orderId), eq(orders.storeId, ctx.storeId)) });
    if (!before) throw notFound("order", orderId);
    const [row] = await tx
      .update(orders)
      .set({
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.tags ? { tags: input.tags } : {}),
        ...(input.email ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
      })
      .where(eq(orders.id, orderId))
      .returning();
    await recordAudit(tx, { action: "order.updated", resourceType: "order", resourceId: orderId, before: { note: before.note, tags: before.tags }, after: input });
    return row!;
  });
}

export async function markProcessing(db: Database, ctx: StoreContext, orderId: string) {
  assertCan(ctx, "orders:write");
  return withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, async (tx) => {
    const [order] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.storeId, ctx.storeId))).for("update");
    if (!order) throw notFound("order", orderId);
    assertOrderTransition(order.status as OrderStatus, "processing");
    await tx.update(orders).set({ status: "processing" }).where(eq(orders.id, orderId));
    await history(tx, order, "status", order.status, "processing");
    return { ...order, status: "processing" as const };
  });
}

export { history as recordOrderHistory };
