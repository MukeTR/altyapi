"use client";

import { Eye, ShoppingBag } from "lucide-react";
import { useState } from "react";
import { FilterTabs } from "@/components/commerce/filter-tabs";
import { SearchField } from "@/components/commerce/search-field";
import { useUrlFilters } from "@/components/commerce/use-url-filters";
import { DataTable, type Column } from "@/components/data/data-table";
import { DateTime } from "@/components/data/date-time";
import { KeyValue } from "@/components/data/key-value";
import { Money } from "@/components/data/money";
import { CursorPagination } from "@/components/data/pagination";
import { useI18n } from "@/components/providers/i18n-provider";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { useStore } from "@/components/providers/store-provider";
import type { ApiResult } from "@/lib/api/server";
import type { CursorPage } from "@/lib/api/types";
import { formatNumber } from "@/lib/format";
import type { ExternalOrder, IntegrationConnection } from "@/lib/integrations/types";

const STATUS_TONE: Partial<Record<string, Tone>> = {
  pending_payment: "warning",
  awaiting_approval: "warning",
  processing: "info",
  ready_to_ship: "info",
  shipped: "info",
  delivered: "success",
  undelivered: "danger",
  cancelled: "neutral",
  returned: "neutral",
};

export function ExternalOrderStatus({ status }: { status: string }) {
  const { t } = useI18n();
  return (
    <Badge tone={STATUS_TONE[status] ?? "neutral"}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {t.maybe(`integrations.orderStatus.${status}`) ?? status}
    </Badge>
  );
}

function OrderDrawer({ order, connectionName, onClose }: { order: ExternalOrder | null; connectionName: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  return (
    <Drawer open={order !== null} onOpenChange={(o) => !o && onClose()} title={order ? t("integrations.orders.drawerTitle", { number: order.externalNumber ?? order.externalId }) : ""} width={640}>
      {order ? (
        <div className="flex flex-col gap-5">
          <KeyValue
            items={[
              { label: t("integrations.orders.columns.status"), value: <ExternalOrderStatus status={order.status} /> },
              { label: t("integrations.orders.rawStatus"), value: order.rawStatus ?? t("common.none"), mono: true },
              { label: t("integrations.orders.columns.connection"), value: connectionName },
              { label: t("integrations.orders.columns.channel"), value: order.channel ?? t("common.none") },
              { label: t("integrations.orders.columns.orderedAt"), value: <DateTime value={order.orderedAt} /> },
              { label: t("integrations.orders.columns.total"), value: <Money amount={order.total} currency={order.currency} /> },
              { label: t("integrations.orders.customer"), value: [order.customer?.name, order.customer?.district, order.customer?.city].filter(Boolean).join(", ") || t("common.none") },
              {
                label: t("integrations.orders.shipping"),
                value: order.shipping ? [order.shipping.carrier, order.shipping.trackingNumber].filter(Boolean).join(" · ") || t("common.none") : t("common.none"),
              },
              { label: t("integrations.orders.externalId"), value: order.externalId, mono: true, copy: { value: order.externalId, label: t("integrations.orders.externalId") } },
            ]}
          />
          <section aria-labelledby="ext-lines" className="flex flex-col gap-2">
            <h3 id="ext-lines" className="text-md font-semibold text-fg">
              {t("integrations.orders.lines", { count: formatNumber(order.lines.length, locale) })}
            </h3>
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {order.lines.map((l, i) => (
                <li key={l.externalId ?? i} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
                  <span className="flex min-w-0 flex-col">
                    <span className="text-fg">{l.name || t("common.none")}</span>
                    <span className="font-mono text-xs text-fg-muted">{[l.sku, l.barcode].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="flex flex-col items-end text-sm">
                    <span className="tabular">× {formatNumber(l.quantity, locale)}</span>
                    {l.unitPrice ? <Money amount={l.unitPrice} currency={order.currency} className="text-fg-muted" /> : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}

/** Apps & Integrations › Channel orders: orders read from connected marketplaces and integrators. */
export function ChannelOrders({ result, connections, filtered }: { result: ApiResult<CursorPage<ExternalOrder>>; connections: IntegrationConnection[]; filtered: boolean }) {
  const { t, locale } = useI18n();
  const { basePath } = useStore();
  const { params, setFilters, clearHref } = useUrlFilters();
  const [open, setOpen] = useState<ExternalOrder | null>(null);
  const nameOf = (id: string) => connections.find((c) => c.id === id)?.name ?? id.slice(0, 8);

  const columns: Column<ExternalOrder>[] = [
    {
      id: "number",
      header: t("integrations.orders.columns.number"),
      cell: (o) => (
        <Button variant="link" onClick={() => setOpen(o)} aria-label={t("integrations.orders.open", { number: o.externalNumber ?? o.externalId })}>
          <span className="font-mono">{o.externalNumber ?? o.externalId}</span>
        </Button>
      ),
    },
    { id: "orderedAt", header: t("integrations.orders.columns.orderedAt"), cell: (o) => <DateTime value={o.orderedAt ?? o.createdAt} format="relative" className="whitespace-nowrap text-fg-muted" /> },
    { id: "connection", header: t("integrations.orders.columns.connection"), cell: (o) => nameOf(o.connectionId) },
    { id: "channel", header: t("integrations.orders.columns.channel"), cell: (o) => o.channel ?? t("common.none") },
    { id: "status", header: t("integrations.orders.columns.status"), cell: (o) => <ExternalOrderStatus status={o.status} /> },
    { id: "items", header: t("integrations.orders.columns.items"), align: "end", cell: (o) => formatNumber(o.itemCount, locale) },
    { id: "total", header: t("integrations.orders.columns.total"), align: "end", cell: (o) => <Money amount={o.total} currency={o.currency} /> },
    { id: "city", header: t("integrations.orders.columns.city"), cell: (o) => o.customer?.city ?? "" },
    {
      id: "view",
      header: t("common.actions"),
      srOnlyHeader: true,
      align: "end",
      cell: (o) => (
        <Button size="icon-sm" variant="ghost" onClick={() => setOpen(o)} aria-label={t("integrations.orders.open", { number: o.externalNumber ?? o.externalId })}>
          <Eye aria-hidden="true" />
        </Button>
      ),
    },
  ];

  const rows = result.ok ? result.data.items : [];
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
      <PageHeader title={t("integrations.orders.title")} meta={t("integrations.orders.meta")} />
      <section aria-label={t("integrations.orders.title")} className="min-w-0 rounded-lg border border-border bg-surface">
        <FilterTabs
          param="status"
          aria-label={t("integrations.orders.statusTabs")}
          tabs={[{ value: null, label: t("integrations.filters.all") }, ...(["processing", "ready_to_ship", "shipped", "delivered", "cancelled", "returned"] as const).map((s) => ({ value: s, label: t(`integrations.orderStatus.${s}`) }))]}
        />
        <div className="flex flex-wrap items-end gap-2 border-b border-border p-3">
          <SearchField label={t("integrations.orders.search")} className="w-full sm:w-72" />
          <div className="w-full sm:w-64">
            <Select
              aria-label={t("integrations.filters.connection")}
              value={params.get("connectionId") ?? "all"}
              onValueChange={(v) => setFilters({ connectionId: v === "all" ? null : v })}
              options={[{ value: "all", label: t("integrations.filters.allConnections") }, ...connections.filter((c) => c.capabilities?.readOrders).map((c) => ({ value: c.id, label: c.name }))]}
            />
          </div>
          {filtered ? (
            <ButtonLink href={clearHref} variant="ghost" size="md">
              {t("states.clearFilters")}
            </ButtonLink>
          ) : null}
        </div>
        <DataTable
          caption={t("integrations.orders.title")}
          columns={columns}
          rows={rows}
          rowKey={(o) => o.id}
          error={!result.ok ? <ErrorState error={result.error} /> : undefined}
          empty={
            filtered ? (
              <EmptyState title={t("states.emptyFilteredTitle")} description={t("states.emptyFilteredBody")} actions={<ButtonLink href={clearHref}>{t("states.clearFilters")}</ButtonLink>} />
            ) : (
              <EmptyState
                icon={ShoppingBag}
                title={t("integrations.orders.emptyTitle")}
                description={t("integrations.orders.emptyBody")}
                actions={<ButtonLink href={`${basePath}/apps`}>{t("integrations.backToApps")}</ButtonLink>}
              />
            )
          }
          footer={result.ok && rows.length ? <CursorPagination nextCursor={result.data.nextCursor} /> : null}
        />
      </section>
      <OrderDrawer order={open} connectionName={open ? nameOf(open.connectionId) : ""} onClose={() => setOpen(null)} />
    </div>
  );
}
