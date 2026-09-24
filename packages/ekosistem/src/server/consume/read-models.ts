import { newId } from "@altyapi/commerce-core";
import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  karmatikAlerts,
  karmatikCompetitorPrices,
  karmatikPriceSuggestions,
  karmatikProfitSnapshots,
  notInArray,
  or,
  productVariants,
  yanitCitations,
  yanitGaps,
  yanitOpportunities,
  yanitVisibilitySnapshots,
  type Transaction,
} from "@altyapi/database";
import { appendEvent } from "@altyapi/events";
import { ratioToBps } from "../../money";
import type {
  KarmatikAlert,
  KarmatikCompetitorPrice,
  KarmatikProfitSummary,
  KarmatikProfitVariant,
  KarmatikSuggestion,
  Tombstone,
  YanitCitation,
  YanitGap,
  YanitOpportunity,
  YanitVisibilitySummary,
} from "../../schemas";
import type { LinkRow } from "../common";

/**
 * Local read models of what altyapi pulls from Kârmatik (§8) and Yanıt (§9). Every row is
 * scoped to the link it was pulled with, so revoking a link removes exactly its data. Peer
 * fields are overwritten on each pull; the merchant's own decisions (suggestion and
 * opportunity local status, draft pages) are never touched by a pull.
 */

/** A visibility change of at least this many basis points raises geo.visibility_changed. */
export const VISIBILITY_CHANGE_THRESHOLD_BPS = 1500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toBig = (amount: string | null | undefined): bigint | null => (amount === null || amount === undefined ? null : BigInt(amount));
const asPayload = (value: unknown) => value as Record<string, unknown>;
const scopeOf = (link: LinkRow) => ({ organizationId: link.organizationId, storeId: link.storeId, linkId: link.id });

export interface MatchInput {
  sourceRef: string | null;
  barcode: string | null;
  sku?: string | null;
}

/**
 * Matches peer records to local variants (§6.2): sourceRef (our variant id) → barcode
 * (GTIN) → sku. A barcode or SKU shared by several live variants is ambiguous and matches
 * none of them.
 */
export async function matchVariants(tx: Transaction, storeId: string, items: readonly MatchInput[]): Promise<Array<string | null>> {
  const ids = [...new Set(items.map((i) => i.sourceRef).filter((r): r is string => !!r && UUID_RE.test(r)).map((r) => r.toLowerCase()))];
  const barcodes = [...new Set(items.map((i) => i.barcode).filter((b): b is string => !!b))];
  const skus = [...new Set(items.map((i) => i.sku).filter((s): s is string => !!s))];
  if (!ids.length && !barcodes.length && !skus.length) return items.map(() => null);
  const conditions = [
    ...(ids.length ? [inArray(productVariants.id, ids)] : []),
    ...(barcodes.length ? [inArray(productVariants.barcode, barcodes)] : []),
    ...(skus.length ? [inArray(productVariants.sku, skus)] : []),
  ];
  const rows = await tx
    .select({ id: productVariants.id, barcode: productVariants.barcode, sku: productVariants.sku })
    .from(productVariants)
    .where(and(eq(productVariants.storeId, storeId), isNull(productVariants.archivedAt), or(...conditions)));
  return items.map((i) => {
    const bySource = i.sourceRef ? rows.find((r) => r.id === i.sourceRef!.toLowerCase()) : undefined;
    if (bySource) return bySource.id;
    const byBarcode = i.barcode ? rows.filter((r) => r.barcode === i.barcode) : [];
    if (byBarcode.length === 1) return byBarcode[0]!.id;
    const bySku = i.sku ? rows.filter((r) => r.sku === i.sku) : [];
    return bySku.length === 1 ? bySku[0]!.id : null;
  });
}

async function productIdsOf(tx: Transaction, variantIds: string[]): Promise<Map<string, string>> {
  if (!variantIds.length) return new Map();
  const rows = await tx.select({ id: productVariants.id, productId: productVariants.productId }).from(productVariants).where(inArray(productVariants.id, variantIds));
  return new Map(rows.map((r) => [r.id, r.productId]));
}

// ---------------------------------------------------------------------------
// Kârmatik §8.2 profitability
// ---------------------------------------------------------------------------

type ProfitValues = Omit<typeof karmatikProfitSnapshots.$inferInsert, "id" | "organizationId" | "storeId" | "linkId" | "ref">;

function fullProfitValues(i: KarmatikProfitVariant, variantId: string | null): ProfitValues {
  return {
    sourceRef: i.sourceRef,
    variantId,
    channel: i.channel,
    storeLabel: i.storeLabel,
    barcode: i.barcode,
    sku: i.sku,
    currency: i.price.currency,
    price: BigInt(i.price.amount),
    netProfit: toBig(i.netProfit?.amount),
    marginBps: i.marginBps,
    floorPrice: toBig(i.floorPrice?.amount),
    floorBasis: i.floorBasis,
    minMarginBps: i.minMarginBps,
    safeDiscountBps: i.safeDiscountBps,
    breakEvenPrice: toBig(i.breakEvenPrice?.amount),
    lossMaking: i.lossMaking,
    basis: i.basis,
    missing: i.missing,
    summaryOnly: false,
    peerUpdatedAt: new Date(i.updatedAt),
    payload: asPayload(i),
  };
}

function summaryProfitValues(i: KarmatikProfitSummary, variantId: string | null): ProfitValues {
  return {
    sourceRef: i.sourceRef,
    variantId,
    channel: null,
    storeLabel: null,
    barcode: i.barcode,
    sku: null,
    currency: null,
    price: null,
    netProfit: null,
    marginBps: i.marginBps,
    floorPrice: null,
    floorBasis: null,
    minMarginBps: null,
    safeDiscountBps: null,
    breakEvenPrice: null,
    lossMaking: i.lossMaking,
    basis: null,
    missing: [],
    summaryOnly: true,
    peerUpdatedAt: new Date(i.updatedAt),
    payload: asPayload(i),
  };
}

export interface StoreOptions {
  /**
   * False during the very first full pull of a resource: rows seen for the first time are
   * then existing state, not changes, and raise no internal events.
   */
  detectNew: boolean;
}

/**
 * Upserts §8.2 rows (full or summary) and raises profit.margin_breached when a row newly
 * becomes loss-making or its safe discount drops to 0.
 */
export async function storeProfit(
  tx: Transaction,
  link: LinkRow,
  rows: Array<{ kind: "full"; item: KarmatikProfitVariant } | { kind: "summary"; item: KarmatikProfitSummary }>,
  opts: StoreOptions,
): Promise<{ upserted: number; breaches: number }> {
  if (!rows.length) return { upserted: 0, breaches: 0 };
  const matched = await matchVariants(
    tx,
    link.storeId,
    rows.map((r) => ({ sourceRef: r.item.sourceRef, barcode: r.item.barcode, sku: r.kind === "full" ? r.item.sku : null })),
  );
  const previous = await tx
    .select({ ref: karmatikProfitSnapshots.ref, lossMaking: karmatikProfitSnapshots.lossMaking, safeDiscountBps: karmatikProfitSnapshots.safeDiscountBps })
    .from(karmatikProfitSnapshots)
    .where(and(eq(karmatikProfitSnapshots.linkId, link.id), inArray(karmatikProfitSnapshots.ref, rows.map((r) => r.item.ref))));
  const before = new Map(previous.map((p) => [p.ref, p]));

  const breaches: Array<{ snapshotId: string; values: ProfitValues; ref: string; reason: "loss_making" | "no_safe_discount" }> = [];
  for (const [idx, r] of rows.entries()) {
    const values = r.kind === "full" ? fullProfitValues(r.item, matched[idx] ?? null) : summaryProfitValues(r.item, matched[idx] ?? null);
    const [row] = await tx
      .insert(karmatikProfitSnapshots)
      .values({ id: newId(), ...scopeOf(link), ref: r.item.ref, ...values })
      .onConflictDoUpdate({ target: [karmatikProfitSnapshots.linkId, karmatikProfitSnapshots.ref], set: { ...values, updatedAt: new Date() } })
      .returning({ id: karmatikProfitSnapshots.id });
    const prev = before.get(r.item.ref);
    let reason: "loss_making" | "no_safe_discount" | null = null;
    if (values.lossMaking === true && (prev ? prev.lossMaking !== true : opts.detectNew)) reason = "loss_making";
    else if (values.safeDiscountBps === 0 && prev && prev.safeDiscountBps !== null && prev.safeDiscountBps > 0) reason = "no_safe_discount";
    if (reason && row) breaches.push({ snapshotId: row.id, values, ref: r.item.ref, reason });
  }

  let raised = 0;
  if (breaches.length) {
    const products = await productIdsOf(tx, breaches.map((b) => b.values.variantId).filter((v): v is string => !!v));
    for (const b of breaches) {
      // The event carries a margin; without one from Kârmatik there is nothing truthful to report.
      if (b.values.marginBps === null || b.values.marginBps === undefined) continue;
      const variantId = b.values.variantId ?? null;
      await appendEvent(tx, {
        type: "profit.margin_breached",
        organizationId: link.organizationId,
        storeId: link.storeId,
        aggregateType: "karmatik_profit_snapshot",
        aggregateId: b.snapshotId,
        payload: {
          productId: variantId ? (products.get(variantId) ?? null) : null,
          campaignId: null,
          marginBps: b.values.marginBps,
          source: "karmatik",
          reason: b.reason,
          variantId,
          channel: b.values.channel ?? null,
          ref: b.ref,
          linkId: link.id,
        },
      });
      raised++;
    }
  }
  return { upserted: rows.length, breaches: raised };
}

// ---------------------------------------------------------------------------
// Kârmatik §8.3 suggestions, §8.4 competitor prices, §8.5 alerts
// ---------------------------------------------------------------------------

export async function storeSuggestions(tx: Transaction, link: LinkRow, items: KarmatikSuggestion[]): Promise<number> {
  const matched = await matchVariants(tx, link.storeId, items);
  for (const [idx, i] of items.entries()) {
    // Peer-owned fields only; localStatus and the decision columns belong to altyapi.
    const values = {
      sourceRef: i.sourceRef,
      variantId: matched[idx] ?? null,
      channel: i.channel,
      barcode: i.barcode,
      currency: i.currentPrice.currency,
      currentPrice: BigInt(i.currentPrice.amount),
      suggestedPrice: BigInt(i.suggestedPrice.amount),
      reason: i.reason,
      competitorMinPrice: toBig(i.competitorMinPrice?.amount),
      confidenceBps: i.confidence === null ? null : ratioToBps(i.confidence),
      peerStatus: i.status,
      peerCreatedAt: new Date(i.createdAt),
      peerUpdatedAt: new Date(i.updatedAt),
      payload: asPayload(i),
    };
    await tx
      .insert(karmatikPriceSuggestions)
      .values({ id: newId(), ...scopeOf(link), ref: i.ref, ...values })
      .onConflictDoUpdate({ target: [karmatikPriceSuggestions.linkId, karmatikPriceSuggestions.ref], set: { ...values, updatedAt: new Date() } });
  }
  return items.length;
}

export async function storeCompetitorPrices(tx: Transaction, link: LinkRow, items: KarmatikCompetitorPrice[]): Promise<number> {
  const matched = await matchVariants(tx, link.storeId, items);
  for (const [idx, i] of items.entries()) {
    const values = {
      sourceRef: i.sourceRef,
      barcode: i.barcode,
      variantId: matched[idx] ?? null,
      source: i.source,
      seller: i.seller,
      currency: i.price.currency,
      price: BigInt(i.price.amount),
      url: i.url,
      inStock: i.inStock,
      observedAt: new Date(i.observedAt),
      peerUpdatedAt: new Date(i.updatedAt),
      payload: asPayload(i),
    };
    await tx
      .insert(karmatikCompetitorPrices)
      .values({ id: newId(), ...scopeOf(link), ref: i.ref, ...values })
      .onConflictDoUpdate({ target: [karmatikCompetitorPrices.linkId, karmatikCompetitorPrices.ref], set: { ...values, updatedAt: new Date() } });
  }
  return items.length;
}

export async function storeAlerts(tx: Transaction, link: LinkRow, items: KarmatikAlert[]): Promise<number> {
  const matched = await matchVariants(tx, link.storeId, items);
  for (const [idx, i] of items.entries()) {
    const values = {
      channel: i.channel,
      storeLabel: i.storeLabel,
      type: i.type,
      severity: i.severity,
      barcode: i.barcode,
      sourceRef: i.sourceRef,
      variantId: matched[idx] ?? null,
      title: i.title,
      body: i.body,
      currency: i.impactMonthly?.currency ?? null,
      impactMonthly: toBig(i.impactMonthly?.amount),
      peerCreatedAt: new Date(i.createdAt),
      peerUpdatedAt: new Date(i.updatedAt),
      resolvedAt: i.resolvedAt ? new Date(i.resolvedAt) : null,
      payload: asPayload(i),
    };
    await tx
      .insert(karmatikAlerts)
      .values({ id: newId(), ...scopeOf(link), ref: i.ref, ...values })
      .onConflictDoUpdate({ target: [karmatikAlerts.linkId, karmatikAlerts.ref], set: { ...values, updatedAt: new Date() } });
  }
  return items.length;
}

// ---------------------------------------------------------------------------
// Yanıt §9.3 opportunities (incremental)
// ---------------------------------------------------------------------------

export async function storeOpportunities(tx: Transaction, link: LinkRow, items: YanitOpportunity[]): Promise<number> {
  for (const i of items) {
    // localStatus and draftPageId are the merchant's; a pull never resets them.
    const values = {
      kind: i.kind,
      sourceKind: i.sourceKind,
      title: i.title,
      body: i.body,
      query: i.query,
      targetUrl: i.targetUrl,
      impact: i.impact,
      peerStatus: i.status,
      peerCreatedAt: new Date(i.createdAt),
      peerUpdatedAt: new Date(i.updatedAt),
      payload: asPayload(i),
    };
    await tx
      .insert(yanitOpportunities)
      .values({ id: newId(), ...scopeOf(link), ref: i.ref, ...values })
      .onConflictDoUpdate({ target: [yanitOpportunities.linkId, yanitOpportunities.ref], set: { ...values, updatedAt: new Date() } });
  }
  return items.length;
}

// ---------------------------------------------------------------------------
// Tombstones of incremental resources
// ---------------------------------------------------------------------------

const TOMBSTONE_TABLES = {
  profit: karmatikProfitSnapshots,
  suggestions: karmatikPriceSuggestions,
  competitors: karmatikCompetitorPrices,
  alerts: karmatikAlerts,
  opportunities: yanitOpportunities,
} as const;

export type IncrementalReadModel = keyof typeof TOMBSTONE_TABLES;

export async function deleteTombstoned(tx: Transaction, link: LinkRow, model: IncrementalReadModel, tombstones: readonly Tombstone[]): Promise<number> {
  if (!tombstones.length) return 0;
  const table = TOMBSTONE_TABLES[model];
  const deleted = await tx
    .delete(table)
    .where(and(eq(table.linkId, link.id), inArray(table.ref, tombstones.map((t) => t.ref))))
    .returning({ id: table.id });
  return deleted.length;
}

// ---------------------------------------------------------------------------
// Yanıt snapshots (§9.1, §9.2, §9.4): the stored set is replaced by each pull
// ---------------------------------------------------------------------------

export async function replaceGaps(tx: Transaction, link: LinkRow, items: YanitGap[], asOf: Date): Promise<{ upserted: number; deleted: number }> {
  const refs = [...new Set(items.map((i) => i.ref))];
  const removed = await tx
    .delete(yanitGaps)
    .where(and(eq(yanitGaps.linkId, link.id), refs.length ? notInArray(yanitGaps.ref, refs) : undefined))
    .returning({ id: yanitGaps.id });
  for (const i of items) {
    const values = {
      query: i.query,
      providers: i.providers,
      competitorsMentioned: i.competitorsMentioned,
      priority: i.priority,
      intent: i.intent,
      lastRunAt: i.lastRunAt ? new Date(i.lastRunAt) : null,
      asOf,
      payload: asPayload(i),
    };
    await tx
      .insert(yanitGaps)
      .values({ id: newId(), ...scopeOf(link), ref: i.ref, ...values })
      .onConflictDoUpdate({ target: [yanitGaps.linkId, yanitGaps.ref], set: { ...values, updatedAt: new Date() } });
  }
  return { upserted: items.length, deleted: removed.length };
}

export async function replaceCitations(tx: Transaction, link: LinkRow, windowDays: number, items: YanitCitation[], asOf: Date): Promise<{ upserted: number; deleted: number }> {
  const domains = [...new Set(items.map((i) => i.domain))];
  const removed = await tx
    .delete(yanitCitations)
    .where(and(eq(yanitCitations.linkId, link.id), eq(yanitCitations.windowDays, windowDays), domains.length ? notInArray(yanitCitations.domain, domains) : undefined))
    .returning({ id: yanitCitations.id });
  for (const i of items) {
    const values = { count: i.count, shareBps: i.shareBps, sampleUrls: i.sampleUrls, asOf };
    await tx
      .insert(yanitCitations)
      .values({ id: newId(), ...scopeOf(link), windowDays, domain: i.domain, ...values })
      .onConflictDoUpdate({ target: [yanitCitations.linkId, yanitCitations.windowDays, yanitCitations.domain], set: { ...values, updatedAt: new Date() } });
  }
  return { upserted: items.length, deleted: removed.length };
}

/** The measurement a summary describes, without the time it was served. */
function measurementKey(s: YanitVisibilitySummary | Record<string, unknown>): string {
  const { asOf: _asOf, ...rest } = s as Record<string, unknown>;
  return JSON.stringify(rest);
}

/**
 * Keeps §9.1 summaries as history: a new row per distinct measurement (Yanıt updates once a
 * day; hourly pulls of the same measurement add nothing). A change of visibilityBps of at
 * least 1500 bps against the previous stored snapshot raises geo.visibility_changed.
 */
export async function recordVisibility(tx: Transaction, link: LinkRow, summary: YanitVisibilitySummary): Promise<{ inserted: boolean; changed: boolean }> {
  const [prev] = await tx
    .select()
    .from(yanitVisibilitySnapshots)
    .where(and(eq(yanitVisibilitySnapshots.linkId, link.id), eq(yanitVisibilitySnapshots.windowDays, summary.windowDays)))
    .orderBy(desc(yanitVisibilitySnapshots.asOf))
    .limit(1);
  if (prev && measurementKey(prev.payload) === measurementKey(summary)) return { inserted: false, changed: false };
  const [row] = await tx
    .insert(yanitVisibilitySnapshots)
    .values({
      id: newId(),
      ...scopeOf(link),
      windowDays: summary.windowDays,
      validRuns: summary.validRuns,
      runsWithBrand: summary.runsWithBrand,
      visibilityBps: summary.visibilityBps,
      shareOfVoiceBps: summary.shareOfVoiceBps,
      previousBps: summary.trend.previousBps,
      deltaBps: summary.trend.deltaBps,
      lastMeasuredAt: summary.lastMeasuredAt ? new Date(summary.lastMeasuredAt) : null,
      asOf: new Date(summary.asOf),
      payload: asPayload(summary),
    })
    .onConflictDoNothing({ target: [yanitVisibilitySnapshots.linkId, yanitVisibilitySnapshots.windowDays, yanitVisibilitySnapshots.asOf] })
    .returning({ id: yanitVisibilitySnapshots.id });
  if (!row) return { inserted: false, changed: false };
  const changed =
    prev !== undefined &&
    prev.visibilityBps !== null &&
    summary.visibilityBps !== null &&
    Math.abs(summary.visibilityBps - prev.visibilityBps) >= VISIBILITY_CHANGE_THRESHOLD_BPS;
  if (changed) {
    await appendEvent(tx, {
      type: "geo.visibility_changed",
      organizationId: link.organizationId,
      storeId: link.storeId,
      aggregateType: "yanit_visibility_snapshot",
      aggregateId: row.id,
      payload: { snapshotId: row.id, score: summary.visibilityBps!, previousScore: prev!.visibilityBps, source: "yanit", windowDays: summary.windowDays, linkId: link.id },
    });
  }
  return { inserted: true, changed };
}

// ---------------------------------------------------------------------------
// Data removal
// ---------------------------------------------------------------------------

export const READ_MODEL_TABLES = {
  profit: [karmatikProfitSnapshots],
  suggestions: [karmatikPriceSuggestions],
  competitors: [karmatikCompetitorPrices],
  alerts: [karmatikAlerts],
  visibility: [yanitVisibilitySnapshots],
  gaps: [yanitGaps],
  opportunities: [yanitOpportunities],
  citations: [yanitCitations],
} as const;

export type ReadModelName = keyof typeof READ_MODEL_TABLES;

/** Deletes everything a link pulled into one read model; returns the number of rows removed. */
export async function deleteReadModel(tx: Transaction, linkId: string, model: ReadModelName): Promise<number> {
  let n = 0;
  for (const table of READ_MODEL_TABLES[model]) {
    const rows = await tx.delete(table).where(eq(table.linkId, linkId)).returning({ id: table.id });
    n += rows.length;
  }
  return n;
}
