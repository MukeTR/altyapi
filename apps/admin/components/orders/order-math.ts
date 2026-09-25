import type { OrderDetail, OrderLine } from "@/lib/commerce/types";

/**
 * Quantities and amounts for after-sales dialogs, mirroring the API's rules so the dialogs can
 * bound their inputs. The API recomputes and enforces all of them.
 */

/** Units of a line that no fulfillment covers yet. */
export function fulfillableQuantity(line: OrderLine): number {
  return Math.max(0, line.quantity - line.fulfilledQuantity);
}

/** Units of a line not refunded yet. */
export function refundableQuantity(line: OrderLine): number {
  return Math.max(0, line.quantity - line.refundedQuantity);
}

/** Units of a line in open (requested or approved) return requests. */
function openReturnQuantity(detail: OrderDetail, lineId: string): number {
  return detail.returns
    .filter((r) => r.status === "requested" || r.status === "approved")
    .flatMap((r) => r.lines)
    .filter((l) => l.orderLineId === lineId)
    .reduce((s, l) => s + l.quantity, 0);
}

/** Shipped units that can still go into a new return request. */
export function returnableQuantity(detail: OrderDetail, line: OrderLine): number {
  return Math.max(0, line.fulfilledQuantity - line.returnedQuantity - openReturnQuantity(detail, line.id));
}

/** Amount already refunded per line, from succeeded refunds. */
function refundedAmount(detail: OrderDetail, lineId: string): bigint {
  return detail.refunds
    .filter((r) => r.status === "succeeded")
    .flatMap((r) => r.lines)
    .filter((l) => l.orderLineId === lineId)
    .reduce((s, l) => s + BigInt(l.amount), 0n);
}

/** Refund amount for `quantity` units of a line (the last units take exactly what is left). */
export function lineRefundAmount(detail: OrderDetail, line: OrderLine, quantity: number): bigint {
  if (quantity <= 0) return 0n;
  const remaining = refundableQuantity(line);
  const total = BigInt(line.total);
  if (quantity >= remaining) return total - refundedAmount(detail, line.id);
  return (total * BigInt(quantity)) / BigInt(line.quantity);
}

/** Money the order can still refund. */
export function refundableTotal(detail: OrderDetail): bigint {
  const left = BigInt(detail.order.total) - BigInt(detail.order.refundedTotal);
  return left > 0n ? left : 0n;
}

export const FULFILLABLE_STATUSES = ["confirmed", "processing", "partially_fulfilled"];
export const CANCELLABLE_STATUSES = ["draft", "awaiting_payment", "confirmed", "processing"];
export const REFUNDABLE_PAYMENT = ["paid", "partially_refunded"];
export const RETURNABLE_STATUSES = ["fulfilled", "partially_fulfilled"];
