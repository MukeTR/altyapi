import "server-only";
import type { StoreContextValue } from "@/components/providers/store-provider";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { load } from "@/lib/api/load";
import type { ApiResult } from "@/lib/api/server";
import type { CursorPage } from "@/lib/api/types";
import { addDays, dayBoundary, todayIn } from "@/lib/commerce/query";
import type { OrderListItem, ProductDetail, ProductListItem } from "@/lib/commerce/types";

/**
 * Overview figures derived from the real list endpoints. The API has no aggregate endpoint, so
 * the window is read completely (keyset pages of 200) up to a cap; when the cap is hit the
 * figures are marked as lower bounds instead of being presented as totals.
 */

export const WINDOW_DAYS = 30;
const ORDER_PAGE = 200;
const ORDER_PAGE_CAP = 15;
const PAID = new Set(["paid", "partially_refunded"]);
const OPEN_FULFILLMENT = new Set(["confirmed", "processing", "partially_fulfilled"]);

export interface DayBucket {
  /** YYYY-MM-DD in the store's time zone. */
  date: string;
  /** Orders with a captured payment (paid or partially refunded) placed that day. */
  paidOrders: number;
  /** Their total in the store's default currency (minor units). */
  revenue: string;
}

export interface OrderWindow {
  from: string;
  to: string;
  /** Every order placed in the window (all statuses). */
  placed: number;
  paidOrders: number;
  /** Paid order totals per currency (minor units), refunds not deducted. */
  revenueByCurrency: Record<string, string>;
  /** Paid order counts per currency. */
  paidByCurrency: Record<string, number>;
  awaitingFulfillment: number;
  awaitingPayment: number;
  cancelled: number;
  days: DayBucket[];
  /** True when the cap was reached: figures are lower bounds. */
  truncated: boolean;
}

function dayInZone(iso: string, timeZone: string): string {
  return todayIn(timeZone, new Date(iso));
}

export async function loadOrderWindow(ctx: StoreContextValue): Promise<{ ok: true; data: OrderWindow } | { ok: false; error: ApiErrorInfo }> {
  const tz = ctx.store.timezone;
  const today = todayIn(tz);
  const firstDay = addDays(today, -(WINDOW_DAYS - 1));
  const from = dayBoundary(firstDay, tz, "start")!;
  const days: DayBucket[] = Array.from({ length: WINDOW_DAYS }, (_, i) => ({ date: addDays(firstDay, i), paidOrders: 0, revenue: "0" }));
  const byDay = new Map(days.map((d) => [d.date, d]));
  const revenue = new Map<string, bigint>();
  const paidCount = new Map<string, number>();
  const dayRevenue = new Map<string, bigint>();
  let placed = 0;
  let paidOrders = 0;
  let awaitingFulfillment = 0;
  let awaitingPayment = 0;
  let cancelled = 0;
  let cursor: string | null = null;
  let truncated = false;

  for (let page = 0; page < ORDER_PAGE_CAP; page++) {
    const r: ApiResult<CursorPage<OrderListItem>> = await load<CursorPage<OrderListItem>>(`${ctx.apiBase}/orders`, { query: { from, limit: ORDER_PAGE, cursor: cursor ?? undefined } });
    if (!r.ok) return r;
    for (const o of r.data.items) {
      if (o.status === "draft") continue;
      placed += 1;
      if (o.status === "awaiting_payment") awaitingPayment += 1;
      if (o.status === "cancelled") cancelled += 1;
      if (OPEN_FULFILLMENT.has(o.status)) awaitingFulfillment += 1;
      if (PAID.has(o.paymentStatus)) {
        paidOrders += 1;
        revenue.set(o.currency, (revenue.get(o.currency) ?? 0n) + BigInt(o.total));
        paidCount.set(o.currency, (paidCount.get(o.currency) ?? 0) + 1);
        const day = dayInZone(o.createdAt, tz);
        const bucket = byDay.get(day);
        if (bucket) {
          bucket.paidOrders += 1;
          if (o.currency === ctx.store.defaultCurrency) dayRevenue.set(day, (dayRevenue.get(day) ?? 0n) + BigInt(o.total));
        }
      }
    }
    cursor = r.data.nextCursor;
    if (!cursor) break;
    if (page === ORDER_PAGE_CAP - 1) truncated = true;
  }
  for (const d of days) d.revenue = (dayRevenue.get(d.date) ?? 0n).toString();
  return {
    ok: true,
    data: {
      from: firstDay,
      to: today,
      placed,
      paidOrders,
      revenueByCurrency: Object.fromEntries([...revenue.entries()].map(([c, v]) => [c, v.toString()])),
      paidByCurrency: Object.fromEntries(paidCount),
      awaitingFulfillment,
      awaitingPayment,
      cancelled,
      days,
      truncated,
    },
  };
}

// ---------------------------------------------------------------------------
// Low stock
// ---------------------------------------------------------------------------

export const LOW_STOCK_THRESHOLD = 5;
const PRODUCT_PAGE_CAP = 5;
/** Products opened per overview render (each is one detail request). */
export const LOW_STOCK_DETAIL_CHECKS = 40;

export interface LowStockItem {
  productId: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  available: number;
  imageObjectKey: string | null;
}

export interface LowStock {
  items: LowStockItem[];
  /** Active products scanned. */
  scanned: number;
  /** Products whose variants were checked. */
  checked: number;
  /** Not every active product could be checked (the ones with the least stock per variant were). */
  partial: boolean;
}

/**
 * Tracked variants of active products at or below the threshold that cannot be backordered.
 * The product list only gives each product's summed availability, so products are ordered by
 * availability per variant and the lowest ones are opened to read their variants. Small
 * catalogs are covered completely; larger ones are marked partial.
 */
export async function loadLowStock(ctx: StoreContextValue): Promise<{ ok: true; data: LowStock } | { ok: false; error: ApiErrorInfo }> {
  const candidates: ProductListItem[] = [];
  let scanned = 0;
  let cursor: string | null = null;
  let partial = false;
  for (let page = 0; page < PRODUCT_PAGE_CAP; page++) {
    const r: ApiResult<CursorPage<ProductListItem>> = await load<CursorPage<ProductListItem>>(`${ctx.apiBase}/products`, { query: { status: "active", limit: 200, cursor: cursor ?? undefined } });
    if (!r.ok) return r;
    scanned += r.data.items.length;
    for (const p of r.data.items) if (p.variantCount > 0) candidates.push(p);
    cursor = r.data.nextCursor;
    if (!cursor) break;
    if (page === PRODUCT_PAGE_CAP - 1) partial = true;
  }
  candidates.sort((a, b) => a.totalAvailable / a.variantCount - b.totalAvailable / b.variantCount);
  if (candidates.length > LOW_STOCK_DETAIL_CHECKS) partial = true;
  const checked = candidates.slice(0, LOW_STOCK_DETAIL_CHECKS);
  const details = await Promise.all(checked.map((p) => load<ProductDetail>(`${ctx.apiBase}/products/${p.id}`)));
  const items: LowStockItem[] = [];
  details.forEach((d, i) => {
    const p = checked[i]!;
    if (!d.ok) return;
    for (const v of d.data.variants) {
      if (!v.trackInventory || v.allowBackorder) continue;
      const available = v.inventory?.available ?? 0;
      if (available > LOW_STOCK_THRESHOLD) continue;
      const variantTitle = d.data.options
        .map((o) => o.values.find((x) => v.optionValueIds.includes(x.id)))
        .filter(Boolean)
        .map((x) => x!.value[ctx.store.defaultLocale] ?? Object.values(x!.value)[0] ?? "")
        .join(" / ");
      items.push({ productId: p.id, productTitle: p.title, variantTitle, sku: v.sku, available, imageObjectKey: p.imageObjectKey });
    }
  });
  items.sort((a, b) => a.available - b.available);
  return { ok: true, data: { items, scanned, checked: checked.length, partial } };
}
