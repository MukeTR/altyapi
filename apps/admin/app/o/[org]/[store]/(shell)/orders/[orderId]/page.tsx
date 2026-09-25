import type { Metadata } from "next";
import { OrderDetailView } from "@/components/orders/order-detail";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import type { Carrier, Location, OrderDetail } from "@/lib/commerce/types";
import { mediaConfig } from "@/lib/commerce/media-server";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string; orderId: string }>;

interface PaymentConnectionSummary {
  provider: string;
  capabilities: { partialRefund: boolean };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { t } = await getI18n();
  const { org, store, orderId } = await params;
  const ctx = await requireStoreContext(Promise.resolve({ org, store }));
  const r = await load<OrderDetail>(`${ctx.apiBase}/orders/${encodeURIComponent(orderId)}`);
  return { title: r.ok ? t("orders.detail.title", { number: r.data.order.number }) : t("orders.title") };
}

/** One order with its lines, payments, shipments, refunds, returns and history. */
export default async function OrderPage({ params }: { params: Params }) {
  const { org, store, orderId } = await params;
  const ctx = await requireStoreContext(Promise.resolve({ org, store }));
  const { t } = await getI18n();
  const [order, carriers, locations, connections] = await Promise.all([
    load<OrderDetail>(`${ctx.apiBase}/orders/${encodeURIComponent(orderId)}`, { notFoundOn404: true }),
    load<ItemList<Carrier>>("/v1/carriers"),
    ctx.permissions.includes("inventory:read") ? load<ItemList<Location>>(`${ctx.apiBase}/inventory/locations`) : Promise.resolve(null),
    ctx.permissions.includes("payments:read") ? load<ItemList<PaymentConnectionSummary>>(`${ctx.apiBase}/payment-connections`) : Promise.resolve(null),
  ]);
  if (!order.ok) {
    return (
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
        <PageHeader title={t("orders.title")} breadcrumbs={[{ label: t("orders.title"), href: `${ctx.basePath}/orders` }]} />
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={order.error} />
        </div>
      </div>
    );
  }
  // Partial refunds depend on the provider that took the payment (PayTR and iyzico differ).
  const paidWith = order.data.payments.find((p) => p.status === "paid" || p.status === "partially_refunded")?.provider;
  const connection = paidWith && connections?.ok ? connections.data.items.find((c) => c.provider === paidWith) : undefined;
  return (
    <OrderDetailView
      supportsPartialRefund={connection ? connection.capabilities.partialRefund : null}
      detail={order.data}
      carriers={carriers.ok ? carriers.data.items : []}
      locations={locations?.ok ? locations.data.items : []}
      media={mediaConfig()}
    />
  );
}
