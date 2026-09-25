"use client";

import { Check, CreditCard, Info, KeyRound, Minus, MoreHorizontal, Power, PowerOff, ShieldCheck, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { DateTime } from "@/components/data/date-time";
import { KeyValue } from "@/components/data/key-value";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { AlertDialog, Dialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { ErrorSummary } from "@/components/ui/form-section";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedControl } from "@/components/ui/radio-group";
import { SecretInput } from "@/components/ui/secret-input";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { PaymentConnection, PaymentMode, PaymentProviderDefinition } from "@/lib/settings/types";

function Capability({ on, label }: { on: boolean; label: string }) {
  const { t } = useI18n();
  return (
    <li className="flex items-center gap-1.5 text-sm">
      {on ? <Check aria-hidden="true" className="size-4 text-success" /> : <Minus aria-hidden="true" className="size-4 text-fg-subtle" />}
      <span className={on ? "text-fg" : "text-fg-muted"}>{label}</span>
      <span className="sr-only">: {on ? t("common.yes") : t("common.no")}</span>
    </li>
  );
}

function ConnectDialog({
  provider,
  existing,
  open,
  onOpenChange,
  onConnected,
}: {
  provider: PaymentProviderDefinition;
  existing: PaymentConnection | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: (c: PaymentConnection) => void;
}) {
  const { t, describeError } = useI18n();
  const { apiBase } = useStore();
  const [mode, setMode] = useState<PaymentMode>(existing?.mode === "live" ? "live" : "test");
  const [values, setValues] = useState<Record<string, string>>({});
  const [priority, setPriority] = useState(String(existing?.priority ?? 0));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const name = t.maybe(`payments.providers.${provider.name}.name`) ?? provider.name;
  const described = error ? describeError(error) : null;
  const providerMessage = error && typeof (error.details as { message?: unknown } | undefined)?.message === "string" ? (error.details as { message: string }).message : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const credentials = Object.fromEntries(provider.credentialFields.map((f) => [f.key, (values[f.key] ?? "").trim()]));
      const p = Number.parseInt(priority, 10);
      const connection = await bff<PaymentConnection>(`${apiBase}/payment-connections`, {
        method: "POST",
        body: { provider: provider.name, mode, credentials, priority: Number.isFinite(p) ? p : 0 },
      });
      // Credentials are cleared as soon as they are accepted; they are never shown again.
      setValues({});
      onConnected(connection);
      onOpenChange(false);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err.toInfo());
    } finally {
      setPending(false);
    }
  };

  const incomplete = provider.credentialFields.some((f) => !(values[f.key] ?? "").trim());

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setValues({});
          setError(null);
        }
        onOpenChange(o);
      }}
      title={existing ? t("payments.dialog.updateTitle", { provider: name }) : t("payments.dialog.connectTitle", { provider: name })}
      description={t("payments.dialog.description")}
      size="md"
      modalLock
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="payment-connect-form" variant="primary" loading={pending} disabled={incomplete}>
            <ShieldCheck aria-hidden="true" />
            {t("payments.dialog.submit")}
          </Button>
        </>
      }
    >
      <form id="payment-connect-form" onSubmit={submit} noValidate autoComplete="off" className="flex flex-col gap-4">
        {described ? (
          <ErrorSummary message={providerMessage ? `${described.message} ${t("payments.dialog.providerSaid", { message: providerMessage })}` : described.message} items={[]} />
        ) : null}
        <div className="flex flex-col gap-1.5">
          <span aria-hidden="true" className="text-base font-medium text-fg">
            {t("payments.mode.label")}
          </span>
          <SegmentedControl
            aria-label={t("payments.mode.label")}
            value={mode}
            onValueChange={(v) => setMode(v as PaymentMode)}
            options={[
              { value: "test", label: t("payments.mode.test") },
              { value: "live", label: t("payments.mode.live") },
            ]}
          />
          <p className="text-sm text-fg-muted">{mode === "test" ? t("payments.mode.testHelp") : t("payments.mode.liveHelp")}</p>
        </div>
        {provider.credentialFields.map((f) => (
          <Field key={f.key} label={t.maybe(f.labelKey) ?? f.key} required description={f.secret ? t("payments.dialog.secretHelp") : undefined}>
            {f.secret ? (
              <SecretInput saved={false} value={values[f.key] ?? ""} onChange={(v) => setValues((cur) => ({ ...cur, [f.key]: v ?? "" }))} removable={false} />
            ) : (
              <Input value={values[f.key] ?? ""} spellCheck={false} autoComplete="off" className="font-mono" onChange={(e) => setValues((cur) => ({ ...cur, [f.key]: e.target.value }))} />
            )}
          </Field>
        ))}
        <Field label={t("payments.dialog.priority")} description={t("payments.dialog.priorityHelp")} optional>
          <Input type="number" inputMode="numeric" min={0} max={100} value={priority} onChange={(e) => setPriority(e.target.value)} className="w-28" />
        </Field>
        {existing ? <InlineAlert tone="info">{t("payments.dialog.replaceNote")}</InlineAlert> : null}
        <p className="text-sm text-fg-muted">{t("payments.dialog.verifyNote")}</p>
      </form>
    </Dialog>
  );
}

function ProviderCard({
  provider,
  connection,
  canManage,
  onChanged,
  onRemoved,
}: {
  provider: PaymentProviderDefinition;
  connection: PaymentConnection | null;
  canManage: boolean;
  onChanged: (c: PaymentConnection) => void;
  onRemoved: (id: string) => void;
}) {
  const { t, describeError } = useI18n();
  const { apiBase } = useStore();
  const { toast, toastError } = useToast();
  const [connecting, setConnecting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removeError, setRemoveError] = useState<ApiErrorInfo | null>(null);
  const name = t.maybe(`payments.providers.${provider.name}.name`) ?? provider.name;
  const summary = t.maybe(`payments.providers.${provider.name}.summary`);
  const panelHelp = t.maybe(`payments.providers.${provider.name}.notificationHelp`);

  const setStatus = async (status: "active" | "disabled") => {
    if (!connection) return;
    setBusy(true);
    try {
      const updated = await bff<PaymentConnection>(`${apiBase}/payment-connections/${connection.id}`, { method: "PATCH", body: { status } });
      onChanged(updated);
      toast({ tone: "success", title: status === "active" ? t("payments.enabled", { provider: name }) : t("payments.disabled", { provider: name }) });
    } catch (err) {
      if (err instanceof ApiError) toastError(err.toInfo());
      else throw err;
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!connection) return;
    setBusy(true);
    setRemoveError(null);
    try {
      await bff<void>(`${apiBase}/payment-connections/${connection.id}`, { method: "DELETE" });
      onRemoved(connection.id);
      setRemoving(false);
      toast({ tone: "success", title: t("payments.removed", { provider: name }) });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setRemoveError(err.toInfo());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      as="article"
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          <CreditCard aria-hidden="true" className="size-4 text-fg-muted" />
          {name}
          {connection ? <StatusPill domain="paymentConnection" value={connection.status} /> : null}
          {connection ? <StatusPill domain="paymentMode" value={connection.mode} noDot /> : null}
        </span>
      }
      description={summary ?? undefined}
      actions={
        canManage ? (
          connection ? (
            <>
              <Button size="sm" onClick={() => setConnecting(true)} disabled={busy}>
                <KeyRound aria-hidden="true" />
                {t("payments.updateCredentials")}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label={t("common.rowActions", { name })} disabled={busy}>
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {connection.status === "active" ? (
                    <DropdownMenuItem onSelect={() => void setStatus("disabled")}>
                      <PowerOff aria-hidden="true" />
                      {t("payments.disable")}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={() => void setStatus("active")}>
                      <Power aria-hidden="true" />
                      {t("payments.enable")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem tone="danger" onSelect={() => setRemoving(true)}>
                    <Trash2 aria-hidden="true" />
                    {t("payments.remove")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <Button variant="primary" size="sm" onClick={() => setConnecting(true)}>
              {t("payments.connect")}
            </Button>
          )
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        {connection ? (
          <>
            {connection.lastError ? (
              <InlineAlert tone="danger" title={t("payments.lastError")}>
                {connection.lastError}
              </InlineAlert>
            ) : null}
            {connection.mode === "test" ? <InlineAlert tone="warning">{t("payments.testModeNote")}</InlineAlert> : null}
            <KeyValue
              items={[
                { label: t("payments.account"), value: connection.displayHint ?? t("common.none"), mono: true },
                { label: t("payments.verifiedAt"), value: <DateTime value={connection.lastVerifiedAt} /> },
                { label: t("payments.priority"), value: String(connection.priority) },
                { label: t("payments.connectedAt"), value: <DateTime value={connection.createdAt} format="date" /> },
              ]}
            />
            <div className="flex flex-col gap-2">
              <h3 className="text-base font-medium text-fg">{t("payments.notification.title")}</h3>
              {connection.notificationUrlSetting === "provider_panel" ? (
                <>
                  <p className="text-sm text-fg-muted">{panelHelp ?? t("payments.notification.panel")}</p>
                  <CodeBlock value={connection.notificationUrl} label={t("payments.notification.url")} caption={t("payments.notification.url")} />
                </>
              ) : (
                <p className="text-sm text-fg-muted">{t("payments.notification.perRequest")}</p>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-fg-muted">{t("payments.notConnected")}</p>
        )}
        <div className="flex flex-col gap-1.5">
          <h3 className="text-base font-medium text-fg">{t("payments.capabilities.title")}</h3>
          <ul className="flex flex-wrap gap-x-5 gap-y-1">
            <Capability on={provider.supportsPartialRefund} label={t("payments.capabilities.partialRefund")} />
            <Capability on={provider.supportsCancel} label={t("payments.capabilities.cancel")} />
          </ul>
          {provider.requiresPhone ? (
            <p className="flex items-start gap-1.5 text-sm text-fg-muted">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {t("payments.requiresPhoneNote")}
            </p>
          ) : null}
        </div>
      </div>
      {canManage ? (
        <ConnectDialog
          key={connection?.id ?? "new"}
          provider={provider}
          existing={connection}
          open={connecting}
          onOpenChange={setConnecting}
          onConnected={(c) => {
            onChanged(c);
            toast({ tone: "success", title: connection ? t("payments.updated", { provider: name }) : t("payments.connected", { provider: name }) });
          }}
        />
      ) : null}
      <AlertDialog
        open={removing}
        onOpenChange={(o) => {
          setRemoving(o);
          if (!o) setRemoveError(null);
        }}
        title={t("payments.removeTitle", { provider: name })}
        description={t("payments.removeBody")}
        confirmLabel={t("payments.remove")}
        pending={busy}
        onConfirm={() => void remove()}
      >
        {removeError ? (
          <InlineAlert tone="danger" live="alert">
            {describeError(removeError).message}
          </InlineAlert>
        ) : null}
      </AlertDialog>
    </Card>
  );
}

/**
 * Settings › Payments: the merchant's own PayTR and iyzico accounts. Credentials are verified with
 * the provider before they are stored (encrypted) and are never shown again; the card shows the
 * masked account, the mode, the notification address to configure and what the provider supports.
 */
export function PaymentsManager({ providers, initial }: { providers: PaymentProviderDefinition[]; initial: PaymentConnection[] }) {
  const { t } = useI18n();
  const { can } = useStore();
  const [connections, setConnections] = useState(initial);
  const canManage = can("payments:manage");
  const upsert = (c: PaymentConnection) => setConnections((cur) => [...cur.filter((x) => x.id !== c.id && x.provider !== c.provider), c]);
  const active = connections.filter((c) => c.status === "active");
  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6">
      <PageHeader title={t("payments.title")} meta={t("payments.meta")} />
      {!canManage ? <InlineAlert tone="info">{t("payments.readOnly")}</InlineAlert> : null}
      {active.length === 0 ? (
        <InlineAlert tone="warning" title={t("payments.noActiveTitle")}>
          {t("payments.noActiveBody")}
        </InlineAlert>
      ) : null}
      {providers.map((p) => (
        <ProviderCard
          key={p.name}
          provider={p}
          connection={connections.find((c) => c.provider === p.name) ?? null}
          canManage={canManage}
          onChanged={upsert}
          onRemoved={(id) => setConnections((cur) => cur.filter((c) => c.id !== id))}
        />
      ))}
    </div>
  );
}
