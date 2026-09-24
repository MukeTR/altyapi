import { pgArray, pgTimestamp, sql, type SQL, type Transaction } from "@altyapi/database";
import { currentContext } from "@altyapi/observability";
import {
  compareListRank,
  loadPriceListRules,
  rankApplicableLists,
  resolveFromLists,
  servesAudience,
  type PriceContext,
  type PriceListKind,
  type PriceListRules,
} from "./resolver";

/**
 * Ticari Reklam Yönetmeliği: the previous price shown next to a discounted price is the
 * lowest price applied during this many days before the discount started. The day count is
 * a rule parameter that still awaits legal verification (docs/platform/site-turleri-ve-cms.md
 * §6); every previous-price computation reads it from here.
 */
export const PREVIOUS_PRICE_LOOKBACK_DAYS = 30;

type Scope = { organizationId: string; storeId: string };

/** History source for a write, from the principal of the running operation. */
export function priceSourceFromContext(): string {
  switch (currentContext()?.principalType) {
    case "user":
      return "manual";
    case "api_client":
      return "api";
    case "agent":
      return "agent";
    default:
      return "system";
  }
}

/**
 * Reconciles price_history with the current quantity-1 entries of one price list: an open
 * period whose amount no longer matches the entry (changed, removed, list inactive) is
 * closed, and an entry without an open period gets one starting at the same instant. An
 * unchanged amount leaves its period untouched. Must run in the transaction that wrote
 * money_amounts; the row locks taken by that write serialize concurrent writers of the
 * same entry. Omitting variantIds reconciles the whole list.
 */
export async function syncPriceHistory(
  tx: Transaction,
  scope: Scope,
  priceListId: string,
  variantIds?: string[],
  source: string = priceSourceFromContext(),
): Promise<void> {
  if (variantIds && !variantIds.length) return;
  const onVariants = (alias: string) => (variantIds ? sql`and ${sql.raw(alias)}.variant_id = any(${pgArray(variantIds, "uuid")})` : sql``);
  // One boundary instant for the batch, strictly after every period it may close, so the
  // closed and the new period meet exactly. Carried as text to keep microsecond precision.
  const [boundary] = await tx.execute<{ at: string }>(sql`
    select greatest(
      clock_timestamp(),
      (select max(ph.valid_from) + interval '1 microsecond' from price_history ph
        where ph.price_list_id = ${priceListId} and ph.valid_to is null ${onVariants("ph")})
    )::text as at`);
  const at = sql`${boundary!.at}::timestamptz`;
  await tx.execute(sql`
    update price_history ph set valid_to = ${at}
     where ph.price_list_id = ${priceListId} and ph.valid_to is null ${onVariants("ph")}
       and not exists (
         select 1 from money_amounts ma join price_lists pl on pl.id = ma.price_list_id and pl.is_active
          where ma.price_list_id = ph.price_list_id and ma.variant_id = ph.variant_id
            and ma.min_quantity = 1 and ma.amount = ph.amount_minor)`);
  await tx.execute(sql`
    insert into price_history (id, organization_id, store_id, variant_id, price_list_id, currency, amount_minor, valid_from, source)
    select gen_random_uuid(), ${scope.organizationId}, ${scope.storeId}, ma.variant_id, ma.price_list_id, pl.currency, ma.amount, ${at}, ${source}
      from money_amounts ma join price_lists pl on pl.id = ma.price_list_id and pl.is_active
     where ma.price_list_id = ${priceListId} and ma.store_id = ${scope.storeId} and ma.min_quantity = 1 ${onVariants("ma")}
       and not exists (
         select 1 from price_history ph
          where ph.price_list_id = ma.price_list_id and ph.variant_id = ma.variant_id and ph.valid_to is null)`);
}

/**
 * Closes every open period of a list that is about to be deleted. The rows stay (their
 * price_list_id becomes null) because the prices were applied and still count as previous
 * prices within the lookback window.
 */
export async function closePriceListHistory(tx: Transaction, priceListId: string): Promise<void> {
  await tx.execute(sql`
    update price_history set valid_to = greatest(clock_timestamp(), valid_from + interval '1 microsecond')
     where price_list_id = ${priceListId} and valid_to is null`);
}

interface ReferenceScope {
  storeId: string;
  currency: string;
  /** Lists whose prices reach this context, active or not (audience only, schedule windows are checked per period). */
  audience: SQL;
  /** The same lists in resolution order: where two apply, the earlier one is served. */
  order: SQL;
  lookback: SQL;
  /** Evaluation time. */
  at: SQL;
}

/**
 * Discount start of an open period `cur`: when its amount took effect, or later when its list
 * only applies inside schedule windows (the entry may have been written before the window).
 */
const discountStartSql = (cur: string, at: SQL): SQL => sql`greatest(${sql.raw(cur)}.valid_from, coalesce(
  (select min(sp.starts_at) from scheduled_prices sp
    where sp.price_list_id = ${sql.raw(cur)}.price_list_id and sp.starts_at <= ${at}
      and (sp.ends_at is null or sp.ends_at > ${at})),
  ${sql.raw(cur)}.valid_from))`;

/**
 * When the price of the open period `cur` became the served price again: its discount start,
 * moved to the latest moment up to `at` at which a period that takes precedence over cur's
 * list (earlier in resolution order) stopped applying — the period's end or the end of one of
 * its list's schedule windows. Until then that period was served instead (a flash sale, a
 * removed entry, a deleted list), so the run of cur's price being served starts there. A
 * deleted list's rank is unknown; its periods count as taking precedence.
 */
const servedSinceSql = (s: ReferenceScope, cur: string): SQL => {
  const c = sql.raw(cur);
  const start = discountStartSql(cur, s.at);
  const other = sql`h.store_id = ${s.storeId} and h.variant_id = ${c}.variant_id and h.currency = ${s.currency} and h.id <> ${c}.id
    and (h.price_list_id is null or array_position(${s.order}, h.price_list_id) < array_position(${s.order}, ${c}.price_list_id))`;
  return sql`greatest(${start}, (select max(e.ended_at) from (
      select h.valid_to as ended_at from price_history h
       where ${other} and h.valid_to is not null
         and (not exists (select 1 from scheduled_prices sp where sp.price_list_id = h.price_list_id)
              or exists (select 1 from scheduled_prices sp where sp.price_list_id = h.price_list_id
                          and sp.starts_at < h.valid_to and (sp.ends_at is null or sp.ends_at >= h.valid_to)))
      union all
      select sp.ends_at from price_history h join scheduled_prices sp on sp.price_list_id = h.price_list_id
       where ${other} and sp.ends_at > h.valid_from and (h.valid_to is null or sp.ends_at <= h.valid_to)
    ) e where e.ended_at > ${start} and e.ended_at <= ${s.at}))`;
};

/**
 * Periods of `variant` that reached the context: same store and currency, from a list in the
 * audience or from a deleted list (its audience is unknown, so it counts; that can only
 * lower the reference). A period of a list with schedule windows counts only while one was
 * open, i.e. when a window overlaps [from, to).
 */
const appliedPeriodSql = (s: ReferenceScope, variant: SQL, from: SQL, to: SQL): SQL => sql`
  h.store_id = ${s.storeId} and h.variant_id = ${variant} and h.currency = ${s.currency}
  and (h.price_list_id is null or h.price_list_id = any(${s.audience}))
  and (not exists (select 1 from scheduled_prices sp where sp.price_list_id = h.price_list_id)
       or exists (select 1 from scheduled_prices sp where sp.price_list_id = h.price_list_id
                   and sp.starts_at < ${to} and (sp.ends_at is null or sp.ends_at > ${from})))`;

/**
 * Reference (previous) price of `variant` whose open period `cur` has been served since
 * `start` (servedSinceSql): the lowest amount applied at any time in [start - lookback, start),
 * and never more than any other price applied since then (a lower price in the context after
 * `start` means the current one is no discount). Null unless the history already covered the
 * window start, so a price without a full lookback window of history never shows a previous
 * price: new products, and every entry written before price_history existed until its amount
 * next changes (the migration opened those periods at deploy time, and what applied before is
 * unknown).
 */
function referenceAmountSql(s: ReferenceScope, variant: SQL, start: SQL, cur: string): SQL {
  const windowStart = sql`(${start} - ${s.lookback})`;
  const covered = sql`exists (select 1 from price_history h
    where ${appliedPeriodSql(s, variant, windowStart, sql`${windowStart} + interval '1 microsecond'`)}
      and h.valid_from <= ${windowStart} and (h.valid_to is null or h.valid_to > ${windowStart}))`;
  const before = sql`(select min(h.amount_minor) from price_history h
    where ${appliedPeriodSql(s, variant, sql`greatest(${windowStart}, h.valid_from)`, sql`least(${start}, coalesce(h.valid_to, ${start}))`)}
      and h.valid_from < ${start} and (h.valid_to is null or h.valid_to > ${windowStart}))`;
  const since = sql`(select min(h.amount_minor) from price_history h
    where h.id <> ${sql.raw(cur)}.id
      and ${appliedPeriodSql(s, variant, sql`greatest(${start}, h.valid_from)`, sql`least(${s.at}, coalesce(h.valid_to, ${s.at}))`)}
      and h.valid_from < ${s.at} and (h.valid_to is null or h.valid_to > ${start}))`;
  return sql`case when ${covered} then least(${before}, ${since}) end`;
}

/** History scope of a context; rules must be loaded with inactive lists (loadPriceListRules includeInactive). */
const scopeFor = (rules: PriceListRules, ctx: PriceContext, lookbackDays: number): ReferenceScope => {
  const audience = rules.lists.filter((l) => servesAudience(rules, l, ctx)).sort(compareListRank);
  const ids = pgArray(
    audience.map((l) => l.id),
    "uuid",
  );
  return {
    storeId: ctx.storeId,
    currency: ctx.currency,
    audience: ids,
    order: ids,
    lookback: sql`make_interval(days => ${lookbackDays})`,
    at: pgTimestamp(ctx.at ?? new Date()),
  };
};

const historyRules = (tx: Transaction, ctx: PriceContext) => loadPriceListRules(tx, ctx, { includeInactive: true });

export interface ReferencePrice {
  variantId: string;
  /** When the current price became the served price (the start of the discount). */
  discountStart: Date;
  /** Lowest price applied in the lookback window before discountStart (and since); null without enough history. */
  amount: bigint | null;
}

/**
 * Batch reference lookup: one query for all requested variants, each identified with the
 * list that serves its current quantity-1 price. Variants whose current entry has no open
 * history period are left out. `rules`, when given, must include inactive lists.
 */
export async function referencePrices(
  tx: Transaction,
  ctx: PriceContext,
  items: { variantId: string; priceListId: string }[],
  lookbackDays: number = PREVIOUS_PRICE_LOOKBACK_DAYS,
  rules?: PriceListRules,
): Promise<Map<string, ReferencePrice>> {
  const out = new Map<string, ReferencePrice>();
  if (!items.length) return out;
  const s = scopeFor(rules ?? (await historyRules(tx, ctx)), ctx, lookbackDays);
  const rows = await tx.execute<{ variant_id: string; discount_start: Date; amount: bigint | null }>(sql`
    select req.variant_id, x.discount_start, ${referenceAmountSql(s, sql`req.variant_id`, sql`x.discount_start`, "cur")} as amount
      from unnest(${pgArray(items.map((i) => i.variantId), "uuid")}, ${pgArray(items.map((i) => i.priceListId), "uuid")}) as req(variant_id, price_list_id)
      join price_history cur on cur.price_list_id = req.price_list_id and cur.variant_id = req.variant_id and cur.valid_to is null
                            and cur.store_id = ${ctx.storeId} and cur.currency = ${ctx.currency}
      cross join lateral (select ${servedSinceSql(s, "cur")} as discount_start) x`);
  for (const r of rows) {
    out.set(r.variant_id, {
      variantId: r.variant_id,
      discountStart: new Date(r.discount_start),
      amount: r.amount === null ? null : BigInt(r.amount),
    });
  }
  return out;
}

/** A price as shown to shoppers. */
export interface DisplayPrice {
  variantId: string;
  currency: string;
  amount: bigint;
  /**
   * Previous price for a strike-through: the price_history reference, only when greater than
   * amount. The merchant-typed compare-at is deliberately not part of a display price.
   */
  previousAmount: bigint | null;
  priceListId: string;
  priceListKind: PriceListKind;
  minQuantity: number;
}

/**
 * resolvePrices for shopper-facing displays (storefront DTOs): the same deterministic price,
 * with the previous price derived from price_history instead of the typed compare-at. Two
 * queries beyond the list rules regardless of the number of variants.
 */
export async function resolveDisplayPrices(
  tx: Transaction,
  ctx: PriceContext,
  items: { variantId: string; quantity?: number }[],
  lookbackDays: number = PREVIOUS_PRICE_LOOKBACK_DAYS,
): Promise<Map<string, DisplayPrice>> {
  const out = new Map<string, DisplayPrice>();
  if (!items.length) return out;
  const rules = await historyRules(tx, ctx);
  const resolved = await resolveFromLists(tx, ctx, rankApplicableLists(rules, ctx), items);
  // Quantity tiers are volume pricing, not a reduction of the advertised unit price.
  const unit = [...resolved.values()].filter((p) => p.minQuantity === 1);
  const refs = await referencePrices(tx, ctx, unit.map((p) => ({ variantId: p.variantId, priceListId: p.priceListId })), lookbackDays, rules);
  for (const p of resolved.values()) {
    const ref = p.minQuantity === 1 ? (refs.get(p.variantId)?.amount ?? null) : null;
    out.set(p.variantId, {
      variantId: p.variantId,
      currency: p.currency,
      amount: p.amount,
      previousAmount: ref !== null && ref > p.amount ? ref : null,
      priceListId: p.priceListId,
      priceListKind: p.priceListKind,
      minQuantity: p.minQuantity,
    });
  }
  return out;
}

/**
 * SQL predicate over a variant id expression, for listing filters: true when the variant's
 * current quantity-1 price in the context shows a previous price, by the same rule as
 * resolveDisplayPrices. The serving price is the open period of the first applicable list in
 * resolution order, which mirrors the resolver because open periods mirror the entries.
 */
export async function discountedVariantSql(
  tx: Transaction,
  ctx: PriceContext,
  variantId: SQL,
  lookbackDays: number = PREVIOUS_PRICE_LOOKBACK_DAYS,
): Promise<SQL> {
  const rules = await historyRules(tx, ctx);
  const ranked = rankApplicableLists(rules, ctx).map((l) => l.id);
  if (!ranked.length) return sql`false`;
  const s = scopeFor(rules, ctx, lookbackDays);
  const serving = pgArray(ranked, "uuid");
  return sql`exists (
    select 1 from (
      select ph.id, ph.variant_id, ph.price_list_id, ph.amount_minor, ph.valid_from from price_history ph
       where ph.variant_id = ${variantId} and ph.valid_to is null and ph.price_list_id = any(${serving})
       order by array_position(${serving}, ph.price_list_id) limit 1
    ) cur
    cross join lateral (select ${servedSinceSql(s, "cur")} as discount_start) x
    where ${referenceAmountSql(s, variantId, sql`x.discount_start`, "cur")} > cur.amount_minor)`;
}
