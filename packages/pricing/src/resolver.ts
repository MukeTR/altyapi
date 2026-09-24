import {
  and,
  channelPrices,
  customerGroupPrices,
  eq,
  inArray,
  moneyAmounts,
  priceLists,
  scheduledPrices,
  type Transaction,
} from "@altyapi/database";

export type PriceListKind = "base" | "sale" | "customer_group" | "channel" | "scheduled";

export interface PriceContext {
  storeId: string;
  currency: string;
  channelId?: string | null;
  customerGroupIds?: string[];
  /** Evaluation time for scheduled lists (defaults to now). */
  at?: Date;
  /** Only the base (list) price, ignoring sale/segment lists — used by admin editing. */
  baseOnly?: boolean;
}

export interface ResolvedPrice {
  variantId: string;
  currency: string;
  /** Unit price in minor units for the given quantity. */
  amount: bigint;
  /**
   * Merchant-typed compare-at amount (for a sale/segment list without one, the regular base
   * price), only when greater than amount. Kept as-is for admin editing and existing
   * integrations, but it is not a lawful previous price: the Ticari Reklam rule requires the
   * price shown struck through to come from the prices actually applied. Shopper-facing
   * displays use resolveDisplayPrices (history.ts), whose previousAmount is derived from
   * price_history.
   */
  compareAtAmount: bigint | null;
  priceListId: string;
  priceListKind: PriceListKind;
  minQuantity: number;
}

/** Tie-breaker between lists with equal priority: more specific kinds win. */
const KIND_RANK: Record<PriceListKind, number> = { scheduled: 5, customer_group: 4, channel: 3, sale: 2, base: 1 };

export interface CandidateList {
  id: string;
  kind: PriceListKind;
  priority: number;
  isActive: boolean;
}

/** Resolution order between two lists: priority desc, kind specificity desc, id asc. */
export function compareListRank(a: CandidateList, b: CandidateList): number {
  return b.priority - a.priority || KIND_RANK[b.kind] - KIND_RANK[a.kind] || a.id.localeCompare(b.id);
}

/**
 * Price lists of a store and currency with their channel, customer-group and schedule
 * restrictions: the active ones, or every list when loaded for price history (a deactivated
 * list's prices were applied while it was active).
 */
export interface PriceListRules {
  lists: CandidateList[];
  channelLinks: { priceListId: string; channelId: string }[];
  groupLinks: { priceListId: string; customerGroupId: string }[];
  windows: { priceListId: string; startsAt: Date; endsAt: Date | null }[];
}

export async function loadPriceListRules(tx: Transaction, ctx: PriceContext, opts: { includeInactive?: boolean } = {}): Promise<PriceListRules> {
  const lists = await tx
    .select({ id: priceLists.id, kind: priceLists.kind, priority: priceLists.priority, isActive: priceLists.isActive })
    .from(priceLists)
    .where(and(eq(priceLists.storeId, ctx.storeId), eq(priceLists.currency, ctx.currency), opts.includeInactive ? undefined : eq(priceLists.isActive, true)));
  if (!lists.length) return { lists, channelLinks: [], groupLinks: [], windows: [] };
  const ids = lists.map((l) => l.id);
  const [channelLinks, groupLinks, windows] = await Promise.all([
    tx.select({ priceListId: channelPrices.priceListId, channelId: channelPrices.channelId }).from(channelPrices).where(inArray(channelPrices.priceListId, ids)),
    tx
      .select({ priceListId: customerGroupPrices.priceListId, customerGroupId: customerGroupPrices.customerGroupId })
      .from(customerGroupPrices)
      .where(inArray(customerGroupPrices.priceListId, ids)),
    tx
      .select({ priceListId: scheduledPrices.priceListId, startsAt: scheduledPrices.startsAt, endsAt: scheduledPrices.endsAt })
      .from(scheduledPrices)
      .where(inArray(scheduledPrices.priceListId, ids)),
  ]);
  return { lists, channelLinks, groupLinks, windows };
}

/**
 * Whether a list's audience admits the context, independent of time: a list restricted by
 * channel or customer group applies only when every restriction it has is satisfied, and a
 * channel or customer_group list without its restriction never applies.
 */
export function servesAudience(rules: PriceListRules, list: CandidateList, ctx: PriceContext): boolean {
  if (list.kind === "base") return true;
  if (ctx.baseOnly) return false;
  const ch = rules.channelLinks.filter((c) => c.priceListId === list.id);
  if (ch.length && !(ctx.channelId && ch.some((c) => c.channelId === ctx.channelId))) return false;
  const groups = new Set(ctx.customerGroupIds ?? []);
  const gr = rules.groupLinks.filter((g) => g.priceListId === list.id);
  if (gr.length && !gr.some((g) => groups.has(g.customerGroupId))) return false;
  if (list.kind === "customer_group" && !gr.length) return false;
  if (list.kind === "channel" && !ch.length) return false;
  return true;
}

/** Whether a list is inside one of its schedule windows at `at`; a scheduled list without windows never is. */
export function inSchedule(rules: PriceListRules, list: CandidateList, at: Date): boolean {
  if (list.kind === "base") return true;
  const win = rules.windows.filter((w) => w.priceListId === list.id);
  if (!win.length) return list.kind !== "scheduled";
  return win.some((w) => w.startsAt <= at && (!w.endsAt || w.endsAt > at));
}

/**
 * The active lists applicable to the context right now (or at ctx.at), ordered
 * deterministically (compareListRank).
 */
export function rankApplicableLists(rules: PriceListRules, ctx: PriceContext): CandidateList[] {
  const at = ctx.at ?? new Date();
  return rules.lists.filter((l) => l.isActive && servesAudience(rules, l, ctx) && inSchedule(rules, l, at)).sort(compareListRank);
}

/** Returns the price lists applicable to the context in resolution order (see rankApplicableLists). */
export async function applicableLists(tx: Transaction, ctx: PriceContext): Promise<CandidateList[]> {
  return rankApplicableLists(await loadPriceListRules(tx, ctx), ctx);
}

/**
 * Deterministic unit price resolution. For each variant the first applicable list (in the
 * order above) that has an entry wins; within a list the tier with the highest
 * min_quantity not exceeding the requested quantity is used. Campaign discounts are
 * applied afterwards by the campaign engine on the cart, never here.
 */
export async function resolvePrices(
  tx: Transaction,
  ctx: PriceContext,
  items: { variantId: string; quantity?: number }[],
): Promise<Map<string, ResolvedPrice>> {
  if (!items.length) return new Map();
  return resolveFromLists(tx, ctx, await applicableLists(tx, ctx), items);
}

/** resolvePrices over an already ranked list set (callers that also need the rules load them once). */
export async function resolveFromLists(
  tx: Transaction,
  ctx: PriceContext,
  lists: CandidateList[],
  items: { variantId: string; quantity?: number }[],
): Promise<Map<string, ResolvedPrice>> {
  const result = new Map<string, ResolvedPrice>();
  if (!items.length || !lists.length) return result;
  const variantIds = [...new Set(items.map((i) => i.variantId))];
  const amounts = await tx
    .select()
    .from(moneyAmounts)
    .where(and(inArray(moneyAmounts.priceListId, lists.map((l) => l.id)), inArray(moneyAmounts.variantId, variantIds)));
  const base = lists.find((l) => l.kind === "base");

  for (const item of items) {
    const qty = Math.max(1, item.quantity ?? 1);
    for (const list of lists) {
      const tier = amounts
        .filter((a) => a.priceListId === list.id && a.variantId === item.variantId && a.minQuantity <= qty)
        .sort((a, b) => b.minQuantity - a.minQuantity)[0];
      if (!tier) continue;
      let compareAt = tier.compareAtAmount;
      if (compareAt === null && base && list.id !== base.id) {
        // A sale/segment price is compared against the regular (base) price.
        const regular = amounts
          .filter((a) => a.priceListId === base.id && a.variantId === item.variantId && a.minQuantity === 1)
          .at(0);
        compareAt = regular?.amount ?? null;
      }
      result.set(item.variantId, {
        variantId: item.variantId,
        currency: ctx.currency,
        amount: tier.amount,
        compareAtAmount: compareAt !== null && compareAt > tier.amount ? compareAt : null,
        priceListId: list.id,
        priceListKind: list.kind,
        minQuantity: tier.minQuantity,
      });
      break;
    }
  }
  return result;
}
