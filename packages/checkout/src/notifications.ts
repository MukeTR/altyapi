import { AppError } from "@altyapi/commerce-core";
import { and, eq, inArray, lt, orders, paymentAttempts, paymentProviderConnections, withPlatformTx, withTenantTx } from "@altyapi/database";
import { appendEvent } from "@altyapi/events";
import { recordAudit } from "@altyapi/audit";
import { cancelUnpaidOrder, confirmOrderPayment, markOrderPaymentFailed, type RefundGateway } from "@altyapi/orders";
import {
  applyOutcome,
  decimalToMinor,
  findAttemptByReference,
  providerForConnection,
  recordPaymentEvent,
  refundableTransactions,
  type AttemptRow,
  type CallbackInput,
  type ConnectionRow,
  type PaymentsDeps,
  type ProviderName,
  type VerifiedPaymentEvent,
} from "@altyapi/payments";
import type { Logger } from "@altyapi/observability";

export interface NotificationResult {
  ack: VerifiedPaymentEvent["ack"];
  /** Where to send the shopper's browser (iyzico callback is a browser POST). */
  redirectTo: string | null;
  outcome: VerifiedPaymentEvent["outcome"];
}

async function loadConnection(deps: PaymentsDeps, connectionId: string): Promise<ConnectionRow> {
  const c = await withPlatformTx(deps.db, (tx) => tx.query.paymentProviderConnections.findFirst({ where: eq(paymentProviderConnections.id, connectionId) }));
  if (!c) throw new AppError("not_found", "errors.payments.connection_not_found");
  return c;
}

/**
 * Applies a verified provider event: records it once, advances the payment state machine and,
 * on success, confirms the order. Duplicates and unverified events change nothing.
 */
export async function processVerifiedEvent(deps: PaymentsDeps, provider: ProviderName, attempt: AttemptRow | null, event: VerifiedPaymentEvent, rawBody: string, logger?: Logger) {
  if (!attempt) {
    await withPlatformTx(deps.db, (tx) => recordPaymentEvent(tx, { attempt: null, provider, event, rawBody }));
    logger?.warn({ provider, reference: event.reference }, "payment notification for unknown attempt");
    return;
  }
  const scope = { organizationId: attempt.organizationId, storeId: attempt.storeId };
  await withTenantTx(deps.db, scope, async (tx) => {
    const recorded = await recordPaymentEvent(tx, { attempt, provider, event, rawBody });
    if (recorded.duplicate || !event.verified) return;
    const transition = await applyOutcome(tx, attempt.id, event);
    if (!transition.changed) return;
    if (transition.to === "paid") {
      const result = await confirmOrderPayment(tx, scope, attempt.orderId, attempt.id);
      await appendEvent(tx, { type: "payment.paid", ...scope, aggregateType: "payment_attempt", aggregateId: attempt.id, payload: { paymentAttemptId: attempt.id, orderId: attempt.orderId, provider } });
      if (result.paidAfterCancel) logger?.error({ orderId: attempt.orderId, attemptId: attempt.id }, "payment received for cancelled order; refund required");
    } else if (transition.to === "failed") {
      await markOrderPaymentFailed(tx, attempt.orderId, transition.amountMismatch ? "amount_mismatch" : event.failureCode);
      await appendEvent(tx, {
        type: "payment.failed",
        ...scope,
        aggregateType: "payment_attempt",
        aggregateId: attempt.id,
        payload: { paymentAttemptId: attempt.id, orderId: attempt.orderId, provider, reason: transition.amountMismatch ? "amount_mismatch" : event.failureCode },
      });
      if (transition.amountMismatch) await recordAudit(tx, { ...scope, action: "payment.amount_mismatch", resourceType: "payment_attempt", resourceId: attempt.id, metadata: { expected: attempt.amount, paid: event.amountPaid } });
    }
  });
}

/** PayTR "Bildirim URL" (server-to-server POST). Must answer plain "OK" once handled. */
export async function handlePaytrNotification(deps: PaymentsDeps, connectionId: string, input: CallbackInput, logger?: Logger): Promise<NotificationResult> {
  const connection = await loadConnection(deps, connectionId);
  if (connection.provider !== "paytr") throw new AppError("not_found", "errors.payments.connection_not_found");
  const provider = await providerForConnection(deps, connection);
  const event = await provider.verifyCallback(input);
  const attempt = event.reference ? await withPlatformTx(deps.db, (tx) => findAttemptByReference(tx, "paytr", event.reference!)) : null;
  if (attempt && attempt.connectionId !== connection.id) {
    return { ack: { status: 400, contentType: "text/plain", body: "CONNECTION_MISMATCH" }, redirectTo: null, outcome: "unknown" };
  }
  await processVerifiedEvent(deps, "paytr", attempt ?? null, event, input.rawBody, logger);
  return { ack: event.ack, redirectTo: null, outcome: event.outcome };
}

/** iyzico browser callback (form POST with token) → retrieve → redirect to the status page. */
export async function handleIyzicoCallback(deps: PaymentsDeps, attemptId: string, input: CallbackInput, logger?: Logger): Promise<NotificationResult> {
  const attempt = await withPlatformTx(deps.db, (tx) => tx.query.paymentAttempts.findFirst({ where: eq(paymentAttempts.id, attemptId) }));
  if (!attempt || attempt.provider !== "iyzico") throw new AppError("not_found", "errors.payments.attempt_not_found");
  const connection = await loadConnection(deps, attempt.connectionId);
  const provider = await providerForConnection(deps, connection);
  const event = await provider.verifyCallback({ ...input, reference: attempt.providerReference });
  await processVerifiedEvent(deps, "iyzico", attempt, event, input.rawBody || JSON.stringify(input.body), logger);
  const statusUrl = (attempt.clientData as { statusUrl?: string } | null)?.statusUrl ?? null;
  const redirectTo = statusUrl ? (event.outcome === "paid" || event.outcome === "pending" ? statusUrl : `${statusUrl}&failed=1`) : null;
  return { ack: event.ack, redirectTo, outcome: event.outcome };
}

/** iyzico merchant webhook (X-IYZ-SIGNATURE-V3), configured in the iyzico panel. */
export async function handleIyzicoWebhook(deps: PaymentsDeps, connectionId: string, input: CallbackInput, logger?: Logger): Promise<NotificationResult> {
  const connection = await loadConnection(deps, connectionId);
  if (connection.provider !== "iyzico") throw new AppError("not_found", "errors.payments.connection_not_found");
  const provider = await providerForConnection(deps, connection);
  const reference = typeof input.body.paymentConversationId === "string" ? input.body.paymentConversationId : undefined;
  const event = await provider.verifyCallback({ ...input, ...(reference ? { reference } : {}) });
  const attempt = event.reference ? await withPlatformTx(deps.db, (tx) => findAttemptByReference(tx, "iyzico", event.reference!)) : null;
  await processVerifiedEvent(deps, "iyzico", attempt ?? null, event, input.rawBody, logger);
  return { ack: event.ack, redirectTo: null, outcome: event.outcome };
}

/**
 * Server-side reconciliation for attempts whose notification never arrived: asks the provider
 * and applies the answer as a verified event.
 */
export async function reconcileAttempt(deps: PaymentsDeps, attempt: AttemptRow, logger?: Logger): Promise<string> {
  const connection = await loadConnection(deps, attempt.connectionId);
  const provider = await providerForConnection(deps, connection);
  const status = await provider.getPayment({ reference: attempt.providerReference, providerPaymentId: attempt.providerPaymentId, token: attempt.sessionToken });
  if (status.outcome !== "paid" && status.outcome !== "failed") return status.outcome;
  const event: VerifiedPaymentEvent = {
    verified: true,
    providerEventId: `reconcile:${attempt.id}:${status.outcome}`,
    type: "reconciliation",
    reference: attempt.providerReference,
    outcome: status.outcome,
    amountPaid: status.amountPaid,
    providerPaymentId: status.providerPaymentId,
    transactions: status.transactions,
    failureCode: status.outcome === "failed" ? "reconciled_failed" : null,
    failureMessage: null,
    ack: { status: 200, contentType: "text/plain", body: "" },
    evidence: { outcome: status.outcome, amountPaid: status.amountPaid?.toString() ?? null, raw: status.raw },
  };
  await processVerifiedEvent(deps, connection.provider, attempt, event, JSON.stringify(event.evidence), logger);
  return status.outcome;
}

/**
 * Worker: orders still awaiting payment after the reservation window are reconciled with the
 * provider once more and then cancelled (stock released) if no payment exists.
 */
export async function expireUnpaidOrders(deps: PaymentsDeps, olderThanMinutes: number, logger?: Logger): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const due = await withPlatformTx(deps.db, (tx) =>
    tx
      .select({ id: orders.id, organizationId: orders.organizationId, storeId: orders.storeId })
      .from(orders)
      .where(and(eq(orders.status, "awaiting_payment"), lt(orders.placedAt, cutoff)))
      .limit(100),
  );
  let cancelled = 0;
  for (const o of due) {
    const attempts = await withPlatformTx(deps.db, (tx) =>
      tx.select().from(paymentAttempts).where(and(eq(paymentAttempts.orderId, o.id), inArray(paymentAttempts.status, ["session_created", "pending", "requires_action"]))),
    );
    let paid = false;
    for (const a of attempts) {
      try {
        paid = (await reconcileAttempt(deps, a, logger)) === "paid" || paid;
      } catch (err) {
        logger?.warn({ err, attemptId: a.id }, "reconciliation failed");
      }
    }
    if (paid) continue;
    const scope = { organizationId: o.organizationId, storeId: o.storeId };
    if (await withTenantTx(deps.db, scope, (tx) => cancelUnpaidOrder(tx, scope, o.id, "payment_timeout"))) cancelled++;
  }
  return cancelled;
}

/** Executes refunds through the attempt's provider connection. */
export function createRefundGateway(deps: PaymentsDeps): RefundGateway {
  return {
    async refund({ attempt, amount, refundId, ip }) {
      const connection = await loadConnection(deps, attempt.connectionId);
      const provider = await providerForConnection(deps, connection);
      const transactions = await withTenantTx(deps.db, { organizationId: attempt.organizationId, storeId: attempt.storeId }, (tx) => refundableTransactions(tx, attempt.id));
      const result = await provider.refund({
        reference: attempt.providerReference,
        providerPaymentId: attempt.providerPaymentId,
        amount,
        currency: attempt.currency,
        ip,
        refundId,
        transactions,
      });
      // iyzico reports "transactionId:decimal" per refunded item; PayTR refunds the order as a whole.
      const allocations = result.providerRefundIds.some((id) => id.includes(":"))
        ? result.providerRefundIds.map((id) => {
            const [transactionId, decimal] = id.split(":");
            return { transactionId: transactionId!, amount: decimalToMinor(decimal!) };
          })
        : [{ transactionId: transactions[0]?.id ?? attempt.providerReference, amount }];
      return { ok: result.ok, providerRefundIds: result.providerRefundIds, allocations, errorCode: result.errorCode, errorMessage: result.errorMessage };
    },
  };
}

/** Customer/API status of an order payment, for the checkout completion page. */
export async function orderPaymentState(deps: PaymentsDeps, orderId: string) {
  const [o] = await withPlatformTx(deps.db, (tx) => tx.select({ status: orders.status, paymentStatus: orders.paymentStatus }).from(orders).where(eq(orders.id, orderId)));
  return o ?? null;
}
