import { and, eq, inArray, karmatikPriceSuggestions, ekosistemLinks, sql, withPlatformTx, withTenantTx } from "@altyapi/database";
import { PUSH_MAX_BACKOFF_MS } from "../constants";
import { EkosistemPeerError } from "../errors";
import { wireMoney } from "../money";
import { hasAnyScope } from "../scopes";
import { linkCredentials, type EkosistemServerDeps, type LinkRow } from "./common";
import { recordLinkInvalid } from "./pull";

/**
 * Delivery of the merchant's suggestion decisions to Kârmatik (§8.3, pricing:decide):
 * POST /ekosistem/v1/pricing/suggestions/{ref}/decision with the decision's idempotency id,
 * so a repeated delivery is harmless. Kârmatik never writes prices to altyapi; the merchant
 * applies them here and the decision only informs Kârmatik.
 */

export type SuggestionRow = typeof karmatikPriceSuggestions.$inferSelect;

const DECISION_MAX_ATTEMPTS = 10;
const DECISION_BACKOFF_BASE_MS = 60_000;
const DECISION_LEASE_MS = 2 * 60_000;

export type DecisionDelivery = "delivered" | "pending" | "failed" | "not_sent";

type DecisionColumns = Partial<Pick<typeof karmatikPriceSuggestions.$inferInsert, "decisionDeliveryStatus" | "decisionAttempts" | "decisionNextAttemptAt" | "decisionLastError" | "decisionDeliveredAt">>;

async function update(deps: Pick<EkosistemServerDeps, "db">, row: SuggestionRow, set: DecisionColumns): Promise<void> {
  await withTenantTx(deps.db, { organizationId: row.organizationId, storeId: row.storeId }, (tx) =>
    tx.update(karmatikPriceSuggestions).set(set).where(eq(karmatikPriceSuggestions.id, row.id)),
  );
}

/**
 * Sends one decision. Retryable failures stay pending with backoff (1 minute doubling, at
 * most an hour, 10 attempts); link and contract errors end the delivery.
 */
export async function sendDecision(deps: EkosistemServerDeps, link: LinkRow | null, row: SuggestionRow, now: Date = new Date()): Promise<DecisionDelivery> {
  if (row.localStatus === "new" || !row.decisionId) return "not_sent";
  if (!link || link.status !== "active" || link.id !== row.linkId) {
    await update(deps, row, { decisionDeliveryStatus: "failed", decisionLastError: "link_inactive", decisionNextAttemptAt: null });
    return "failed";
  }
  if (!hasAnyScope(link.peerScopes, "pricing:decide")) {
    await update(deps, row, { decisionDeliveryStatus: "failed", decisionLastError: "scope_missing", decisionNextAttemptAt: null });
    return "failed";
  }
  const attempts = row.decisionAttempts + 1;
  try {
    if (!deps.keys) throw new Error("ekosistem decision delivery needs a key provider to decrypt the link secret");
    const applied = row.localStatus === "applied";
    await deps.peers.karmatikDecision(await linkCredentials(deps.keys, link), row.ref, {
      id: row.decisionId,
      status: applied ? "applied" : "dismissed",
      appliedPrice: applied && row.decisionAppliedPrice !== null ? wireMoney(row.decisionAppliedPrice, row.currency) : null,
    });
    await update(deps, row, { decisionDeliveryStatus: "delivered", decisionAttempts: attempts, decisionDeliveredAt: now, decisionLastError: null, decisionNextAttemptAt: null });
    return "delivered";
  } catch (err) {
    const peerErr = err instanceof EkosistemPeerError ? err : null;
    const code = peerErr ? peerErr.code : err instanceof Error ? err.name : "error";
    if (peerErr?.code === "link_invalid") await recordLinkInvalid(deps, link, now);
    // A ref that cannot form a canonical path, a rejected body or a missing suggestion never heals.
    const retryable = peerErr ? peerErr.retryable : true;
    if (!retryable || attempts >= DECISION_MAX_ATTEMPTS) {
      await update(deps, row, { decisionDeliveryStatus: "failed", decisionAttempts: attempts, decisionLastError: code, decisionNextAttemptAt: null });
      if (!peerErr) deps.logger.error({ err, suggestionId: row.id }, "ekosistem decision delivery failed");
      return "failed";
    }
    // An open breaker is not an attempt.
    const spent = peerErr?.circuitOpen ? row.decisionAttempts : attempts;
    const wait = Math.max(Math.min(PUSH_MAX_BACKOFF_MS, DECISION_BACKOFF_BASE_MS * 2 ** Math.max(0, spent - 1)), Math.min(PUSH_MAX_BACKOFF_MS, peerErr?.retryAfterMs ?? 0));
    await update(deps, row, { decisionDeliveryStatus: "pending", decisionAttempts: spent, decisionLastError: code, decisionNextAttemptAt: new Date(now.getTime() + wait) });
    return "pending";
  }
}

/** Worker: sends decisions that are due (leased with SKIP LOCKED). */
export async function deliverDueDecisions(deps: EkosistemServerDeps, now: Date = new Date(), limit = 50): Promise<Record<DecisionDelivery, number>> {
  const counts: Record<DecisionDelivery, number> = { delivered: 0, pending: 0, failed: 0, not_sent: 0 };
  const rows = await withPlatformTx(deps.db, async (tx) => {
    const due = await tx.execute<{ id: string }>(sql`
      select id from karmatik_price_suggestions
       where decision_delivery_status = 'pending' and decision_next_attempt_at <= ${now.toISOString()}::timestamptz
       order by decision_next_attempt_at
       limit ${limit}
       for update skip locked`);
    if (!due.length) return [];
    return tx
      .update(karmatikPriceSuggestions)
      .set({ decisionNextAttemptAt: new Date(now.getTime() + DECISION_LEASE_MS) })
      .where(inArray(karmatikPriceSuggestions.id, due.map((d) => d.id)))
      .returning();
  });
  if (!rows.length) return counts;
  const links = new Map(
    (
      await withPlatformTx(deps.db, (tx) =>
        tx
          .select()
          .from(ekosistemLinks)
          .where(and(inArray(ekosistemLinks.id, [...new Set(rows.map((r) => r.linkId))]))),
      )
    ).map((l) => [l.id, l as LinkRow]),
  );
  for (const row of rows) counts[await sendDecision(deps, links.get(row.linkId) ?? null, row, now)]++;
  return counts;
}
