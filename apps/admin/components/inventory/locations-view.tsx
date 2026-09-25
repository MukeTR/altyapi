"use client";

import { useRouter } from "next/navigation";
import { MapPin, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { FormAlert } from "@/components/auth/form-alert";
import { DataTable, type Column } from "@/components/data/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { ApiResult } from "@/lib/api/server";
import type { ItemList } from "@/lib/api/types";
import type { Location } from "@/lib/commerce/types";
import { formatNumber } from "@/lib/format";
import { slugify } from "@/lib/slug";

export function LocationsView({ result }: { result: ApiResult<ItemList<Location>> }) {
  const { t, locale } = useI18n();
  const { can } = useStore();
  const [open, setOpen] = useState(false);
  const canWrite = can("inventory:write");
  const columns: Column<Location>[] = [
    {
      id: "name",
      header: t("inventory.locations.columns.name"),
      sortValue: (l) => l.name,
      cell: (l) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{l.name}</span>
          <span className="font-mono text-xs text-fg-subtle">{l.code}</span>
        </span>
      ),
    },
    {
      id: "address",
      header: t("inventory.locations.columns.address"),
      cell: (l) => <span className="text-fg-muted">{l.address ? [l.address.line1, l.address.district, l.address.city].filter(Boolean).join(", ") : t("common.none")}</span>,
    },
    { id: "status", header: t("inventory.locations.columns.status"), sortValue: (l) => (l.isActive ? 1 : 0), cell: (l) => <Badge tone={l.isActive ? "success" : "neutral"}>{l.isActive ? t("inventory.locations.active") : t("inventory.locations.inactive")}</Badge> },
    { id: "online", header: t("inventory.locations.columns.online"), sortValue: (l) => (l.fulfillsOnlineOrders ? 1 : 0), cell: (l) => (l.fulfillsOnlineOrders ? t("common.yes") : t("common.no")) },
    { id: "priority", header: t("inventory.locations.columns.priority"), align: "end", sortValue: (l) => l.priority, cell: (l) => formatNumber(l.priority, locale) },
  ];
  return (
    <section aria-label={t("inventory.locations.title")} className="min-w-0 rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border p-3">
        <p className="text-sm text-fg-muted">{t("inventory.locations.description")}</p>
        {canWrite ? (
          <Button variant="primary" onClick={() => setOpen(true)}>
            <Plus aria-hidden="true" />
            {t("inventory.locations.add")}
          </Button>
        ) : null}
      </div>
      {result.ok ? (
        <DataTable
          caption={t("inventory.locations.title")}
          columns={columns}
          rows={result.data.items}
          rowKey={(l) => l.id}
          sortable
          defaultSort={{ id: "priority", direction: "asc" }}
          empty={<EmptyState icon={MapPin} title={t("inventory.locations.empty")} />}
        />
      ) : (
        <ErrorState error={result.error} />
      )}
      {open ? <AddLocationDialog onClose={() => setOpen(false)} /> : null}
    </section>
  );
}

function AddLocationDialog({ onClose }: { onClose: () => void }) {
  const { t, describeError } = useI18n();
  const { apiBase } = useStore();
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [line1, setLine1] = useState("");
  const [district, setDistrict] = useState("");
  const [city, setCity] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [online, setOnline] = useState(true);
  const [priority, setPriority] = useState("0");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const fields = error ? describeError(error).fields : {};
  const effectiveCode = codeTouched ? code : slugify(name).slice(0, 40);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const address = Object.fromEntries(Object.entries({ line1, district, city }).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
    try {
      await bff(`${apiBase}/inventory/locations`, {
        method: "POST",
        body: { name: name.trim(), code: effectiveCode, isActive, fulfillsOnlineOrders: online, priority: Number.parseInt(priority, 10) || 0, ...(Object.keys(address).length ? { address } : {}) },
      });
      toast({ tone: "success", title: t("inventory.locations.created") });
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
      title={t("inventory.locations.add")}
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" type="submit" form="location-form" loading={pending} disabled={!name.trim() || !effectiveCode}>
            {t("common.create")}
          </Button>
        </>
      }
    >
      <form id="location-form" onSubmit={submit} className="flex flex-col gap-4">
        {error && Object.keys(fields).length === 0 ? (
          <FormAlert tone="danger" focusKey={error}>
            {describeError(error).message}
          </FormAlert>
        ) : null}
        <Field label={t("inventory.locations.fields.name")} required error={fields.name ?? null}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        <Field label={t("inventory.locations.fields.code")} required description={t("inventory.locations.fields.codeHint")} error={fields.code ?? null}>
          <Input
            value={effectiveCode}
            onChange={(e) => {
              setCodeTouched(true);
              setCode(e.target.value.toLowerCase());
            }}
            maxLength={40}
            className="font-mono"
          />
        </Field>
        <Field label={t("inventory.locations.fields.line1")} optional>
          <Input value={line1} onChange={(e) => setLine1(e.target.value)} maxLength={200} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("inventory.locations.fields.district")} optional>
            <Input value={district} onChange={(e) => setDistrict(e.target.value)} maxLength={200} />
          </Field>
          <Field label={t("inventory.locations.fields.city")} optional>
            <Input value={city} onChange={(e) => setCity(e.target.value)} maxLength={200} />
          </Field>
        </div>
        <Switch checked={isActive} onCheckedChange={setIsActive} label={t("inventory.locations.fields.isActive")} />
        <Switch checked={online} onCheckedChange={setOnline} label={t("inventory.locations.fields.online")} description={t("inventory.locations.fields.onlineHint")} />
        <Field label={t("inventory.locations.fields.priority")} description={t("inventory.locations.fields.priorityHint")} error={fields.priority ?? null}>
          <Input type="number" inputMode="numeric" min={0} max={1000} value={priority} onChange={(e) => setPriority(e.target.value)} className="w-32 tabular" />
        </Field>
      </form>
    </Dialog>
  );
}
