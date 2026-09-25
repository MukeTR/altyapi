"use client";

import { useRouter } from "next/navigation";
import { MoreHorizontal, PackageCheck, Pencil, Truck } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { TagInput } from "@/components/commerce/tag-input";
import { Thumb } from "@/components/commerce/thumb";
import { DateTime } from "@/components/data/date-time";
import { Money } from "@/components/data/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill, type StatusDomain } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { Carrier, Fulfillment, Location, OrderAddress, OrderDetail, OrderHistoryEntry, OrderLine } from "@/lib/commerce/types";
import { mediaUrl, type MediaConfig } from "@/lib/commerce/media";
import { formatNumber } from "@/lib/format";
import { localeLabel } from "@/lib/locales";
import {
  CancelFulfillmentDialog,
  CancelOrderDialog,
  ContactDialog,
  CreateReturnDialog,
  FulfillDrawer,
  ReceiveReturnDialog,
  RefundDialog,
  ReturnDecisionButton,
  TrackingDialog,
} from "./order-dialogs";
import { CANCELLABLE_STATUSES, FULFILLABLE_STATUSES, REFUNDABLE_PAYMENT, RETURNABLE_STATUSES, fulfillableQuantity, returnableQuantity } from "./order-math";

type OpenDialog =
  | { kind: "fulfill" }
  | { kind: "refund" }
  | { kind: "cancel" }
  | { kind: "return" }
  | { kind: "contact" }
  | { kind: "tracking"; fulfillment: Fulfillment }
  | { kind: "cancelFulfillment"; fulfillment: Fulfillment }
  | { kind: "receive"; returnId: string }
  | null;

export interface OrderDetailViewProps {
  detail: OrderDetail;
  carriers: Carrier[];
  locations: Location[];
  media: MediaConfig;
  /** Whether the paying provider supports partial refunds (null: unknown to this user). */
  supportsPartialRefund?: boolean | null;
}

export function OrderDetailView({ detail, carriers, locations, media, supportsPartialRefund = null }: OrderDetailViewProps) {
  const { t, locale } = useI18n();
  const { basePath, apiBase, can } = useStore();
  const router = useRouter();
  const { toast, toastError } = useToast();
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [processing, setProcessing] = useState(false);
  const { order } = detail;
  const close = () => setDialog(null);
  const canWrite = can("orders:write");
  const canRefund = can("orders:refund");

  const fulfillable = FULFILLABLE_STATUSES.includes(order.status) && detail.lines.some((l) => fulfillableQuantity(l) > 0);
  const refundable = REFUNDABLE_PAYMENT.includes(order.paymentStatus) && BigInt(order.total) > BigInt(order.refundedTotal);
  const returnable = RETURNABLE_STATUSES.includes(order.status) && detail.lines.some((l) => returnableQuantity(detail, l) > 0);
  const cancellable = CANCELLABLE_STATUSES.includes(order.status);
  const carrierName = (code: string | null) => (code ? (carriers.find((c) => c.code === code)?.name ?? code) : null);
  const lineById = new Map(detail.lines.map((l) => [l.id, l]));

  const markProcessing = async () => {
    setProcessing(true);
    try {
      await bff(`${apiBase}/orders/${order.id}/processing`, { method: "POST" });
      toast({ tone: "success", title: t("orders.detail.processingDone") });
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) toastError(err.toInfo());
      else throw err;
    } finally {
      setProcessing(false);
    }
  };

  const overflow = [
    canRefund && refundable ? { id: "refund", label: t("orders.actions.refund"), onSelect: () => setDialog({ kind: "refund" }) } : null,
    canWrite && returnable ? { id: "return", label: t("orders.actions.createReturn"), onSelect: () => setDialog({ kind: "return" }) } : null,
    canWrite && cancellable ? { id: "cancel", label: t("orders.actions.cancel"), onSelect: () => setDialog({ kind: "cancel" }), danger: true } : null,
  ].filter((x): x is { id: string; label: string; onSelect: () => void; danger?: boolean } => x !== null);

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: t("orders.title"), href: `${basePath}/orders` }]}
        title={t("orders.detail.title", { number: order.number })}
        status={
          <span className="flex flex-wrap gap-1.5">
            <StatusPill domain="order" value={order.status} />
            <StatusPill domain="payment" value={order.paymentStatus} />
            <StatusPill domain="fulfillment" value={order.fulfillmentStatus} />
          </span>
        }
        meta={
          <span className="flex flex-wrap items-center gap-x-2">
            <DateTime value={order.createdAt} />
            {order.source ? <span>· {t.maybe(`orders.source.${order.source}`) ?? order.source}</span> : null}
            {order.locale ? <span>· {localeLabel(order.locale, locale)}</span> : null}
          </span>
        }
        actions={
          <>
            {canWrite && order.status === "confirmed" ? (
              <Button onClick={markProcessing} loading={processing}>
                <PackageCheck aria-hidden="true" />
                {t("orders.actions.markProcessing")}
              </Button>
            ) : null}
            {canWrite && fulfillable ? (
              <Button variant="primary" onClick={() => setDialog({ kind: "fulfill" })}>
                <Truck aria-hidden="true" />
                {t("orders.actions.fulfill")}
              </Button>
            ) : null}
            {overflow.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-md" aria-label={t("common.rowActions", { name: `#${order.number}` })}>
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {overflow.map((item) => (
                    <DropdownMenuItem key={item.id} onSelect={item.onSelect} {...(item.danger ? { tone: "danger" as const } : {})}>
                      {item.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        }
      />

      {order.status === "cancelled" && order.cancelReason ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-3 text-base text-fg-muted">
          {t("orders.detail.cancelReason")}: <span className="text-fg">{order.cancelReason}</span>
        </p>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <LinesCard detail={detail} media={media} />
          <PaymentsCard detail={detail} />
          {detail.fulfillments.length > 0 ? (
            <Card title={t("orders.fulfillments.title")} flush>
              <ul className="divide-y divide-border border-t border-border">
                {detail.fulfillments.map((f) => (
                  <li key={f.id} className="flex flex-col gap-2 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill domain="shipment" value={f.status} />
                        <span className="text-base text-fg">{carrierName(f.carrierCode) ?? t("orders.fulfill.noCarrier")}</span>
                        {f.trackingNumber ? (
                          f.trackingUrl ? (
                            <a href={f.trackingUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-sm">
                              {f.trackingNumber}
                              <span className="sr-only"> ({t("common.openInNewTab")})</span>
                            </a>
                          ) : (
                            <span className="font-mono text-sm">{f.trackingNumber}</span>
                          )
                        ) : null}
                      </div>
                      {canWrite && f.status !== "cancelled" ? (
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => setDialog({ kind: "tracking", fulfillment: f })}>
                            {t("orders.fulfillments.editTracking")}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "cancelFulfillment", fulfillment: f })}>
                            {t("orders.fulfillments.cancel")}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    <ul className="flex flex-col gap-0.5 text-sm text-fg-muted">
                      {f.lines.map((fl) => {
                        const line = lineById.get(fl.orderLineId);
                        return (
                          <li key={fl.orderLineId}>
                            {line ? line.title : fl.orderLineId} × {formatNumber(fl.quantity, locale)}
                          </li>
                        );
                      })}
                    </ul>
                    <p className="text-xs text-fg-subtle">
                      <DateTime value={f.createdAt} />
                      {f.locationId ? ` · ${locations.find((l) => l.id === f.locationId)?.name ?? ""}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {detail.refunds.length > 0 ? (
            <Card title={t("orders.refunds.title")} flush>
              <ul className="divide-y divide-border border-t border-border">
                {detail.refunds.map((r) => (
                  <li key={r.id} className="flex flex-col gap-1 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <StatusPill domain="refund" value={r.status} />
                        <Money amount={r.amount} currency={r.currency} className="font-medium" />
                      </span>
                      <DateTime value={r.createdAt} className="text-sm text-fg-muted" />
                    </div>
                    {r.lines.length ? (
                      <p className="text-sm text-fg-muted">
                        {r.lines.map((l) => `${lineById.get(l.orderLineId)?.title ?? ""} × ${l.quantity}`).join(", ")}
                        {BigInt(r.shippingAmount) > 0n ? ` · ${t("orders.refund.shipping")}` : ""}
                      </p>
                    ) : null}
                    {r.reason ? <p className="text-sm text-fg">{r.reason}</p> : null}
                    {r.failureReason ? <p className="font-mono text-xs text-danger">{r.failureReason}</p> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {detail.returns.length > 0 ? (
            <Card title={t("orders.returns.title")} flush>
              <ul className="divide-y divide-border border-t border-border">
                {detail.returns.map((r) => (
                  <li key={r.id} className="flex flex-col gap-2 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <StatusPill domain="return" value={r.status} />
                        <DateTime value={r.createdAt} className="text-sm text-fg-muted" />
                      </span>
                      {canWrite ? (
                        <div className="flex flex-wrap gap-2">
                          {r.status === "requested" ? (
                            <>
                              <ReturnDecisionButton returnId={r.id} decision="approved" label={t("orders.returns.approve")} />
                              <ReturnDecisionButton returnId={r.id} decision="rejected" label={t("orders.returns.reject")} tone="danger" />
                            </>
                          ) : null}
                          {r.status === "approved" ? (
                            <>
                              <Button size="sm" onClick={() => setDialog({ kind: "receive", returnId: r.id })}>
                                {t("orders.returns.receive")}
                              </Button>
                              <ReturnDecisionButton returnId={r.id} decision="cancelled" label={t("orders.returns.cancelReturn")} tone="danger" />
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <p className="text-sm text-fg-muted">{r.lines.map((l) => `${lineById.get(l.orderLineId)?.title ?? ""} × ${l.quantity}`).join(", ")}</p>
                    {r.reason ? <p className="text-sm text-fg">{r.reason}</p> : null}
                    {r.customerNote ? <p className="text-sm text-fg-muted">“{r.customerNote}”</p> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <HistoryCard history={detail.history} />
        </div>

        <aside aria-label={t("orders.detail.aside")} className="flex min-w-0 flex-col gap-4">
          <Card
            title={t("orders.contact.title")}
            actions={
              canWrite ? (
                <Button size="icon-sm" variant="ghost" aria-label={t("orders.contact.editTitle")} onClick={() => setDialog({ kind: "contact" })}>
                  <Pencil aria-hidden="true" />
                </Button>
              ) : null
            }
          >
            <dl className="flex flex-col gap-1 text-base">
              <dt className="sr-only">{t("orders.contact.email")}</dt>
              <dd className="break-all">{order.email ? <a href={`mailto:${order.email}`}>{order.email}</a> : t("common.none")}</dd>
              <dt className="sr-only">{t("orders.contact.phone")}</dt>
              <dd className="text-fg-muted">{order.phone ?? t("orders.contact.noPhone")}</dd>
            </dl>
          </Card>
          <Card title={t("orders.address.shipping")}>
            <AddressBlock address={detail.shippingAddress} />
            {order.shippingMethod?.name ? (
              <p className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3 text-sm text-fg-muted">
                <span>{order.shippingMethod.name}</span>
                {order.shippingMethod.amount ? <Money amount={order.shippingMethod.amount} currency={order.currency} /> : null}
              </p>
            ) : null}
          </Card>
          <Card title={t("orders.address.billing")}>
            <AddressBlock address={detail.billingAddress} />
          </Card>
          <NoteAndTagsCard detail={detail} canWrite={canWrite} />
          {order.couponCodes && order.couponCodes.length > 0 ? (
            <Card title={t("orders.detail.coupons")}>
              <span className="flex flex-wrap gap-1">
                {order.couponCodes.map((c) => (
                  <Badge key={c} className="font-mono">
                    {c}
                  </Badge>
                ))}
              </span>
            </Card>
          ) : null}
        </aside>
      </div>

      {dialog?.kind === "fulfill" ? <FulfillDrawer detail={detail} carriers={carriers} locations={locations} open onOpenChange={(o) => !o && close()} /> : null}
      {dialog?.kind === "refund" ? <RefundDialog detail={detail} supportsPartial={supportsPartialRefund} open onOpenChange={(o) => !o && close()} /> : null}
      {dialog?.kind === "cancel" ? <CancelOrderDialog detail={detail} open onOpenChange={(o) => !o && close()} /> : null}
      {dialog?.kind === "return" ? <CreateReturnDialog detail={detail} open onOpenChange={(o) => !o && close()} /> : null}
      {dialog?.kind === "contact" ? <ContactDialog detail={detail} open onOpenChange={(o) => !o && close()} /> : null}
      {dialog?.kind === "tracking" ? <TrackingDialog fulfillment={dialog.fulfillment} carriers={carriers} open onOpenChange={(o) => !o && close()} /> : null}
      {dialog?.kind === "cancelFulfillment" ? <CancelFulfillmentDialog fulfillment={dialog.fulfillment} open onOpenChange={(o) => !o && close()} /> : null}
      {dialog?.kind === "receive" ? <ReceiveReturnDialog returnId={dialog.returnId} locations={locations} open onOpenChange={(o) => !o && close()} /> : null}
    </div>
  );
}

function LinesCard({ detail, media }: { detail: OrderDetail; media: MediaConfig }) {
  const { t, locale } = useI18n();
  const { order } = detail;
  const discount = BigInt(order.discountTotal);
  const refunded = BigInt(order.refundedTotal);
  const taxIncluded = detail.lines.every((l) => l.taxIncluded);
  return (
    <Card title={t("orders.lines.title", { count: detail.lines.reduce((s, l) => s + l.quantity, 0) })} flush>
      <div className="relative overflow-x-auto border-t border-border">
        <table className="w-full border-collapse text-base">
          <caption className="sr-only">{t("orders.lines.caption")}</caption>
          <thead className="bg-surface-muted">
            <tr className="border-b border-border text-xs text-fg-muted">
              <th scope="col" className="h-9 px-4 text-start font-medium">
                {t("orders.lines.product")}
              </th>
              <th scope="col" className="h-9 px-3 text-end font-medium">
                {t("orders.lines.unitPrice")}
              </th>
              <th scope="col" className="h-9 px-3 text-end font-medium">
                {t("orders.lines.quantity")}
              </th>
              <th scope="col" className="h-9 px-4 text-end font-medium">
                {t("orders.lines.total")}
              </th>
            </tr>
          </thead>
          <tbody>
            {detail.lines.map((l: OrderLine) => (
              <tr key={l.id} className="border-b border-border align-top last:border-b-0">
                <td className="px-4 py-2.5">
                  <div className="flex items-start gap-3">
                    <Thumb src={mediaUrl(media, l.imageObjectKey)} />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-fg">{l.title}</span>
                      {l.variantTitle ? <span className="text-sm text-fg-muted">{l.variantTitle}</span> : null}
                      {l.sku ? <span className="font-mono text-xs text-fg-subtle">{l.sku}</span> : null}
                      <span className="flex flex-wrap gap-1 pt-0.5">
                        {l.fulfilledQuantity > 0 ? <Badge tone="success">{t("orders.lines.fulfilled", { count: l.fulfilledQuantity })}</Badge> : null}
                        {l.refundedQuantity > 0 ? <Badge tone="info">{t("orders.lines.refunded", { count: l.refundedQuantity })}</Badge> : null}
                        {l.returnedQuantity > 0 ? <Badge tone="warning">{t("orders.lines.returned", { count: l.returnedQuantity })}</Badge> : null}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-end tabular">
                  <Money amount={l.unitPrice} currency={order.currency} compareAt={l.compareAtUnitPrice && BigInt(l.compareAtUnitPrice) > BigInt(l.unitPrice) ? l.compareAtUnitPrice : null} />
                </td>
                <td className="px-3 py-2.5 text-end tabular">{formatNumber(l.quantity, locale)}</td>
                <td className="px-4 py-2.5 text-end tabular">
                  <Money amount={l.total} currency={order.currency} />
                  {BigInt(l.discountAmount) > 0n ? (
                    <span className="block text-xs text-fg-subtle">
                      {t("orders.lines.discount")} −<Money amount={l.discountAmount} currency={order.currency} />
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 border-t border-border px-4 py-3 text-base">
        <dt className="text-fg-muted">{t("orders.totals.subtotal")}</dt>
        <dd className="text-end tabular">
          <Money amount={order.subtotal} currency={order.currency} />
        </dd>
        {discount > 0n ? (
          <>
            <dt className="text-fg-muted">{t("orders.totals.discount")}</dt>
            <dd className="text-end tabular">
              −<Money amount={order.discountTotal} currency={order.currency} />
            </dd>
          </>
        ) : null}
        {detail.adjustments.map((a) => (
          <div key={a.id} className="contents">
            <dt className="ps-3 text-sm text-fg-subtle">{a.description ?? a.code ?? a.type}</dt>
            <dd className="text-end text-sm text-fg-subtle tabular">
              <Money amount={a.amount} currency={order.currency} />
            </dd>
          </div>
        ))}
        <dt className="text-fg-muted">{t("orders.totals.shipping")}</dt>
        <dd className="text-end tabular">
          <Money amount={order.shippingTotal} currency={order.currency} />
        </dd>
        <dt className="text-fg-muted">{taxIncluded ? t("orders.totals.taxIncluded") : t("orders.totals.tax")}</dt>
        <dd className="text-end tabular">
          <Money amount={order.taxTotal} currency={order.currency} />
        </dd>
        <dt className="font-semibold text-fg">{t("orders.totals.total")}</dt>
        <dd className="text-end font-semibold tabular">
          <Money amount={order.total} currency={order.currency} />
        </dd>
        {refunded > 0n ? (
          <>
            <dt className="text-fg-muted">{t("orders.totals.refunded")}</dt>
            <dd className="text-end tabular">
              −<Money amount={order.refundedTotal} currency={order.currency} />
            </dd>
            <dt className="font-medium text-fg">{t("orders.totals.net")}</dt>
            <dd className="text-end font-medium tabular">
              <Money amount={(BigInt(order.total) - refunded).toString()} currency={order.currency} />
            </dd>
          </>
        ) : null}
      </dl>
    </Card>
  );
}

function PaymentsCard({ detail }: { detail: OrderDetail }) {
  const { t } = useI18n();
  if (detail.payments.length === 0) {
    return (
      <Card title={t("orders.payments.title")}>
        <p className="text-base text-fg-muted">{t("orders.payments.none")}</p>
      </Card>
    );
  }
  return (
    <Card title={t("orders.payments.title")} flush>
      <ul className="divide-y divide-border border-t border-border">
        {detail.payments.map((p) => (
          <li key={p.id} className="flex flex-col gap-1 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-fg">{t.maybe(`orders.payments.providers.${p.provider}`) ?? p.provider}</span>
                <StatusPill domain="paymentMode" value={p.mode} noDot />
                <StatusPill domain="paymentAttempt" value={p.status} />
              </span>
              <Money amount={p.amount} currency={p.currency} className="font-medium" />
            </div>
            <p className="flex flex-wrap gap-x-3 text-sm text-fg-muted">
              {p.paidAt ? (
                <span>
                  {t("orders.payments.paidAt")}: <DateTime value={p.paidAt} />
                </span>
              ) : (
                <span>
                  {t("orders.payments.createdAt")}: <DateTime value={p.createdAt} />
                </span>
              )}
              {BigInt(p.refundedAmount) > 0n ? (
                <span>
                  {t("orders.payments.refunded")}: <Money amount={p.refundedAmount} currency={p.currency} />
                </span>
              ) : null}
            </p>
            {p.failureCode || p.failureMessage ? (
              <p className="text-sm text-danger">
                {p.failureMessage ?? ""} {p.failureCode ? <code className="font-mono text-xs">({p.failureCode})</code> : null}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

const HISTORY_DOMAINS: Record<string, StatusDomain> = { status: "order", payment_status: "payment", fulfillment_status: "fulfillment" };

function HistoryCard({ history }: { history: OrderHistoryEntry[] }) {
  const { t } = useI18n();
  const entries = [...history].reverse();
  return (
    <Card title={t("orders.history.title")}>
      {entries.length === 0 ? (
        <p className="text-base text-fg-muted">{t("orders.history.empty")}</p>
      ) : (
        <ol className="relative flex flex-col gap-4 border-s border-border ps-4">
          {entries.map((h, i) => {
            const domain = HISTORY_DOMAINS[h.field];
            const reason = h.reason?.startsWith("refund:") ? t("orders.history.reasonRefund") : h.reason ? (t.maybe(`orders.history.reasons.${h.reason}`) ?? h.reason) : null;
            return (
              <li key={h.id ?? `${h.field}-${h.createdAt}-${i}`} className="relative flex flex-col gap-1">
                <span aria-hidden="true" className="absolute -start-[21px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-border-control" />
                <span className="text-sm text-fg-muted">
                  {t.maybe(`orders.history.fields.${h.field}`) ?? h.field} · <DateTime value={h.createdAt} />
                </span>
                <span className="flex flex-wrap items-center gap-1.5 text-base">
                  {h.fromValue ? domain ? <StatusPill domain={domain} value={h.fromValue} noDot /> : <span>{h.fromValue}</span> : null}
                  {h.fromValue ? <span aria-label={t("orders.history.to")}>→</span> : null}
                  {h.toValue ? domain ? <StatusPill domain={domain} value={h.toValue} noDot /> : <span>{h.toValue}</span> : null}
                </span>
                {reason || h.principalType ? (
                  <span className="text-xs text-fg-subtle">
                    {[reason, h.principalType ? (t.maybe(`orders.history.principals.${h.principalType}`) ?? h.principalType) : null].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

function AddressBlock({ address }: { address: OrderAddress | null }) {
  const { t } = useI18n();
  if (!address) return <p className="text-base text-fg-muted">{t("orders.address.none")}</p>;
  const name = [address.firstName, address.lastName].filter(Boolean).join(" ");
  const cityLine = [address.postalCode, address.district, address.city, address.province].filter(Boolean).join(", ");
  return (
    <address className="flex flex-col gap-0.5 text-base not-italic">
      {name ? <span className="text-fg">{name}</span> : null}
      {address.company ? <span className="text-fg-muted">{address.company}</span> : null}
      {address.line1 ? <span>{address.line1}</span> : null}
      {address.line2 ? <span>{address.line2}</span> : null}
      {cityLine ? <span>{cityLine}</span> : null}
      {address.countryCode ? <span className="text-fg-muted">{address.countryCode}</span> : null}
      {address.phone ? <span className="text-fg-muted">{address.phone}</span> : null}
      {address.taxNumber ? (
        <span className="text-sm text-fg-muted">
          {t("orders.address.taxNumber")}: {address.taxNumber}
          {address.taxOffice ? ` · ${address.taxOffice}` : ""}
        </span>
      ) : null}
    </address>
  );
}

function NoteAndTagsCard({ detail, canWrite }: { detail: OrderDetail; canWrite: boolean }) {
  const { t } = useI18n();
  const { apiBase } = useStore();
  const router = useRouter();
  const { toast, toastError } = useToast();
  const [note, setNote] = useState(detail.order.note ?? "");
  const [tags, setTags] = useState<string[]>(detail.order.tags ?? []);
  const [pending, setPending] = useState(false);
  const dirty = note !== (detail.order.note ?? "") || JSON.stringify(tags) !== JSON.stringify(detail.order.tags ?? []);

  const save = async () => {
    setPending(true);
    try {
      await bff(`${apiBase}/orders/${detail.order.id}`, { method: "PATCH", body: { note: note.trim() || null, tags } });
      toast({ tone: "success", title: t("commerce.savedToast") });
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) toastError(err.toInfo());
      else throw err;
    } finally {
      setPending(false);
    }
  };

  return (
    <Card
      title={t("orders.notes.title")}
      footer={
        canWrite && dirty ? (
          <>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => {
                setNote(detail.order.note ?? "");
                setTags(detail.order.tags ?? []);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button size="sm" variant="primary" loading={pending} onClick={save}>
              {t("common.save")}
            </Button>
          </>
        ) : null
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg">{t("orders.notes.note")}</span>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} rows={3} disabled={!canWrite} placeholder={t("orders.notes.placeholder")} />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg" id="order-tags-label">
            {t("orders.notes.tags")}
          </span>
          <div role="group" aria-labelledby="order-tags-label">
            <TagInput value={tags} onChange={setTags} maxTags={30} maxLength={40} disabled={!canWrite} />
          </div>
        </div>
      </div>
    </Card>
  );
}
