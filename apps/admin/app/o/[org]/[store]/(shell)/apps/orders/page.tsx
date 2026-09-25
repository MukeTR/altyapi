import type { Metadata } from "next";
import { ChannelOrders } from "@/components/integrations/channel-orders";
import { load } from "@/lib/api/load";
import type { CursorPage, ItemList } from "@/lib/api/types";
import { oneOf, param } from "@/lib/commerce/query";
import { getI18n } from "@/lib/i18n/server";
import { EXTERNAL_ORDER_STATUSES, type ExternalOrder, type IntegrationConnection } from "@/lib/integrations/types";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("integrations.orders.title") };
}

/** Apps & Integrations › Channel orders (integrations:read), keyset paginated, newest first. */
export default async function ChannelOrdersPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const ctx = await requireStoreContext(params);
  const sp = await searchParams;
  const q = param(sp, "q");
  const status = oneOf(param(sp, "status"), EXTERNAL_ORDER_STATUSES);
  const connectionId = param(sp, "connectionId");
  const [orders, connections] = await Promise.all([
    load<CursorPage<ExternalOrder>>(`${ctx.apiBase}/integrations/orders`, {
      query: { q: q || undefined, status, connectionId: /^[0-9a-f-]{36}$/i.test(connectionId) ? connectionId : undefined, limit: 50, cursor: param(sp, "cursor") || undefined },
    }),
    load<ItemList<IntegrationConnection>>(`${ctx.apiBase}/integrations/connections`),
  ]);
  return <ChannelOrders result={orders} connections={connections.ok ? connections.data.items : []} filtered={Boolean(q || status || connectionId)} />;
}
