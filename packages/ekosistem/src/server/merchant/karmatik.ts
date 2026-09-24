import { z } from "zod";
import { AppError, conflict, invalid, newId, notFound } from "@altyapi/commerce-core";
import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  karmatikAlerts,
  karmatikCompetitorPrices,
  karmatikPriceSuggestions,
  karmatikProfitSnapshots,
  moneyAmounts,
  priceLists,
  sql,
  withTenantTx,
  type SQL,
} from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { writePrices, type IntegrationDeps, type WriteOutcome } from "@altyapi/integrations";
import { assertCan, tenantScope, type StoreContext } from "@altyapi/tenancy";
import type { EkosistemServerDeps, LinkRow } from "../common";
import { sendDecision, type SuggestionRow } from "../decisions";
import { listQuerySchema, loadLocalVariants, linkStatusBlock, money, requireActiveLink, type LocalVariant } from "./common";
import { profitCheck, type ProfitCheckResult } from "./profit-guard";
import { loadEkosistemSettings } from "./settings";

/**
 * Merchant views of what altyapi pulled from Kârmatik (§8) and the actions on price
 * suggestions. Reads need karmatik:read; applying or dismissing a suggestion is a pricing
 * decision and needs pricing:write as well. Kârmatik never writes prices: the merchant
 * applies them here, through the same ownership-aware price write as every other change.
 */

const s = karmatikProfitSnapshots;
const tokenSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/);

/** Loss-making rows (netProfit < 0). */
const lossSql = sql`${s.lossMaking} is true`;
/** Not loss-making but below Kârmatik's minimum margin, or without any safe discount. */
const thinSql = sql`${s.lossMaking} is not true and ((${s.minMarginBps} is not null and ${s.marginBps} is not null and ${s.marginBps} < ${s.minMarginBps}) or ${s.safeDiscountBps} = 0)`;

function profitView(row: typeof karmatikProfitSnapshots.$inferSelect, local: LocalVariant | undefined) {
  const payload = row.payload as { unitCost?: unknown };
  return {
    ref: row.ref,
    channel: row.channel,
    storeLabel: row.storeLabel,
    sourceRef: row.sourceRef,
    barcode: row.barcode,
    sku: row.sku,
    summaryOnly: row.summaryOnly,
    price: money(row.price, row.currency),
    unitCost: payload.unitCost ?? null,
    netProfit: money(row.netProfit, row.currency),
    marginBps: row.marginBps,
    floorPrice: money(row.floorPrice, row.currency),
    floorBasis: row.floorBasis,
    minMarginBps: row.minMarginBps,
    safeDiscountBps: row.safeDiscountBps,
    breakEvenPrice: money(row.breakEvenPrice, row.currency),
    lossMaking: row.lossMaking,
    basis: row.basis,
    missing: row.missing,
    updatedAt: row.peerUpdatedAt,
    variant: local ?? null,
  };
}

export function suggestionView(row: SuggestionRow, local: LocalVariant | undefined) {
  return {
    ref: row.ref,
    channel: row.channel,
    sourceRef: row.sourceRef,
    barcode: row.barcode,
    currentPrice: money(row.currentPrice, row.currency),
    suggestedPrice: money(row.suggestedPrice, row.currency),
    reason: row.reason,
    competitorMinPrice: money(row.competitorMinPrice, row.currency),
    confidenceBps: row.confidenceBps,
    peerStatus: row.peerStatus,
    status: row.localStatus,
    /** Only open suggestions of the linked web store with a matched variant can be applied here. */
    actionable: row.channel === "web" && row.peerStatus === "open" && row.localStatus === "new" && row.variantId !== null,
    decision:
      row.localStatus === "new"
        ? null
        : {
            decidedAt: row.decidedAt,
            appliedPrice: money(row.decisionAppliedPrice, row.currency),
            delivery: row.decisionDeliveryStatus ?? "not_sent",
            attempts: row.decisionAttempts,
            lastError: row.decisionLastError,
            deliveredAt: row.decisionDeliveredAt,
          },
    createdAt: row.peerCreatedAt,
    updatedAt: row.peerUpdatedAt,
    variant: local ?? null,
  };
}

function alertView(row: typeof karmatikAlerts.$inferSelect, local: LocalVariant | undefined) {
  return {
    ref: row.ref,
    channel: row.channel,
    storeLabel: row.storeLabel,
    type: row.type,
    severity: row.severity,
    barcode: row.barcode,
    sourceRef: row.sourceRef,
    title: row.title,
    body: row.body,
    impactMonthly: money(row.impactMonthly, row.currency),
    createdAt: row.peerCreatedAt,
    updatedAt: row.peerUpdatedAt,
    resolvedAt: row.resolvedAt,
    variant: local ?? null,
  };
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export async function karmatikOverview(deps: EkosistemServerDeps, ctx: StoreContext) {
  assertCan(ctx, "karmatik:read");
  const status = await linkStatusBlock(deps, ctx, "karmatik");
  const settings = await withTenantTx(deps.db, tenantScope(ctx), (tx) => loadEkosistemSettings(tx, ctx.storeId));
  const base = {
    linked: status.link?.status === "active",
    link: status.view,
    configured: status.configured,
    circuit: status.circuit,
    freshness: status.freshness,
    nextPullAt: status.nextPullAt,
    profitGuard: settings.profitGuard,
  };
  const link = status.link;
  if (!link || link.status !== "active") return { ...base, profit: null, suggestions: null, alerts: null, competitors: null };

  return withTenantTx(deps.db, tenantScope(ctx), async (tx) => {
    const [profit] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        matched: sql<number>`count(*) filter (where ${s.variantId} is not null)::int`,
        lossMaking: sql<number>`count(*) filter (where ${lossSql})::int`,
        thinMargin: sql<number>`count(*) filter (where ${thinSql})::int`,
        missingCost: sql<number>`count(*) filter (where 'cost' = any(${s.missing}))::int`,
        estimated: sql<number>`count(*) filter (where ${s.basis} = 'estimated')::int`,
        newest: sql<Date | null>`max(${s.peerUpdatedAt})`.mapWith(s.peerUpdatedAt),
      })
      .from(s)
      .where(eq(s.linkId, link.id));
    const byChannel = await tx
      .select({ channel: s.channel, total: sql<number>`count(*)::int`, lossMaking: sql<number>`count(*) filter (where ${lossSql})::int` })
      .from(s)
      .where(eq(s.linkId, link.id))
      .groupBy(s.channel)
      .orderBy(s.channel);
    const worst = await tx
      .select()
      .from(s)
      .where(and(eq(s.linkId, link.id), lossSql))
      .orderBy(sql`${s.marginBps} asc nulls last`, asc(s.ref))
      .limit(10);
    const thin = await tx
      .select()
      .from(s)
      .where(and(eq(s.linkId, link.id), thinSql))
      .orderBy(sql`${s.marginBps} asc nulls last`, asc(s.ref))
      .limit(10);

    const sg = karmatikPriceSuggestions;
    const [suggestions] = await tx
      .select({
        open: sql<number>`count(*) filter (where ${sg.peerStatus} = 'open' and ${sg.localStatus} = 'new')::int`,
        actionable: sql<number>`count(*) filter (where ${sg.peerStatus} = 'open' and ${sg.localStatus} = 'new' and ${sg.channel} = 'web' and ${sg.variantId} is not null)::int`,
        applied: sql<number>`count(*) filter (where ${sg.localStatus} = 'applied')::int`,
        dismissed: sql<number>`count(*) filter (where ${sg.localStatus} = 'dismissed')::int`,
        undelivered: sql<number>`count(*) filter (where ${sg.decisionDeliveryStatus} in ('pending', 'failed'))::int`,
      })
      .from(sg)
      .where(eq(sg.linkId, link.id));

    const al = karmatikAlerts;
    const severity = await tx
      .select({ severity: al.severity, n: sql<number>`count(*)::int` })
      .from(al)
      .where(and(eq(al.linkId, link.id), isNull(al.resolvedAt)))
      .groupBy(al.severity);
    const latestAlerts = await tx
      .select()
      .from(al)
      .where(and(eq(al.linkId, link.id), isNull(al.resolvedAt)))
      .orderBy(sql`case ${al.severity} when 'critical' then 0 when 'warning' then 1 else 2 end`, desc(al.peerUpdatedAt))
      .limit(5);

    const cp = karmatikCompetitorPrices;
    const [competitors] = await tx
      .select({
        offers: sql<number>`count(*)::int`,
        variantsTracked: sql<number>`count(distinct ${cp.variantId})::int`,
        newest: sql<Date | null>`max(${cp.observedAt})`.mapWith(cp.observedAt),
      })
      .from(cp)
      .where(eq(cp.linkId, link.id));

    const locals = await loadLocalVariants(tx, ctx, [...worst, ...thin, ...latestAlerts].map((r) => r.variantId));
    const bySeverity = { critical: 0, warning: 0, info: 0 } as Record<string, number>;
    for (const r of severity) bySeverity[r.severity] = r.n;
    return {
      ...base,
      profit: {
        ...profit!,
        byChannel,
        lossMakingVariants: worst.map((r) => profitView(r, r.variantId ? locals.get(r.variantId) : undefined)),
        thinMarginVariants: thin.map((r) => profitView(r, r.variantId ? locals.get(r.variantId) : undefined)),
      },
      suggestions: suggestions!,
      alerts: {
        open: Object.values(bySeverity).reduce((a, b) => a + b, 0),
        bySeverity,
        latest: latestAlerts.map((r) => alertView(r, r.variantId ? locals.get(r.variantId) : undefined)),
      },
      competitors: competitors!,
    };
  });
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export const karmatikVariantsQuerySchema = listQuerySchema.extend({
  filter: z.enum(["all", "loss_making", "thin_margin", "unmatched"]).default("all"),
  channel: tokenSchema.optional(),
  variantId: z.uuid().optional(),
});

/** Kârmatik profitability rows joined to the local variants they matched (§6.2). */
export async function listKarmatikVariants(deps: EkosistemServerDeps, ctx: StoreContext, q: z.infer<typeof karmatikVariantsQuerySchema>) {
  assertCan(ctx, "karmatik:read");
  const link = await requireActiveLink(deps, ctx, "karmatik");
  return withTenantTx(deps.db, tenantScope(ctx), async (tx) => {
    const conditions: SQL[] = [eq(s.linkId, link.id)];
    if (q.filter === "loss_making") conditions.push(lossSql);
    if (q.filter === "thin_margin") conditions.push(thinSql);
    if (q.filter === "unmatched") conditions.push(isNull(s.variantId));
    if (q.channel) conditions.push(eq(s.channel, q.channel));
    if (q.variantId) conditions.push(eq(s.variantId, q.variantId));
    const where = and(...conditions);
    const [{ total }] = (await tx.select({ total: sql<number>`count(*)::int` }).from(s).where(where)) as [{ total: number }];
    const rows = await tx.select().from(s).where(where).orderBy(sql`${s.marginBps} asc nulls last`, asc(s.ref)).limit(q.limit).offset(q.offset);
    const locals = await loadLocalVariants(tx, ctx, rows.map((r) => r.variantId));
    return { items: rows.map((r) => profitView(r, r.variantId ? locals.get(r.variantId) : undefined)), total, limit: q.limit, offset: q.offset };
  });
}

export const karmatikSuggestionsQuerySchema = listQuerySchema.extend({
  status: z.enum(["new", "applied", "dismissed", "all"]).default("new"),
  channel: tokenSchema.optional(),
});

export async function listKarmatikSuggestions(deps: EkosistemServerDeps, ctx: StoreContext, q: z.infer<typeof karmatikSuggestionsQuerySchema>) {
  assertCan(ctx, "karmatik:read");
  const link = await requireActiveLink(deps, ctx, "karmatik");
  const sg = karmatikPriceSuggestions;
  return withTenantTx(deps.db, tenantScope(ctx), async (tx) => {
    const conditions: SQL[] = [eq(sg.linkId, link.id)];
    if (q.status !== "all") conditions.push(eq(sg.localStatus, q.status));
    if (q.status === "new") conditions.push(eq(sg.peerStatus, "open"));
    if (q.channel) conditions.push(eq(sg.channel, q.channel));
    const where = and(...conditions);
    const [{ total }] = (await tx.select({ total: sql<number>`count(*)::int` }).from(sg).where(where)) as [{ total: number }];
    const rows = await tx.select().from(sg).where(where).orderBy(desc(sg.peerUpdatedAt), asc(sg.ref)).limit(q.limit).offset(q.offset);
    const locals = await loadLocalVariants(tx, ctx, rows.map((r) => r.variantId));
    return { items: rows.map((r) => suggestionView(r, r.variantId ? locals.get(r.variantId) : undefined)), total, limit: q.limit, offset: q.offset };
  });
}

export const karmatikAlertsQuerySchema = listQuerySchema.extend({
  status: z.enum(["open", "resolved", "all"]).default("open"),
  severity: z.enum(["info", "warning", "critical"]).optional(),
  type: z.enum(["loss_making", "thin_margin", "missing_cost", "buybox_lost", "competitor_price_drop", "high_return", "other"]).optional(),
});

export async function listKarmatikAlerts(deps: EkosistemServerDeps, ctx: StoreContext, q: z.infer<typeof karmatikAlertsQuerySchema>) {
  assertCan(ctx, "karmatik:read");
  const link = await requireActiveLink(deps, ctx, "karmatik");
  const al = karmatikAlerts;
  return withTenantTx(deps.db, tenantScope(ctx), async (tx) => {
    const conditions: SQL[] = [eq(al.linkId, link.id)];
    if (q.status === "open") conditions.push(isNull(al.resolvedAt));
    if (q.status === "resolved") conditions.push(isNotNull(al.resolvedAt));
    if (q.severity) conditions.push(eq(al.severity, q.severity));
    if (q.type) conditions.push(eq(al.type, q.type));
    const where = and(...conditions);
    const [{ total }] = (await tx.select({ total: sql<number>`count(*)::int` }).from(al).where(where)) as [{ total: number }];
    const rows = await tx
      .select()
      .from(al)
      .where(where)
      .orderBy(sql`case ${al.severity} when 'critical' then 0 when 'warning' then 1 else 2 end`, desc(al.peerUpdatedAt), asc(al.ref))
      .limit(q.limit)
      .offset(q.offset);
    const locals = await loadLocalVariants(tx, ctx, rows.map((r) => r.variantId));
    return { items: rows.map((r) => alertView(r, r.variantId ? locals.get(r.variantId) : undefined)), total, limit: q.limit, offset: q.offset };
  });
}

export const karmatikCompetitorsQuerySchema = listQuerySchema.extend({
  variantId: z.uuid().optional(),
  source: tokenSchema.optional(),
});

/** Current competitor offers (§8.4) next to the store's own storefront price. */
export async function listKarmatikCompetitors(deps: EkosistemServerDeps, ctx: StoreContext, q: z.infer<typeof karmatikCompetitorsQuerySchema>) {
  assertCan(ctx, "karmatik:read");
  const link = await requireActiveLink(deps, ctx, "karmatik");
  const cp = karmatikCompetitorPrices;
  return withTenantTx(deps.db, tenantScope(ctx), async (tx) => {
    const conditions: SQL[] = [eq(cp.linkId, link.id)];
    if (q.variantId) conditions.push(eq(cp.variantId, q.variantId));
    if (q.source) conditions.push(eq(cp.source, q.source));
    const where = and(...conditions);
    const [{ total }] = (await tx.select({ total: sql<number>`count(*)::int` }).from(cp).where(where)) as [{ total: number }];
    const rows = await tx.select().from(cp).where(where).orderBy(asc(cp.variantId), asc(cp.price), asc(cp.ref)).limit(q.limit).offset(q.offset);
    const locals = await loadLocalVariants(tx, ctx, rows.map((r) => r.variantId));
    return {
      items: rows.map((r) => {
        const local = r.variantId ? locals.get(r.variantId) : undefined;
        const ours = local?.price && local.price.currency === r.currency ? BigInt(local.price.amount) : null;
        return {
          ref: r.ref,
          sourceRef: r.sourceRef,
          barcode: r.barcode,
          source: r.source,
          seller: r.seller,
          price: money(r.price, r.currency),
          url: r.url,
          inStock: r.inStock,
          observedAt: r.observedAt,
          updatedAt: r.peerUpdatedAt,
          variant: local ?? null,
          /** Competitor price minus our storefront price; negative = they are cheaper. */
          difference: ours === null ? null : money(r.price - ours, r.currency),
        };
      }),
      total,
      limit: q.limit,
      offset: q.offset,
    };
  });
}

// ---------------------------------------------------------------------------
// Suggestion decisions (§8.3)
// ---------------------------------------------------------------------------

export const applySuggestionSchema = z.object({
  /** Price to apply instead of the suggested one: minor units, as storefront prices are stored. */
  price: z.string().regex(/^[1-9]\d{0,14}$/, "errors.ekosistem.invalid_price").optional(),
  /** Profit guard `block`: a below-floor price passes only with campaigns:approve and a reason (§8.7, audited). */
  justification: z.string().trim().min(10).max(1000).optional(),
  /** Profit guard `block` while the check cannot be made: the merchant confirms the save explicitly (§8.7). */
  confirmUnchecked: z.boolean().optional(),
});

async function loadSuggestion(deps: EkosistemServerDeps, ctx: StoreContext, linkId: string, ref: string): Promise<SuggestionRow> {
  const [row] = await withTenantTx(deps.db, tenantScope(ctx), (tx) =>
    tx
      .select()
      .from(karmatikPriceSuggestions)
      .where(and(eq(karmatikPriceSuggestions.linkId, linkId), eq(karmatikPriceSuggestions.storeId, ctx.storeId), eq(karmatikPriceSuggestions.ref, ref))),
  );
  if (!row) throw notFound("ekosistem_suggestion", ref);
  return row;
}

function assertDecidable(row: SuggestionRow): void {
  // altyapi acts only on suggestions for the linked web store (§8.3).
  if (row.channel !== "web") throw invalid("errors.ekosistem.suggestion_channel_not_web", { channel: row.channel });
  if (row.peerStatus !== "open" || row.localStatus !== "new") {
    throw new AppError("precondition_failed", "errors.ekosistem.suggestion_not_open", { peerStatus: row.peerStatus, status: row.localStatus });
  }
}

function priceApplied(outcome: WriteOutcome): boolean {
  if (outcome.mode === "advice") return false;
  return outcome.results.length > 0 && outcome.results.every((r) => r.ok);
}

/** Current compare-at price of the variant on the base price list, kept as the strike-through price. */
async function baseCompareAt(deps: EkosistemServerDeps, ctx: StoreContext, variantId: string): Promise<bigint | null> {
  const [row] = await withTenantTx(deps.db, tenantScope(ctx), (tx) =>
    tx
      .select({ compareAt: moneyAmounts.compareAtAmount })
      .from(moneyAmounts)
      .innerJoin(priceLists, eq(priceLists.id, moneyAmounts.priceListId))
      .where(
        and(
          eq(priceLists.storeId, ctx.storeId),
          eq(priceLists.kind, "base"),
          eq(priceLists.currency, ctx.store.defaultCurrency),
          eq(moneyAmounts.variantId, variantId),
          eq(moneyAmounts.minQuantity, 1),
        ),
      ),
  );
  return row?.compareAt ?? null;
}

/** Sends a fresh decision right away; on failure it stays pending for the worker. Returns the current row. */
async function deliverNow(deps: EkosistemServerDeps, ctx: StoreContext, link: LinkRow, suggestionId: string): Promise<SuggestionRow> {
  const read = async () => {
    const [row] = await withTenantTx(deps.db, tenantScope(ctx), (tx) => tx.select().from(karmatikPriceSuggestions).where(eq(karmatikPriceSuggestions.id, suggestionId)));
    return row!;
  };
  const row = await read();
  if (row.decisionDeliveryStatus !== "pending") return row;
  try {
    await sendDecision(deps, link, row);
  } catch (err) {
    // The merchant's action already happened; the worker retries pending decisions.
    deps.logger.warn({ err, suggestionId }, "ekosistem decision could not be sent now");
  }
  return read();
}

/**
 * Applies a Kârmatik web-channel suggestion: the price is written through the
 * ownership-aware price write (altyapi, or the integrator that owns prices). When the price
 * owner is elsewhere nothing is written and the merchant gets the owner's advice. After a
 * successful write the decision `applied` goes to Kârmatik with an idempotency id.
 */
export async function applyKarmatikSuggestion(deps: EkosistemServerDeps, ctx: StoreContext, ref: string, input: z.infer<typeof applySuggestionSchema>) {
  assertCan(ctx, "karmatik:read");
  assertCan(ctx, "pricing:write");
  const link = await requireActiveLink(deps, ctx, "karmatik");
  const row = await loadSuggestion(deps, ctx, link.id, ref);
  assertDecidable(row);
  if (!row.variantId) throw new AppError("precondition_failed", "errors.ekosistem.suggestion_unmatched", { ref });
  if (row.currency !== ctx.store.defaultCurrency) throw invalid("errors.ekosistem.currency_mismatch", { currency: row.currency, storeCurrency: ctx.store.defaultCurrency });
  const price = input.price ? BigInt(input.price) : row.suggestedPrice;
  if (price <= 0n) throw invalid("errors.ekosistem.invalid_price");
  const variantId = row.variantId;

  // The store's profit guard applies to this price change on the server too (§8.7): with
  // `block` a below-floor price is refused unless a campaigns:approve user gives a reason
  // (profitCheck audits the override), and an unavailable check needs explicit confirmation.
  const settings = await withTenantTx(deps.db, tenantScope(ctx), (tx) => loadEkosistemSettings(tx, ctx.storeId));
  let profitGuard: ProfitCheckResult | null = null;
  if (settings.profitGuard === "block") {
    profitGuard = await profitCheck(deps, ctx, {
      action: "price_change",
      lines: [{ variantId, quantity: 1, unitPrice: price.toString() }],
      ...(input.justification ? { justification: input.justification } : {}),
    });
    const line = profitGuard.lines[0];
    if (profitGuard.decision === "block") {
      throw new AppError("precondition_failed", "errors.ekosistem.profit_guard_blocked", { ref, floorPrice: line?.floorPrice ?? null, canOverride: profitGuard.canOverride });
    }
    if (profitGuard.requiresConfirmation && input.confirmUnchecked !== true) {
      throw new AppError("precondition_failed", "errors.ekosistem.profit_guard_confirmation_required", { ref, unavailable: profitGuard.unavailable });
    }
  }

  // Claim the suggestion first so two concurrent applies cannot both write a price.
  const decisionId = newId();
  const now = new Date();
  const [claimed] = await withTenantTx(deps.db, tenantScope(ctx), (tx) =>
    tx
      .update(karmatikPriceSuggestions)
      .set({ localStatus: "applied", decidedByUserId: ctx.principal.userId, decidedAt: now, decisionId, decisionAppliedPrice: price, decisionDeliveryStatus: null, decisionAttempts: 0, decisionLastError: null })
      .where(and(eq(karmatikPriceSuggestions.id, row.id), eq(karmatikPriceSuggestions.localStatus, "new")))
      .returning(),
  );
  if (!claimed) throw conflict("errors.ekosistem.suggestion_changed", { ref });

  const unclaim = () =>
    withTenantTx(deps.db, tenantScope(ctx), (tx) =>
      tx
        .update(karmatikPriceSuggestions)
        .set({ localStatus: "new", decidedByUserId: null, decidedAt: null, decisionId: null, decisionAppliedPrice: null })
        .where(and(eq(karmatikPriceSuggestions.id, row.id), eq(karmatikPriceSuggestions.decisionId, decisionId))),
    );

  let outcome: WriteOutcome;
  try {
    const listPrice = await baseCompareAt(deps, ctx, variantId);
    const integrationDeps: IntegrationDeps = { db: deps.db, keys: deps.keys, redis: deps.redis, logger: deps.logger };
    outcome = await writePrices(integrationDeps, ctx, { items: [{ variantId, price, listPrice }] });
  } catch (err) {
    await unclaim();
    throw err;
  }
  if (!priceApplied(outcome)) {
    await unclaim();
    const [fresh] = await withTenantTx(deps.db, tenantScope(ctx), (tx) => tx.select().from(karmatikPriceSuggestions).where(eq(karmatikPriceSuggestions.id, row.id)));
    const locals = await withTenantTx(deps.db, tenantScope(ctx), (tx) => loadLocalVariants(tx, ctx, [variantId]));
    return { applied: false, write: outcome, suggestion: suggestionView(fresh ?? row, locals.get(variantId)), profitGuard };
  }

  const decide = link.peerScopes.includes("pricing:decide");
  await withTenantTx(deps.db, tenantScope(ctx), async (tx) => {
    await tx
      .update(karmatikPriceSuggestions)
      .set(decide ? { decisionDeliveryStatus: "pending", decisionNextAttemptAt: now } : { decisionDeliveryStatus: null, decisionLastError: "scope_missing" })
      .where(eq(karmatikPriceSuggestions.id, row.id));
    await recordAudit(tx, {
      action: "ekosistem.suggestion_applied",
      resourceType: "karmatik_price_suggestion",
      resourceId: row.id,
      before: { price: row.currentPrice, currency: row.currency },
      after: { ref, variantId, price, suggestedPrice: row.suggestedPrice, writeMode: outcome.mode, decisionId },
    });
  });
  const final = await deliverNow(deps, ctx, link, row.id);
  const locals = await withTenantTx(deps.db, tenantScope(ctx), (tx) => loadLocalVariants(tx, ctx, [variantId]));
  return { applied: true, write: outcome, suggestion: suggestionView(final, locals.get(variantId)), profitGuard };
}

/** Dismisses a web-channel suggestion; Kârmatik is told `dismissed` (pricing:decide). */
export async function dismissKarmatikSuggestion(deps: EkosistemServerDeps, ctx: StoreContext, ref: string) {
  assertCan(ctx, "karmatik:read");
  assertCan(ctx, "pricing:write");
  const link = await requireActiveLink(deps, ctx, "karmatik");
  const row = await loadSuggestion(deps, ctx, link.id, ref);
  assertDecidable(row);
  const decide = link.peerScopes.includes("pricing:decide");
  const now = new Date();
  await withTenantTx(deps.db, tenantScope(ctx), async (tx) => {
    const [claimed] = await tx
      .update(karmatikPriceSuggestions)
      .set({
        localStatus: "dismissed",
        decidedByUserId: ctx.principal.userId,
        decidedAt: now,
        decisionId: newId(),
        decisionAppliedPrice: null,
        decisionAttempts: 0,
        ...(decide ? { decisionDeliveryStatus: "pending" as const, decisionNextAttemptAt: now, decisionLastError: null } : { decisionDeliveryStatus: null, decisionLastError: "scope_missing" }),
      })
      .where(and(eq(karmatikPriceSuggestions.id, row.id), eq(karmatikPriceSuggestions.localStatus, "new")))
      .returning({ id: karmatikPriceSuggestions.id });
    if (!claimed) throw conflict("errors.ekosistem.suggestion_changed", { ref });
    await recordAudit(tx, { action: "ekosistem.suggestion_dismissed", resourceType: "karmatik_price_suggestion", resourceId: row.id, after: { ref, suggestedPrice: row.suggestedPrice } });
  });
  const final = await deliverNow(deps, ctx, link, row.id);
  const locals = await withTenantTx(deps.db, tenantScope(ctx), (tx) => loadLocalVariants(tx, ctx, [row.variantId]));
  return { suggestion: suggestionView(final, row.variantId ? locals.get(row.variantId) : undefined) };
}
