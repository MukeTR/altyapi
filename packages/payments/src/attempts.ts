import { createHash } from "node:crypto";
import { AppError, newId } from "@altyapi/commerce-core";
import { and, eq, paymentAttempts, paymentEvents, paymentTransactions, sql, type Database, type Transaction } from "@altyapi/database";
import type { ConnectionRow } from "./connections";
import type { PaymentSession, VerifiedPaymentEvent } from "./types";

export type AttemptRow = typeof paymentAttempts.$inferSelect;
export type AttemptStatus = AttemptRow["status"];

/** Payment state machine (independent of the order state machine). */
const TRANSITIONS: Record<AttemptStatus, AttemptStatus[]> = {
  created: ["session_created", "failed", "cancelled", "paid", "pending"],
  session_created: ["pending", "requires_action", "paid", "failed", "cancelled"],
  pending: ["paid", "failed", "cancelled", "requires_action"],
  requires_action: ["paid", "failed", "cancelled", "pending"],
  // A verified success after a failure means money was taken; it must be recorded.
  failed: ["paid"],
  cancelled: ["paid"],
  paid: ["partially_refunded", "refunded", "cancelled"],
  partially_refunded: ["partially_refunded", "refunded"],
  refunded: [],
};

export function canTransition(from: AttemptStatus, to: AttemptStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export async function createAttempt(
  tx: Transaction,
  scope: { organizationId: string; storeId: string },
  input: { orderId: string; connection: ConnectionRow; amount: bigint; currency: string; idempotencyKey: string },
): Promise<AttemptRow> {
  const id = newId();
  const [row] = await tx
    .insert(paymentAttempts)
    .values({
      id,
      ...scope,
      orderId: input.orderId,
      connectionId: input.connection.id,
      provider: input.connection.provider,
      mode: input.connection.mode,
      status: "created",
      amount: input.amount,
      currency: input.currency,
      idempotencyKey: input.idempotencyKey,
      // Alphanumeric reference accepted by both providers (PayTR merchant_oid rules).
      providerReference: `AP${id.replace(/-/g, "")}`,
    })
    .returning();
  return row!;
}

export async function markSessionCreated(db: Database | Transaction, attemptId: string, session: PaymentSession) {
  await db
    .update(paymentAttempts)
    .set({
      status: "session_created",
      sessionToken: session.token,
      sessionExpiresAt: session.expiresAt,
      clientData: { kind: session.kind, url: session.url, html: session.html },
    })
    .where(eq(paymentAttempts.id, attemptId));
}

export async function markAttemptFailed(db: Database | Transaction, attemptId: string, code: string, message: string | null) {
  await db.update(paymentAttempts).set({ status: "failed", failureCode: code, failureMessage: message?.slice(0, 500) ?? null }).where(eq(paymentAttempts.id, attemptId));
}

export function payloadHash(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

/**
 * Persists a provider notification once. Returns false when the same event (by provider event
 * id or identical payload) was already recorded, so the caller only acknowledges it.
 */
export async function recordPaymentEvent(
  tx: Transaction,
  input: { attempt: AttemptRow | null; provider: "paytr" | "iyzico"; event: VerifiedPaymentEvent; rawBody: string },
): Promise<{ id: string; duplicate: boolean }> {
  const id = newId();
  const hash = payloadHash(input.rawBody);
  // Unverified payloads are kept as evidence under their own key; they must never occupy the
  // dedupe key of the genuine event (otherwise a forged notification could block a payment).
  const providerEventId = input.event.verified ? input.event.providerEventId : `unverified:${hash}`;
  const inserted = await tx
    .insert(paymentEvents)
    .values({
      id,
      organizationId: input.attempt?.organizationId ?? null,
      storeId: input.attempt?.storeId ?? null,
      paymentAttemptId: input.attempt?.id ?? null,
      provider: input.provider,
      providerEventId,
      payloadHash: input.event.verified ? hash : `unverified:${hash}`,
      type: input.event.type,
      verified: input.event.verified ? "yes" : "no",
      payload: input.event.evidence,
    })
    .onConflictDoNothing()
    .returning({ id: paymentEvents.id });
  return inserted.length ? { id, duplicate: false } : { id, duplicate: true };
}

export interface AttemptTransition {
  changed: boolean;
  from: AttemptStatus;
  to: AttemptStatus;
  amountMismatch: boolean;
}

/**
 * Applies a verified outcome to an attempt under a row lock. A payment counts as paid only
 * when the captured amount covers the attempt amount (installment interest may exceed it).
 */
export async function applyOutcome(tx: Transaction, attemptId: string, event: VerifiedPaymentEvent): Promise<AttemptTransition> {
  const [attempt] = await tx.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptId)).for("update");
  if (!attempt) throw new AppError("not_found", "errors.payments.attempt_not_found");
  let to: AttemptStatus = attempt.status;
  let amountMismatch = false;
  if (event.outcome === "paid") {
    amountMismatch = event.amountPaid !== null && event.amountPaid < attempt.amount;
    to = amountMismatch ? "failed" : "paid";
  } else if (event.outcome === "failed") to = "failed";
  else if (event.outcome === "pending") to = "pending";
  if (to === attempt.status || !canTransition(attempt.status, to)) {
    return { changed: false, from: attempt.status, to: attempt.status, amountMismatch };
  }
  await tx
    .update(paymentAttempts)
    .set({
      status: to,
      providerPaymentId: event.providerPaymentId ?? attempt.providerPaymentId,
      paidAt: to === "paid" ? new Date() : attempt.paidAt,
      failureCode: to === "failed" ? (amountMismatch ? "amount_mismatch" : event.failureCode) : null,
      failureMessage: to === "failed" ? event.failureMessage : null,
    })
    .where(eq(paymentAttempts.id, attemptId));
  if (to === "paid") {
    const txs = event.transactions.length ? event.transactions : [{ id: event.providerPaymentId ?? attempt.providerReference, amount: event.amountPaid ?? attempt.amount }];
    for (const t of txs) {
      await tx.insert(paymentTransactions).values({
        id: newId(),
        organizationId: attempt.organizationId,
        storeId: attempt.storeId,
        paymentAttemptId: attempt.id,
        type: "sale",
        status: "succeeded",
        amount: t.amount,
        currency: attempt.currency,
        providerTransactionId: t.id,
        rawStatus: event.type,
      });
    }
  }
  return { changed: true, from: attempt.status, to, amountMismatch };
}

/** Sale transactions with their remaining refundable amounts (for per-item refunds). */
export async function refundableTransactions(tx: Transaction, attemptId: string): Promise<{ id: string; refundable: bigint }[]> {
  const rows = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.paymentAttemptId, attemptId));
  const sales = rows.filter((r) => r.type === "sale" && r.status === "succeeded");
  return sales.map((s) => {
    const refunded = rows
      .filter((r) => r.type === "refund" && r.status === "succeeded" && (r.rawStatus ?? "").split(",").some((p) => p.startsWith(`${s.providerTransactionId}:`)))
      .reduce((sum, r) => {
        const part = (r.rawStatus ?? "").split(",").find((p) => p.startsWith(`${s.providerTransactionId}:`));
        return sum + (part ? BigInt(part.split(":")[1] ?? "0") : 0n);
      }, 0n);
    return { id: s.providerTransactionId ?? s.id, refundable: s.amount - refunded };
  });
}

/** Records a successful provider refund and moves the attempt to (partially_)refunded. */
export async function recordRefund(
  tx: Transaction,
  attempt: AttemptRow,
  input: { amount: bigint; providerRefundIds: string[]; allocations: { transactionId: string; amount: bigint }[] },
): Promise<AttemptStatus> {
  await tx.insert(paymentTransactions).values({
    id: newId(),
    organizationId: attempt.organizationId,
    storeId: attempt.storeId,
    paymentAttemptId: attempt.id,
    type: "refund",
    status: "succeeded",
    amount: input.amount,
    currency: attempt.currency,
    providerTransactionId: input.providerRefundIds.join(",").slice(0, 500) || null,
    // "txId:amount" pairs let refundableTransactions() compute remaining amounts per item.
    rawStatus: input.allocations.map((a) => `${a.transactionId}:${a.amount}`).join(","),
  });
  const [updated] = await tx
    .update(paymentAttempts)
    .set({
      refundedAmount: sql`${paymentAttempts.refundedAmount} + ${input.amount}`,
    })
    .where(eq(paymentAttempts.id, attempt.id))
    .returning();
  const status: AttemptStatus = updated!.refundedAmount >= updated!.amount ? "refunded" : "partially_refunded";
  await tx.update(paymentAttempts).set({ status }).where(eq(paymentAttempts.id, attempt.id));
  return status;
}

export async function findAttemptByReference(tx: Transaction, provider: "paytr" | "iyzico", reference: string) {
  return tx.query.paymentAttempts.findFirst({ where: and(eq(paymentAttempts.provider, provider), eq(paymentAttempts.providerReference, reference)) });
}
