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
}

export interface ResolvedPrice {
  variantId: string;
  currency: string;
  /** Unit price in minor units for the given quantity. */
  amount: bigint;
  /** Strike-through price, only when greater than amount. */
  compareAtAmount: bigint | null;
  priceListId: string;
  priceListKind: PriceListKind;
  minQuantity: number;
}

/** Tie-breaker between lists with equal priority: more specific kinds win. */
const KIND_RANK: Record<PriceListKind, number> = { scheduled: 5, customer_group: 4, channel: 3, sale: 2, base: 1 };

interface CandidateList {
  id: string;
  kind: PriceListKind;
  priority: number;
}

/**
 * Returns the price lists applicable to the context, ordered deterministically:
 * priority desc, kind specificity desc, id asc. A list restricted by channel, customer
 * group or schedule applies only when every restriction it has is satisfied.
 */
export async function applicableLists(tx: Transaction, ctx: PriceContext): Promise<CandidateList[]> {
  const lists = await tx
    .select({ id: priceLists.id, kind: priceLists.kind, priority: priceLists.priority })
    .from(priceLists)
    .where(and(eq(priceLists.storeId, ctx.storeId), eq(priceLists.currency, ctx.currency), eq(priceLists.isActive, true)));
  if (!lists.length) return [];
  const ids = lists.map((l) => l.id);
  const [channelLinks, groupLinks, windows] = await Promise.all([
    tx.select().from(channelPrices).where(inArray(channelPrices.priceListId, ids)),
    tx.select().from(customerGroupPrices).where(inArray(customerGroupPrices.priceListId, ids)),
    tx.select().from(scheduledPrices).where(inArray(scheduledPrices.priceListId, ids)),
  ]);
  const at = ctx.at ?? new Date();
  const groups = new Set(ctx.customerGroupIds ?? []);

  return lists
    .filter((l) => {
      if (l.kind === "base") return true;
      const ch = channelLinks.filter((c) => c.priceListId === l.id);
      if (ch.length && !(ctx.channelId && ch.some((c) => c.channelId === ctx.channelId))) return false;
      const gr = groupLinks.filter((g) => g.priceListId === l.id);
      if (gr.length && !gr.some((g) => groups.has(g.customerGroupId))) return false;
      if (l.kind === "customer_group" && !gr.length) return false;
      if (l.kind === "channel" && !ch.length) return false;
      const win = windows.filter((w) => w.priceListId === l.id);
      if (win.length && !win.some((w) => w.startsAt <= at && (!w.endsAt || w.endsAt > at))) return false;
      if (l.kind === "scheduled" && !win.length) return false;
      return true;
    })
    .sort((a, b) => b.priority - a.priority || KIND_RANK[b.kind] - KIND_RANK[a.kind] || a.id.localeCompare(b.id));
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
  const result = new Map<string, ResolvedPrice>();
  if (!items.length) return result;
  const lists = await applicableLists(tx, ctx);
  if (!lists.length) return result;
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
        // A sale/segment price is shown against the regular (base) price.
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
