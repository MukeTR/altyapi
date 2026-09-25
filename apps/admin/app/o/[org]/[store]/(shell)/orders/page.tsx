import type { Metadata } from "next";
import { OrdersView } from "@/components/orders/orders-view";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import type { CursorPage } from "@/lib/api/types";
import { dayBoundary, oneOf, param } from "@/lib/commerce/query";
import { ORDER_STATUSES, PAYMENT_STATUSES, type OrderListItem } from "@/lib/commerce/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("orders.title") };
}

/** Orders list: search, status tabs, payment and date filters, keyset pagination (newest first). */
export default async function OrdersPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const ctx = await requireStoreContext(params);
  const sp = await searchParams;
  const { t } = await getI18n();
  const tz = ctx.store.timezone;
  const filters = {
    q: param(sp, "q"),
    status: oneOf(param(sp, "status"), ORDER_STATUSES),
    paymentStatus: oneOf(param(sp, "paymentStatus"), PAYMENT_STATUSES),
    from: param(sp, "from"),
    to: param(sp, "to"),
  };
  const result = await load<CursorPage<OrderListItem>>(`${ctx.apiBase}/orders`, {
    query: {
      q: filters.q || undefined,
      status: filters.status,
      paymentStatus: filters.paymentStatus,
      from: dayBoundary(filters.from, tz, "start"),
      to: dayBoundary(filters.to, tz, "end"),
      limit: 50,
      cursor: param(sp, "cursor") || undefined,
    },
  });
  const filtered = Boolean(filters.q || filters.status || filters.paymentStatus || filters.from || filters.to);
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
      <PageHeader title={t("orders.title")} />
      <OrdersView result={result} filtered={filtered} />
    </div>
  );
}
