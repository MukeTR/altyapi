import {
  and,
  asc,
  eq,
  inArray,
  desc,
  orderAddresses,
  orderAdjustments,
  orderLines,
  orders,
  paymentAttempts,
  paymentEvents,
  paymentTransactions,
  productVariants,
  refunds,
  fulfillments,
  sql,
  variantCosts,
  withTenantTx,
  type Transaction,
} from "@altyapi/database";
import { sanitizeAttribution, sanitizeSharedValue, type SanitizedAttribution } from "../../attribution";
import { EkosistemError } from "../../errors";
import { toMinorString } from "../../money";
import type { CostObject } from "../../schemas";
import type { EkosistemServerDeps, LinkRow } from "../common";
import { assembleIncremental } from "./catalog";
import { isUuidRef, pageKeys, parseIncrementalQuery, transactionNow, type IncrementalPage } from "./incremental";

/**
 * GET /ekosistem/v1/orders (§7.3): storefront orders only (marketplace orders are read by
 * Kârmatik from the marketplaces, so nothing is counted twice), and only orders that got
 * past payment (drafts and orders awaiting payment are excluded). No personal data: at
 * most the province, and attribution sanitized per §7.3. Cost fields need costs:read.
 */

export interface OrderLineItem {
  ref: string;
  productRef: string | null;
  variantRef: string | null;
  sku: string | null;
  barcode: string | null;
  title: string;
  quantity: number;
  unitPrice: string;
  discount: string;
  taxRateBps: number | null;
  taxAmount: string;
  taxIncluded: boolean;
  total: string;
  unitCost: CostObject | null;
  refundedQuantity: number;
  returnedQuantity: number;
}

export interface OrderItem {
  ref: string;
  number: string;
  channel: "storefront";
  status: "confirmed" | "processing" | "partially_fulfilled" | "fulfilled" | "cancelled" | "returned";
  paymentStatus: string;
  placedAt: string | null;
  updatedAt: string;
  currency: string;
  city: string | null;
  totals: { subtotal: string; discount: string; shipping: string; tax: string; total: string; refunded: string; cost: string | null };
  lines: OrderLineItem[];
  discounts: Array<{ type: "discount" | "shipping_discount"; code: string | null; campaignRef: string | null; amount: string }>;
  refunds: Array<{ ref: string; amount: string; createdAt: string; lines: Array<{ lineRef: string; quantity: number; amount: string }> }>;
  shipping: { charged: string; cost: string | null; method: string | null; carrier: string | null };
  payment: { provider: string; method: PaymentMethod; installments: number | null; fee: string | null } | null;
  attribution: SanitizedAttribution;
}

/** Orders that count: storefront source, confirmed at some point (paid), never drafts or awaiting payment. */
function orderFilter(storeId: string) {
  return sql`o.store_id = ${storeId} and o.source = 'storefront' and o.confirmed_at is not null and o.status not in ('draft', 'awaiting_payment')`;
}

function fullSetSource(storeId: string) {
  return sql`select o.id::text as ref, false as deleted, o.updated_at as eff from orders o where ${orderFilter(storeId)}`;
}

function sinceSource(storeId: string) {
  return sql`
    select o.id::text as ref, false as deleted, o.updated_at as eff from orders o where ${orderFilter(storeId)}
    union all
    select t.ref, true as deleted, t.deleted_at as eff from ekosistem_tombstones t where t.store_id = ${storeId} and t.resource = 'order'`;
}

function costSource(source: string): CostObject["source"] {
  if (source === "manual" || source === "import" || source === "karmatik") return source;
  if (source.startsWith("integration")) return "integration";
  return "store";
}

/** PayTR reports the payment type ("card" / "eft") and installment count; iyzico's checkout form is card only. */
type PaymentMethod = "card" | "transfer" | "cod" | null;

function paymentDetails(provider: string, evidence: Record<string, unknown> | null): { method: PaymentMethod; installments: number | null } {
  if (provider === "iyzico") return { method: "card", installments: null };
  const type = typeof evidence?.payment_type === "string" ? evidence.payment_type : "";
  const count = typeof evidence?.installment_count === "string" && /^\d{1,2}$/.test(evidence.installment_count) ? Number(evidence.installment_count) : null;
  const method: PaymentMethod = type === "card" ? "card" : type === "eft" ? "transfer" : null;
  // PayTR sends installment_count 0 for single payments.
  return { method, installments: count === null ? null : Math.max(1, count) };
}

function provinceOf(address: { province?: string | null; city?: string | null } | null): string | null {
  const value = (address?.province ?? address?.city ?? "").trim();
  return value ? value.slice(0, 100) : null;
}

async function buildOrders(tx: Transaction, storeId: string, ids: string[], withCosts: boolean): Promise<Map<string, OrderItem>> {
  const out = new Map<string, OrderItem>();
  if (!ids.length) return out;
  const [rows, lines, addresses, adjustments, refundRows, attempts, fulfillmentRows] = await Promise.all([
    tx.select().from(orders).where(and(eq(orders.storeId, storeId), inArray(orders.id, ids))),
    tx.select().from(orderLines).where(inArray(orderLines.orderId, ids)).orderBy(asc(orderLines.id)),
    tx.select().from(orderAddresses).where(and(inArray(orderAddresses.orderId, ids), eq(orderAddresses.type, "shipping"))),
    tx.select().from(orderAdjustments).where(inArray(orderAdjustments.orderId, ids)),
    tx.select().from(refunds).where(and(inArray(refunds.orderId, ids), eq(refunds.status, "succeeded"))).orderBy(asc(refunds.createdAt)),
    tx
      .select()
      .from(paymentAttempts)
      .where(and(inArray(paymentAttempts.orderId, ids), inArray(paymentAttempts.status, ["paid", "partially_refunded", "refunded"])))
      .orderBy(desc(paymentAttempts.createdAt)),
    tx.select({ orderId: fulfillments.orderId, carrierCode: fulfillments.carrierCode }).from(fulfillments).where(inArray(fulfillments.orderId, ids)).orderBy(asc(fulfillments.createdAt)),
  ]);
  const attemptIds = attempts.map((a) => a.id);
  const variantIds = [...new Set(lines.map((l) => l.variantId).filter((v): v is string => !!v))];
  const [sales, events, variantRows, costRows] = await Promise.all([
    attemptIds.length
      ? tx.select().from(paymentTransactions).where(and(inArray(paymentTransactions.paymentAttemptId, attemptIds), eq(paymentTransactions.type, "sale"), eq(paymentTransactions.status, "succeeded")))
      : Promise.resolve([] as (typeof paymentTransactions.$inferSelect)[]),
    attemptIds.length
      ? tx
          .select({ attemptId: paymentEvents.paymentAttemptId, payload: paymentEvents.payload, receivedAt: paymentEvents.receivedAt })
          .from(paymentEvents)
          .where(and(inArray(paymentEvents.paymentAttemptId, attemptIds), eq(paymentEvents.verified, "yes")))
          .orderBy(desc(paymentEvents.receivedAt))
      : Promise.resolve([] as { attemptId: string | null; payload: Record<string, unknown>; receivedAt: Date }[]),
    variantIds.length ? tx.select({ id: productVariants.id, barcode: productVariants.barcode }).from(productVariants).where(inArray(productVariants.id, variantIds)) : Promise.resolve([]),
    withCosts && variantIds.length
      ? tx.select().from(variantCosts).where(and(eq(variantCosts.storeId, storeId), inArray(variantCosts.variantId, variantIds))).orderBy(desc(variantCosts.effectiveFrom))
      : Promise.resolve([] as (typeof variantCosts.$inferSelect)[]),
  ]);
  const barcodeOf = new Map(variantRows.map((v) => [v.id, v.barcode]));

  for (const o of rows) {
    const ls = lines.filter((l) => l.orderId === o.id);
    const placedAt = o.placedAt ?? o.createdAt;

    // The unit cost snapshot taken at checkout, described by the cost record in effect then (when it matches).
    const unitCostOf = (l: (typeof lines)[number]): CostObject | null => {
      if (!withCosts || l.unitCost === null) return null;
      const record = costRows.find((c) => c.variantId === l.variantId && c.currency === o.currency && c.effectiveFrom <= placedAt && c.amount === l.unitCost);
      return {
        amount: toMinorString(l.unitCost),
        currency: o.currency,
        taxIncluded: record ? record.taxIncluded : null,
        taxRateBps: record ? record.taxRateBps : null,
        source: record ? costSource(record.source) : "store",
        effectiveFrom: record ? record.effectiveFrom.toISOString() : null,
      };
    };

    const lineItems: OrderLineItem[] = ls.map((l) => ({
      ref: l.id,
      productRef: l.productId,
      variantRef: l.variantId,
      sku: l.sku,
      barcode: l.variantId ? (barcodeOf.get(l.variantId) ?? null) : null,
      title: l.title,
      quantity: l.quantity,
      unitPrice: toMinorString(l.unitPrice),
      discount: toMinorString(l.discountAmount),
      taxRateBps: l.taxRateBps,
      taxAmount: toMinorString(l.taxAmount),
      taxIncluded: l.taxIncluded,
      total: toMinorString(l.total),
      unitCost: unitCostOf(l),
      refundedQuantity: l.refundedQuantity,
      returnedQuantity: l.returnedQuantity,
    }));

    let totalCost: string | null = null;
    if (withCosts && ls.length && ls.every((l) => l.unitCost !== null)) {
      totalCost = toMinorString(ls.reduce((sum, l) => sum + l.unitCost! * BigInt(Math.max(0, l.quantity - l.returnedQuantity)), 0n));
    }

    // Adjustment rows are per line; the contract lists one entry per campaign/code and type.
    const discountMap = new Map<string, OrderItem["discounts"][number]>();
    for (const a of adjustments.filter((x) => x.orderId === o.id)) {
      const type = a.type === "shipping_discount" ? "shipping_discount" : "discount";
      const code = sanitizeSharedValue(a.code);
      const key = `${type}|${a.campaignId ?? ""}|${code ?? ""}`;
      const prev = discountMap.get(key);
      const amount = (prev ? BigInt(prev.amount) : 0n) + a.amount;
      discountMap.set(key, { type, code, campaignRef: a.campaignId, amount: toMinorString(amount) });
    }

    const attempt = attempts.find((a) => a.orderId === o.id) ?? null;
    let payment: OrderItem["payment"] = null;
    if (attempt) {
      const evidence = events.find((e) => e.attemptId === attempt.id)?.payload ?? null;
      const fees = sales.filter((s) => s.paymentAttemptId === attempt.id).map((s) => s.feeAmount);
      const knownFees = fees.filter((f): f is bigint => f !== null);
      const details = paymentDetails(attempt.provider, evidence);
      payment = {
        provider: attempt.provider,
        method: details.method,
        installments: details.installments,
        fee: knownFees.length && knownFees.length === fees.length ? toMinorString(knownFees.reduce((a, b) => a + b, 0n)) : null,
      };
    }

    const address = addresses.find((a) => a.orderId === o.id)?.address ?? null;
    const carrier = o.shippingMethod?.carrierCode ?? fulfillmentRows.find((f) => f.orderId === o.id && f.carrierCode)?.carrierCode ?? null;
    const status = o.status as OrderItem["status"];
    out.set(o.id, {
      ref: o.id,
      number: o.number,
      channel: "storefront",
      status,
      paymentStatus: o.paymentStatus,
      placedAt: o.placedAt ? o.placedAt.toISOString() : null,
      updatedAt: o.updatedAt.toISOString(),
      currency: o.currency,
      // At most the province (il); the storefront stores it in `province`, `city` holds the district.
      city: provinceOf(address),
      totals: {
        subtotal: toMinorString(o.subtotal),
        discount: toMinorString(o.discountTotal),
        shipping: toMinorString(o.shippingTotal),
        tax: toMinorString(o.taxTotal),
        total: toMinorString(o.total),
        refunded: toMinorString(o.refundedTotal),
        cost: totalCost,
      },
      lines: lineItems,
      discounts: [...discountMap.values()],
      refunds: refundRows
        .filter((r) => r.orderId === o.id)
        .map((r) => ({
          ref: r.id,
          amount: toMinorString(r.amount),
          createdAt: (r.processedAt ?? r.createdAt).toISOString(),
          // Stored as minor-unit strings; BigInt normalises them and rejects anything else.
          lines: r.lines.map((x) => ({ lineRef: x.orderLineId, quantity: x.quantity, amount: BigInt(x.amount).toString() })),
        })),
      shipping: { charged: toMinorString(o.shippingTotal), cost: null, method: o.shippingMethod?.name ?? null, carrier },
      payment,
      // No personal or single-use coupon data exists without a campaign engine, so no code is withheld here.
      attribution: sanitizeAttribution(o.attribution),
    });
  }
  return out;
}

export interface OrderExportOptions {
  withCosts: boolean;
}

export async function exportOrders(deps: EkosistemServerDeps, link: LinkRow, query: ReadonlyArray<readonly [string, string]>, opts: OrderExportOptions): Promise<IncrementalPage<OrderItem>> {
  const req = parseIncrementalQuery(query, { allowRefs: false });
  return withTenantTx(deps.db, { organizationId: link.organizationId, storeId: link.storeId }, async (tx) => {
    const now = await transactionNow(tx);
    const page = await pageKeys(tx, req.since ? sinceSource(link.storeId) : fullSetSource(link.storeId), req);
    const built = await buildOrders(tx, link.storeId, page.keys.filter((k) => !k.deleted).map((k) => k.ref), opts.withCosts);
    return { items: assembleIncremental(page.keys, built), nextCursor: page.nextCursor, asOf: now.toISOString() };
  });
}

export async function exportOrder(deps: EkosistemServerDeps, link: LinkRow, ref: string, opts: OrderExportOptions): Promise<OrderItem> {
  if (!isUuidRef(ref)) throw new EkosistemError("not_found");
  const id = ref.toLowerCase();
  return withTenantTx(deps.db, { organizationId: link.organizationId, storeId: link.storeId }, async (tx) => {
    const [row] = await tx.execute<{ id: string }>(sql`select o.id::text as id from orders o where o.id = ${id} and ${orderFilter(link.storeId)}`);
    if (!row) throw new EkosistemError("not_found");
    const built = await buildOrders(tx, link.storeId, [id], opts.withCosts);
    const item = built.get(id);
    if (!item) throw new EkosistemError("not_found");
    return item;
  });
}
