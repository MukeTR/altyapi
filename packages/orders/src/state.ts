import { AppError } from "@altyapi/commerce-core";

export type OrderStatus = "draft" | "awaiting_payment" | "confirmed" | "processing" | "partially_fulfilled" | "fulfilled" | "cancelled" | "returned";

/** Order state machine; payment state lives separately on the order and payment attempts. */
const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ["awaiting_payment", "confirmed", "cancelled"],
  awaiting_payment: ["confirmed", "cancelled"],
  confirmed: ["processing", "partially_fulfilled", "fulfilled", "cancelled"],
  processing: ["partially_fulfilled", "fulfilled", "cancelled"],
  partially_fulfilled: ["fulfilled", "returned"],
  fulfilled: ["returned"],
  cancelled: [],
  returned: [],
};

export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (from !== to && !ORDER_TRANSITIONS[from].includes(to)) {
    throw new AppError("precondition_failed", "errors.order.invalid_transition", { from, to });
  }
}

export function canCancel(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].includes("cancelled");
}
