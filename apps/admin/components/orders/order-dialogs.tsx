"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { FormAlert } from "@/components/auth/form-alert";
import { QuantityInput } from "@/components/commerce/quantity-input";
import { Money } from "@/components/data/money";
import { AlertDialog, Dialog } from "@/components/ui/dialog";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { Carrier, Fulfillment, Location, OrderDetail, OrderLine, Refund } from "@/lib/commerce/types";
import { fulfillableQuantity, lineRefundAmount, refundableQuantity, refundableTotal, returnableQuantity } from "./order-math";

function toInfo(err: unknown): ApiErrorInfo {
  if (err instanceof ApiError) return err.toInfo();
  throw err;
}

function lineLabel(line: OrderLine): string {
  return line.variantTitle ? `${line.title} · ${line.variantTitle}` : line.title;
}

/** Shared submit flow: run the request, refresh the page's server data, report the outcome. */
function useOrderMutation() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const run = async <T,>(request: () => Promise<T>, success: string): Promise<T | null> => {
    setPending(true);
    setError(null);
    try {
      const result = await request();
      toast({ tone: "success", title: success });
      router.refresh();
      return result;
    } catch (err) {
      setError(toInfo(err));
      return null;
    } finally {
      setPending(false);
    }
  };
  return { pending, error, setError, run };
}

function MutationError({ error, fields }: { error: ApiErrorInfo | null; fields?: Record<string, string> }) {
  const { describeError } = useI18n();
  if (!error) return null;
  const d = describeError(error, fields);
  return (
    <FormAlert tone="danger" focusKey={error}>
      {d.message}
      {d.correlationId ? <span className="mt-1 block text-sm text-fg-muted">{d.correlationId}</span> : null}
    </FormAlert>
  );
}

// ---------------------------------------------------------------------------
// Fulfillment
// ---------------------------------------------------------------------------

export function FulfillDrawer({ detail, carriers, locations, open, onOpenChange }: { detail: OrderDetail; carriers: Carrier[]; locations: Location[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n();
  const { apiBase } = useStore();
  const lines = detail.lines.filter((l) => fulfillableQuantity(l) > 0);
  const [quantities, setQuantities] = useState<Record<string, number>>(() => Object.fromEntries(lines.map((l) => [l.id, fulfillableQuantity(l)])));
  const activeLocations = locations.filter((l) => l.isActive);
  const [locationId, setLocationId] = useState<string>(activeLocations[0]?.id ?? "");
  const [carrierCode, setCarrierCode] = useState<string>("none");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [notify, setNotify] = useState(true);
  const { pending, error, run } = useOrderMutation();
  const total = Object.values(quantities).reduce((a, b) => a + b, 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      lines: lines.filter((l) => (quantities[l.id] ?? 0) > 0).map((l) => ({ orderLineId: l.id, quantity: quantities[l.id] ?? 0 })),
      ...(locationId ? { locationId } : {}),
      carrierCode: carrierCode === "none" ? null : carrierCode,
      trackingNumber: trackingNumber.trim() || null,
      trackingUrl: trackingUrl.trim() || null,
      notifyCustomer: notify,
    };
    const done = await run(() => bff<Fulfillment>(`${apiBase}/orders/${detail.order.id}/fulfillments`, { method: "POST", body }), t("orders.fulfill.success"));
    if (done) onOpenChange(false);
  };

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={t("orders.fulfill.title")}
      description={t("orders.fulfill.description")}
      width={640}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" type="submit" form="fulfill-form" loading={pending} disabled={total === 0}>
            {t("orders.fulfill.submit", { count: total })}
          </Button>
        </>
      }
    >
      <form id="fulfill-form" onSubmit={submit} className="flex flex-col gap-5 px-5 py-4">
        <MutationError error={error} />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-base font-medium text-fg">{t("orders.fulfill.items")}</legend>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {lines.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-base text-fg">{lineLabel(l)}</span>
                  <span className="text-sm text-fg-muted">
                    {l.sku ? `${l.sku} · ` : ""}
                    {t("orders.fulfill.remaining", { count: fulfillableQuantity(l) })}
                  </span>
                </div>
                <QuantityInput
                  label={t("orders.fulfill.quantityFor", { name: lineLabel(l) })}
                  value={quantities[l.id] ?? 0}
                  max={fulfillableQuantity(l)}
                  onChange={(n) => setQuantities((q) => ({ ...q, [l.id]: n }))}
                />
              </li>
            ))}
          </ul>
        </fieldset>
        {activeLocations.length > 0 ? (
          <Field label={t("orders.fulfill.location")} description={t("orders.fulfill.locationHint")}>
            <Select value={locationId} onValueChange={setLocationId} options={activeLocations.map((l) => ({ value: l.id, label: l.name }))} />
          </Field>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("orders.fulfill.carrier")} optional>
            <Select value={carrierCode} onValueChange={setCarrierCode} options={[{ value: "none", label: t("orders.fulfill.noCarrier") }, ...carriers.map((c) => ({ value: c.code, label: c.name }))]} />
          </Field>
          <Field label={t("orders.fulfill.trackingNumber")} optional description={t("orders.fulfill.trackingNumberHint")}>
            <Input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} maxLength={100} autoComplete="off" />
          </Field>
        </div>
        <Field label={t("orders.fulfill.trackingUrl")} optional description={t("orders.fulfill.trackingUrlHint")}>
          <Input type="url" value={trackingUrl} onChange={(e) => setTrackingUrl(e.target.value)} placeholder="https://" inputMode="url" />
        </Field>
        <Switch checked={notify} onCheckedChange={setNotify} label={t("orders.fulfill.notify")} description={t("orders.fulfill.notifyHint")} />
      </form>
    </Drawer>
  );
}

export function TrackingDialog({ fulfillment, carriers, open, onOpenChange }: { fulfillment: Fulfillment; carriers: Carrier[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n();
  const { apiBase } = useStore();
  const [carrierCode, setCarrierCode] = useState(fulfillment.carrierCode ?? "none");
  const [trackingNumber, setTrackingNumber] = useState(fulfillment.trackingNumber ?? "");
  const [trackingUrl, setTrackingUrl] = useState(fulfillment.trackingUrl ?? "");
  const [status, setStatus] = useState(["in_progress", "shipped", "delivered"].includes(fulfillment.status) ? fulfillment.status : "keep");
  const { pending, error, run } = useOrderMutation();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      carrierCode: carrierCode === "none" ? null : carrierCode,
      trackingNumber: trackingNumber.trim() || null,
      trackingUrl: trackingUrl.trim() || null,
      ...(status !== "keep" ? { status } : {}),
    };
    const done = await run(() => bff<Fulfillment>(`${apiBase}/fulfillments/${fulfillment.id}`, { method: "PATCH", body }), t("orders.tracking.success"));
    if (done) onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("orders.tracking.title")}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" type="submit" form={`tracking-${fulfillment.id}`} loading={pending}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form id={`tracking-${fulfillment.id}`} onSubmit={submit} className="flex flex-col gap-4">
        <MutationError error={error} />
        <Field label={t("orders.fulfill.carrier")}>
          <Select value={carrierCode} onValueChange={setCarrierCode} options={[{ value: "none", label: t("orders.fulfill.noCarrier") }, ...carriers.map((c) => ({ value: c.code, label: c.name }))]} />
        </Field>
        <Field label={t("orders.fulfill.trackingNumber")}>
          <Input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} maxLength={100} autoComplete="off" />
        </Field>
        <Field label={t("orders.fulfill.trackingUrl")} optional description={t("orders.fulfill.trackingUrlHint")}>
          <Input type="url" value={trackingUrl} onChange={(e) => setTrackingUrl(e.target.value)} placeholder="https://" inputMode="url" />
        </Field>
        <Field label={t("orders.tracking.status")}>
          <Select
            value={status}
            onValueChange={setStatus}
            options={[
              ...(["in_progress", "shipped", "delivered"].includes(fulfillment.status) ? [] : [{ value: "keep", label: t("orders.tracking.keepStatus") }]),
              { value: "in_progress", label: t("statuses.shipment.in_progress") },
              { value: "shipped", label: t("statuses.shipment.shipped") },
              { value: "delivered", label: t("statuses.shipment.delivered") },
            ]}
          />
        </Field>
      </form>
    </Dialog>
  );
}

export function CancelFulfillmentDialog({ fulfillment, open, onOpenChange }: { fulfillment: Fulfillment; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n();
  const { apiBase } = useStore();
  const { pending, error, run } = useOrderMutation();
  return (
    <AlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("orders.cancelFulfillment.title")}
      description={t("orders.cancelFulfillment.body")}
      confirmLabel={t("orders.cancelFulfillment.confirm")}
      pending={pending}
      onConfirm={async () => {
        const done = await run(() => bff<void>(`${apiBase}/fulfillments/${fulfillment.id}/cancel`, { method: "POST" }).then(() => true), t("orders.cancelFulfillment.success"));
        if (done) onOpenChange(false);
      }}
    >
      <MutationError error={error} />
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Refund
// ---------------------------------------------------------------------------

export function RefundDialog({ detail, supportsPartial, open, onOpenChange }: { detail: OrderDetail; supportsPartial: boolean | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, describeError } = useI18n();
  const { apiBase } = useStore();
  const router = useRouter();
  const { toast } = useToast();
  const { order } = detail;
  const lines = detail.lines.filter((l) => refundableQuantity(l) > 0);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [shipping, setShipping] = useState<string | null>(null);
  const [additional, setAdditional] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  // One key per refund attempt. It is kept when no answer arrived (network error, timeout, 5xx), so
  // a retry cannot refund twice; it is renewed after a definitive answer (the provider declined,
  // or the API rejected the request), because the API returns the recorded refund for a known key
  // without calling the provider again.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const refundable = refundableTotal(detail);
  const linesAmount = useMemo(() => lines.reduce((s, l) => s + lineRefundAmount(detail, l, quantities[l.id] ?? 0), 0n), [lines, detail, quantities]);
  const amount = linesAmount + BigInt(shipping ?? "0") + BigInt(additional ?? "0");
  const tooMuch = amount > refundable;
  const shippingTooMuch = BigInt(shipping ?? "0") > BigInt(order.shippingTotal);

  const fillAll = () => {
    setQuantities(Object.fromEntries(lines.map((l) => [l.id, refundableQuantity(l)])));
    const shippingLeft = BigInt(order.shippingTotal);
    setShipping(shippingLeft > 0n ? shippingLeft.toString() : null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    setFailed(null);
    try {
      const refund = await bff<Refund>(`${apiBase}/orders/${order.id}/refunds`, {
        method: "POST",
        body: {
          lines: lines.filter((l) => (quantities[l.id] ?? 0) > 0).map((l) => ({ orderLineId: l.id, quantity: quantities[l.id] ?? 0 })),
          shippingAmount: shipping ?? "0",
          additionalAmount: additional ?? "0",
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          idempotencyKey,
        },
      });
      router.refresh();
      if (refund.status === "failed") {
        // The refund row is kept (status failed); the provider's reason is shown here and the next
        // submission is a new attempt.
        setFailed(refund.failureReason ?? "");
        setIdempotencyKey(crypto.randomUUID());
      } else {
        toast({ tone: "success", title: refund.status === "succeeded" ? t("orders.refund.success") : t("orders.refund.pending") });
        onOpenChange(false);
      }
    } catch (err) {
      const info = toInfo(err);
      setError(info);
      if (info.status >= 400 && info.status < 500 && info.status !== 408) setIdempotencyKey(crypto.randomUUID());
    } finally {
      setPending(false);
    }
  };

  const described = error ? describeError(error) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      modalLock
      title={t("orders.refund.title", { number: order.number })}
      description={t("orders.refund.description")}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" type="submit" form="refund-form" loading={pending} disabled={amount <= 0n || tooMuch || shippingTooMuch}>
            {t("orders.refund.submit")}
          </Button>
        </>
      }
    >
      <form id="refund-form" onSubmit={submit} className="flex flex-col gap-4">
        {described ? (
          <FormAlert tone="danger" focusKey={error}>
            {described.message}
          </FormAlert>
        ) : null}
        {failed !== null ? (
          <FormAlert tone="danger" title={t("orders.refund.failedTitle")} focusKey={failed || "failed"}>
            {t("orders.refund.failedBody")}
            {failed ? <span className="mt-1 block font-mono text-sm">{failed}</span> : null}
          </FormAlert>
        ) : null}
        {supportsPartial === false ? <p className="text-sm text-warning">{t("orders.refund.noPartial")}</p> : null}
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-fg-muted">
            {t("orders.refund.refundable")}: <Money amount={refundable.toString()} currency={order.currency} className="font-medium text-fg" />
          </p>
          <Button size="sm" onClick={fillAll}>
            {t("orders.refund.all")}
          </Button>
        </div>
        {lines.length > 0 ? (
          <fieldset>
            <legend className="mb-2 text-base font-medium text-fg">{t("orders.refund.items")}</legend>
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {lines.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-base text-fg">{lineLabel(l)}</span>
                    <span className="text-sm text-fg-muted">
                      {t("orders.refund.lineInfo", { count: refundableQuantity(l) })} · <Money amount={l.total} currency={order.currency} />
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Money amount={lineRefundAmount(detail, l, quantities[l.id] ?? 0).toString()} currency={order.currency} className="text-sm text-fg-muted" />
                    <QuantityInput
                      label={t("orders.refund.quantityFor", { name: lineLabel(l) })}
                      value={quantities[l.id] ?? 0}
                      max={refundableQuantity(l)}
                      onChange={(n) => setQuantities((q) => ({ ...q, [l.id]: n }))}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </fieldset>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          {BigInt(order.shippingTotal) > 0n ? (
            <Field label={t("orders.refund.shipping")} optional error={shippingTooMuch ? t("orders.refund.shippingTooMuch") : null} description={t("orders.refund.shippingHint")}>
              <MoneyInput currency={order.currency} value={shipping} onChange={setShipping} />
            </Field>
          ) : null}
          <Field label={t("orders.refund.additional")} optional description={t("orders.refund.additionalHint")}>
            <MoneyInput currency={order.currency} value={additional} onChange={setAdditional} />
          </Field>
        </div>
        <Field label={t("orders.refund.reason")} optional>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} />
        </Field>
        <div className="flex items-center justify-between rounded-lg bg-surface-muted px-3 py-2" aria-live="polite">
          <span className="text-base font-medium text-fg">{t("orders.refund.total")}</span>
          <Money amount={amount.toString()} currency={order.currency} className="text-md font-semibold" />
        </div>
        {tooMuch ? <p className="text-sm text-danger">{t("orders.refund.tooMuch")}</p> : null}
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Cancel order
// ---------------------------------------------------------------------------

export function CancelOrderDialog({ detail, open, onOpenChange }: { detail: OrderDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n();
  const { apiBase } = useStore();
  const [reason, setReason] = useState("");
  const [refund, setRefund] = useState(true);
  const [restock, setRestock] = useState(true);
  const { pending, error, run } = useOrderMutation();
  const paid = ["paid", "partially_refunded"].includes(detail.order.paymentStatus);
  return (
    <AlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("orders.cancel.title", { number: detail.order.number })}
      description={paid ? t("orders.cancel.bodyPaid") : t("orders.cancel.body")}
      confirmLabel={t("orders.cancel.confirm")}
      confirmDisabled={!reason.trim()}
      pending={pending}
      onConfirm={async () => {
        const done = await run(
          () => bff<unknown>(`${apiBase}/orders/${detail.order.id}/cancel`, { method: "POST", body: { reason: reason.trim(), refund, restock } }),
          t("orders.cancel.success"),
        );
        if (done) onOpenChange(false);
      }}
    >
      <div className="flex flex-col gap-4">
        <MutationError error={error} />
        <Field label={t("orders.cancel.reason")} required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} />
        </Field>
        {paid ? <Switch checked={refund} onCheckedChange={setRefund} label={t("orders.cancel.refund")} description={t("orders.cancel.refundHint")} /> : null}
        <Switch checked={restock} onCheckedChange={setRestock} label={t("orders.cancel.restock")} />
      </div>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

export function CreateReturnDialog({ detail, open, onOpenChange }: { detail: OrderDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n();
  const { apiBase } = useStore();
  const lines = detail.lines.filter((l) => returnableQuantity(detail, l) > 0);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const { pending, error, run } = useOrderMutation();
  const count = Object.values(quantities).reduce((a, b) => a + b, 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      lines: lines
        .filter((l) => (quantities[l.id] ?? 0) > 0)
        .map((l) => ({ orderLineId: l.id, quantity: quantities[l.id] ?? 0, restock: restock[l.id] ?? true })),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
      ...(note.trim() ? { customerNote: note.trim() } : {}),
    };
    const done = await run(() => bff<unknown>(`${apiBase}/orders/${detail.order.id}/returns`, { method: "POST", body }), t("orders.returns.created"));
    if (done) onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t("orders.returns.createTitle")}
      description={t("orders.returns.createDescription")}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" type="submit" form="return-form" loading={pending} disabled={count === 0}>
            {t("orders.returns.createSubmit")}
          </Button>
        </>
      }
    >
      <form id="return-form" onSubmit={submit} className="flex flex-col gap-4">
        <MutationError error={error} />
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {lines.map((l) => (
            <li key={l.id} className="flex flex-col gap-2 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-base text-fg">{lineLabel(l)}</span>
                  <span className="text-sm text-fg-muted">{t("orders.returns.returnable", { count: returnableQuantity(detail, l) })}</span>
                </div>
                <QuantityInput
                  label={t("orders.returns.quantityFor", { name: lineLabel(l) })}
                  value={quantities[l.id] ?? 0}
                  max={returnableQuantity(detail, l)}
                  onChange={(n) => setQuantities((q) => ({ ...q, [l.id]: n }))}
                />
              </div>
              {(quantities[l.id] ?? 0) > 0 ? (
                <Checkbox checked={restock[l.id] ?? true} onCheckedChange={(c) => setRestock((r) => ({ ...r, [l.id]: c }))} label={t("orders.returns.restock")} />
              ) : null}
            </li>
          ))}
        </ul>
        <Field label={t("orders.returns.reason")} optional>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
        <Field label={t("orders.returns.customerNote")} optional>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} />
        </Field>
      </form>
    </Dialog>
  );
}

export function ReturnDecisionButton({ returnId, decision, label, tone }: { returnId: string; decision: "approved" | "rejected" | "cancelled"; label: string; tone?: "danger" }) {
  const { t } = useI18n();
  const { apiBase } = useStore();
  const router = useRouter();
  const { toast, toastError } = useToast();
  const [pending, setPending] = useState(false);
  return (
    <Button
      size="sm"
      variant={tone === "danger" ? "ghost" : "secondary"}
      loading={pending}
      onClick={async () => {
        setPending(true);
        try {
          await bff<unknown>(`${apiBase}/returns/${returnId}/decision`, { method: "POST", body: { decision } });
          toast({ tone: "success", title: t("orders.returns.decided") });
          router.refresh();
        } catch (err) {
          toastError(toInfo(err));
        } finally {
          setPending(false);
        }
      }}
    >
      {label}
    </Button>
  );
}

export function ReceiveReturnDialog({ returnId, locations, open, onOpenChange }: { returnId: string; locations: Location[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n();
  const { apiBase } = useStore();
  const active = locations.filter((l) => l.isActive);
  const [locationId, setLocationId] = useState(active[0]?.id ?? "");
  const { pending, error, run } = useOrderMutation();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={t("orders.returns.receiveTitle")}
      description={t("orders.returns.receiveDescription")}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!locationId}
            onClick={async () => {
              const done = await run(() => bff<unknown>(`${apiBase}/returns/${returnId}/receive`, { method: "POST", body: { restockLocationId: locationId } }), t("orders.returns.received"));
              if (done) onOpenChange(false);
            }}
          >
            {t("orders.returns.receive")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <MutationError error={error} />
        {active.length > 0 ? (
          <Field label={t("orders.returns.restockLocation")}>
            <Select value={locationId} onValueChange={setLocationId} options={active.map((l) => ({ value: l.id, label: l.name }))} />
          </Field>
        ) : (
          <p className="text-base text-fg-muted">{t("orders.returns.noLocations")}</p>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

export function ContactDialog({ detail, open, onOpenChange }: { detail: OrderDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, describeError } = useI18n();
  const { apiBase } = useStore();
  const [email, setEmail] = useState(detail.order.email ?? "");
  const [phone, setPhone] = useState(detail.order.phone ?? "");
  const { pending, error, run } = useOrderMutation();
  const fields = error ? describeError(error).fields : {};
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={t("orders.contact.editTitle")}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" type="submit" form="contact-form" loading={pending}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form
        id="contact-form"
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const done = await run(
            () => bff<unknown>(`${apiBase}/orders/${detail.order.id}`, { method: "PATCH", body: { ...(email.trim() ? { email: email.trim() } : {}), phone: phone.trim() || null } }),
            t("commerce.savedToast"),
          );
          if (done) onOpenChange(false);
        }}
      >
        {error && Object.keys(fields).length === 0 ? <MutationError error={error} /> : null}
        <Field label={t("orders.contact.email")} error={fields.email ?? null}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </Field>
        <Field label={t("orders.contact.phone")} optional error={fields.phone ?? null}>
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={32} autoComplete="off" />
        </Field>
      </form>
    </Dialog>
  );
}
