import { expireUnpaidOrders, reconcileAttempt } from "@altyapi/checkout";
import { and, inArray, lt, paymentAttempts, withPlatformTx } from "@altyapi/database";
import type { WorkerDeps } from "../deps";

/** Checkout sessions are 30 minutes; unpaid orders are reconciled and cancelled after 45. */
export const UNPAID_ORDER_TTL_MINUTES = 45;

export async function reconcileStaleAttempts(deps: WorkerDeps): Promise<number> {
  const cutoff = new Date(Date.now() - 10 * 60_000);
  const stale = await withPlatformTx(deps.db, (tx) =>
    tx
      .select()
      .from(paymentAttempts)
      .where(and(inArray(paymentAttempts.status, ["session_created", "pending", "requires_action"]), lt(paymentAttempts.updatedAt, cutoff)))
      .limit(50),
  );
  for (const a of stale) {
    try {
      await reconcileAttempt(deps.payments, a, deps.logger);
    } catch (err) {
      deps.logger.warn({ err, attemptId: a.id }, "attempt reconciliation failed");
    }
  }
  return stale.length;
}

export const orderScheduledTasks = (deps: WorkerDeps) => [
  { name: "orders.expire-unpaid", intervalMs: 60_000, run: () => expireUnpaidOrders(deps.payments, UNPAID_ORDER_TTL_MINUTES, deps.logger) },
  { name: "payments.reconcile-stale", intervalMs: 5 * 60_000, run: () => reconcileStaleAttempts(deps) },
];
