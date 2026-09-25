"use client";

import { useRouter } from "next/navigation";
import { Plus, Tags, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { FormAlert } from "@/components/auth/form-alert";
import { DataTable, type Column } from "@/components/data/data-table";
import { DateTime } from "@/components/data/date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertDialog, Dialog } from "@/components/ui/dialog";
import { DateTimeInput } from "@/components/ui/date-time-input";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { ApiResult } from "@/lib/api/server";
import type { ItemList } from "@/lib/api/types";
import type { PriceList } from "@/lib/commerce/types";
import { formatNumber } from "@/lib/format";

/**
 * Price lists of the store. Sale and scheduled lists can be created here; customer-group and
 * channel lists need groups or channels, which have no admin endpoint yet, so they are listed
 * but not offered for creation. Prices are written from the product editor.
 */
export function PriceListsView({ result }: { result: ApiResult<ItemList<PriceList>> }) {
  const { t, locale } = useI18n();
  const { can } = useStore();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<PriceList | null>(null);
  const canWrite = can("pricing:write");
  const columns: Column<PriceList>[] = [
    { id: "name", header: t("pricelists.columns.name"), sortValue: (l) => l.name, cell: (l) => <span className="font-medium text-fg">{l.name}</span> },
    { id: "kind", header: t("pricelists.columns.kind"), sortValue: (l) => l.kind, cell: (l) => <Badge tone={l.kind === "base" ? "neutral" : "accent"}>{t(`products.priceLists.kinds.${l.kind}`)}</Badge> },
    { id: "currency", header: t("pricelists.columns.currency"), sortValue: (l) => l.currency, cell: (l) => <span className="font-mono text-sm">{l.currency}</span> },
    { id: "priority", header: t("pricelists.columns.priority"), align: "end", sortValue: (l) => l.priority, cell: (l) => formatNumber(l.priority, locale) },
    {
      id: "schedule",
      header: t("pricelists.columns.schedule"),
      cell: (l) =>
        l.schedule.length ? (
          <ul className="flex flex-col text-sm">
            {l.schedule.map((w, i) => (
              <li key={i}>
                <DateTime value={w.startsAt} /> – {w.endsAt ? <DateTime value={w.endsAt} /> : t("pricelists.openEnded")}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-fg-subtle">{t("pricelists.always")}</span>
        ),
    },
    { id: "active", header: t("pricelists.columns.status"), sortValue: (l) => (l.isActive ? 1 : 0), cell: (l) => <Badge tone={l.isActive ? "success" : "neutral"}>{l.isActive ? t("inventory.locations.active") : t("inventory.locations.inactive")}</Badge> },
    {
      id: "actions",
      header: t("common.actions"),
      srOnlyHeader: true,
      align: "end",
      cell: (l) =>
        canWrite && l.kind !== "base" ? (
          <Button size="icon-sm" variant="ghost" aria-label={t("pricelists.delete", { name: l.name })} onClick={() => setDeleting(l)}>
            <Trash2 aria-hidden="true" />
          </Button>
        ) : null,
    },
  ];
  return (
    <section aria-label={t("pricelists.title")} className="min-w-0 rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border p-3">
        <p className="text-sm text-fg-muted">{t("pricelists.description")}</p>
        {canWrite ? (
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            {t("pricelists.add")}
          </Button>
        ) : null}
      </div>
      {result.ok ? (
        <DataTable caption={t("pricelists.title")} columns={columns} rows={result.data.items} rowKey={(l) => l.id} sortable defaultSort={{ id: "priority", direction: "desc" }} empty={<EmptyState icon={Tags} title={t("pricelists.empty")} />} />
      ) : (
        <ErrorState error={result.error} />
      )}
      {creating ? <CreatePriceListDialog onClose={() => setCreating(false)} /> : null}
      {deleting ? <DeletePriceListDialog list={deleting} onClose={() => setDeleting(null)} /> : null}
    </section>
  );
}

function CreatePriceListDialog({ onClose }: { onClose: () => void }) {
  const { t, describeError } = useI18n();
  const { store, apiBase } = useStore();
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"sale" | "scheduled">("sale");
  const [currency, setCurrency] = useState(store.defaultCurrency);
  const [priority, setPriority] = useState("10");
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const fields = error ? describeError(error).fields : {};

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await bff(`${apiBase}/price-lists`, {
        method: "POST",
        body: { name: name.trim(), kind, currency, priority: Number.parseInt(priority, 10) || 0, ...(kind === "scheduled" && startsAt ? { schedule: [{ startsAt, endsAt }] } : {}) },
      });
      toast({ tone: "success", title: t("pricelists.created") });
      onClose();
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) setError(err.toInfo());
      else throw err;
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("pricelists.add")}
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" type="submit" form="price-list-form" loading={pending} disabled={!name.trim() || (kind === "scheduled" && !startsAt)}>
            {t("common.create")}
          </Button>
        </>
      }
    >
      <form id="price-list-form" onSubmit={submit} className="flex flex-col gap-4">
        {error && Object.keys(fields).length === 0 ? (
          <FormAlert tone="danger" focusKey={error}>
            {describeError(error).message}
          </FormAlert>
        ) : null}
        <Field label={t("pricelists.fields.name")} required error={fields.name ?? null}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t("pricelists.fields.namePlaceholder")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("pricelists.fields.kind")} description={t(`pricelists.kindHints.${kind}`)}>
            <Select value={kind} onValueChange={(v) => setKind(v as "sale" | "scheduled")} options={(["sale", "scheduled"] as const).map((k) => ({ value: k, label: t(`products.priceLists.kinds.${k}`) }))} />
          </Field>
          <Field label={t("pricelists.fields.currency")}>
            <Select value={currency} onValueChange={setCurrency} options={store.supportedCurrencies.map((c) => ({ value: c, label: c }))} />
          </Field>
        </div>
        <Field label={t("pricelists.fields.priority")} description={t("pricelists.fields.priorityHint")} error={fields.priority ?? null}>
          <Input type="number" inputMode="numeric" min={-1000} max={1000} value={priority} onChange={(e) => setPriority(e.target.value)} className="w-32 tabular" />
        </Field>
        {kind === "scheduled" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("pricelists.fields.startsAt")} required>
              <DateTimeInput value={startsAt} onChange={setStartsAt} />
            </Field>
            <Field label={t("pricelists.fields.endsAt")} optional>
              <DateTimeInput value={endsAt} onChange={setEndsAt} />
            </Field>
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}

function DeletePriceListDialog({ list, onClose }: { list: PriceList; onClose: () => void }) {
  const { t } = useI18n();
  const { apiBase } = useStore();
  const router = useRouter();
  const { toast, toastError } = useToast();
  const [pending, setPending] = useState(false);
  return (
    <AlertDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("pricelists.deleteTitle", { name: list.name })}
      description={t("pricelists.deleteBody")}
      confirmLabel={t("common.delete")}
      pending={pending}
      onConfirm={async () => {
        setPending(true);
        try {
          await bff(`${apiBase}/price-lists/${list.id}`, { method: "DELETE" });
          toast({ tone: "success", title: t("pricelists.deleted") });
          onClose();
          router.refresh();
        } catch (err) {
          if (err instanceof ApiError) toastError(err.toInfo());
          else throw err;
        } finally {
          setPending(false);
        }
      }}
    />
  );
}
