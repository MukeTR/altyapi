"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { SearchX, SlidersHorizontal, Warehouse } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { FormAlert } from "@/components/auth/form-alert";
import { FilterTabs } from "@/components/commerce/filter-tabs";
import { SearchField } from "@/components/commerce/search-field";
import { Thumb } from "@/components/commerce/thumb";
import { useUrlFilters } from "@/components/commerce/use-url-filters";
import { CursorPagination } from "@/components/data/pagination";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/radio-group";
import { Select } from "@/components/ui/select";
import { SkeletonTable } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { ApiResult } from "@/lib/api/server";
import { mediaUrl, type MediaConfig } from "@/lib/commerce/media";
import type { Location, ProductVariant, StockByLocation } from "@/lib/commerce/types";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";

export interface InventoryRow {
  productId: string;
  productTitle: string;
  productStatus: string;
  imageObjectKey: string | null;
  variantId: string;
  variantTitle: string;
  sku: string | null;
  trackInventory: boolean;
  allowBackorder: boolean;
  inventory: ProductVariant["inventory"];
}

const REASONS = ["count", "received", "damaged", "correction", "returned"] as const;

export function InventoryView({
  page,
  locations,
  locationsError,
  detailError,
  stockOwner,
  filtered,
  media,
}: {
  page: ApiResult<{ rows: InventoryRow[]; nextCursor: string | null }>;
  locations: Location[];
  locationsError: ApiErrorInfo | null;
  detailError: ApiErrorInfo | null;
  stockOwner: string | null;
  filtered: boolean;
  media: MediaConfig;
}) {
  const { t, locale } = useI18n();
  const { basePath, can } = useStore();
  const { params, pending, clearHref } = useUrlFilters();
  const [adjusting, setAdjusting] = useState<InventoryRow | null>(null);
  const canWrite = can("inventory:write");
  const shown = locations.filter((l) => l.isActive);

  const levelAt = (row: InventoryRow, locationId: string): StockByLocation | undefined => row.inventory?.byLocation.find((b) => b.locationId === locationId);

  return (
    <div className="flex flex-col gap-4">
      {stockOwner ? <InlineAlert tone="warning" title={t("inventory.owned.title", { owner: stockOwner })}>{t("inventory.owned.body")}</InlineAlert> : null}
      {locationsError ? <ErrorState error={locationsError} compact /> : null}
      {detailError ? <InlineAlert tone="danger">{t("inventory.partialError")}</InlineAlert> : null}
      <section aria-label={t("inventory.title")} className="min-w-0 rounded-lg border border-border bg-surface">
        <FilterTabs
          param="status"
          aria-label={t("products.tabsLabel")}
          tabs={[
            { value: null, label: t("commerce.filters.all") },
            { value: "active", label: t("statuses.product.active") },
            { value: "draft", label: t("statuses.product.draft") },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <SearchField label={t("inventory.searchLabel")} className="w-full sm:w-80" />
          {filtered ? (
            <ButtonLink href={clearHref} variant="ghost" className="ms-auto">
              {t("commerce.filters.clear")}
            </ButtonLink>
          ) : null}
          <Link href={`${basePath}/inventory/locations`} className={cn("text-sm", !filtered && "ms-auto")}>
            {t("inventory.manageLocations")}
          </Link>
        </div>
        <div className={cn("transition-opacity", pending && "opacity-60")} aria-busy={pending || undefined}>
          {!page.ok ? (
            <ErrorState error={page.error} />
          ) : pending && page.data.rows.length === 0 ? (
            <SkeletonTable columns={4} label={t("ui.table.loadingRows")} />
          ) : page.data.rows.length === 0 ? (
            filtered ? (
              <EmptyState
                icon={SearchX}
                title={t("states.emptyFilteredTitle")}
                description={t("states.emptyFilteredBody")}
                actions={
                  <ButtonLink href={clearHref} variant="secondary">
                    {t("states.clearFilters")}
                  </ButtonLink>
                }
              />
            ) : (
              <EmptyState
                icon={Warehouse}
                title={t("inventory.empty.title")}
                description={t("inventory.empty.body")}
                actions={
                  can("catalog:write") ? (
                    <ButtonLink href={`${basePath}/products/new`} variant="primary">
                      {t("products.actions.new")}
                    </ButtonLink>
                  ) : null
                }
              />
            )
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full border-collapse text-base">
                <caption className="sr-only">{t("inventory.caption")}</caption>
                <thead className="bg-surface-muted">
                  <tr className="border-b border-border text-xs text-fg-muted">
                    <th scope="col" className="h-9 px-3 text-start font-medium">
                      {t("inventory.columns.item")}
                    </th>
                    {shown.map((l) => (
                      <th key={l.id} scope="col" className="h-9 whitespace-nowrap px-3 text-end font-medium">
                        {l.name}
                      </th>
                    ))}
                    <th scope="col" className="h-9 px-3 text-end font-medium">
                      {t("inventory.columns.available")}
                    </th>
                    <th scope="col" className="h-9 px-3 text-end font-medium">
                      {t("inventory.columns.reserved")}
                    </th>
                    <th scope="col" className="h-9 px-3">
                      <span className="sr-only">{t("common.actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {page.data.rows.map((r) => {
                    const name = r.variantTitle ? `${r.productTitle} · ${r.variantTitle}` : r.productTitle;
                    const available = r.inventory?.available ?? 0;
                    return (
                      <tr key={r.variantId} className="h-12 border-b border-border last:border-b-0 hover:bg-surface-muted">
                        <th scope="row" className="px-3 py-1.5 text-start font-normal">
                          <span className="flex min-w-0 items-center gap-3">
                            <Thumb src={mediaUrl(media, r.imageObjectKey)} size={28} />
                            <span className="flex min-w-0 flex-col">
                              <Link href={`${basePath}/products/${r.productId}`} className="truncate text-fg">
                                {r.productTitle || t("products.untitled")}
                              </Link>
                              <span className="flex flex-wrap items-center gap-x-2 text-xs text-fg-subtle">
                                {r.variantTitle ? <span>{r.variantTitle}</span> : null}
                                {r.sku ? <span className="font-mono">{r.sku}</span> : null}
                                {r.productStatus !== "active" ? <Badge>{t(`statuses.product.${r.productStatus === "archived" ? "archived" : "draft"}`)}</Badge> : null}
                              </span>
                            </span>
                          </span>
                        </th>
                        {r.trackInventory ? (
                          <>
                            {shown.map((l) => {
                              const lv = levelAt(r, l.id);
                              return (
                                <td key={l.id} className="px-3 py-1.5 text-end tabular">
                                  {lv ? (
                                    <span className="flex flex-col items-end">
                                      <span>{formatNumber(lv.available, locale)}</span>
                                      {lv.reserved > 0 ? <span className="text-xs text-fg-subtle">{t("inventory.onHandShort", { onHand: formatNumber(lv.onHand, locale) })}</span> : null}
                                    </span>
                                  ) : (
                                    <span className="text-fg-subtle">0</span>
                                  )}
                                </td>
                              );
                            })}
                            <td className={cn("px-3 py-1.5 text-end font-medium tabular", available <= 0 && !r.allowBackorder && "text-danger", available > 0 && available <= 5 && "text-warning")}>
                              {formatNumber(available, locale)}
                              {available <= 0 && !r.allowBackorder ? <span className="sr-only"> ({t("inventory.outOfStock")})</span> : null}
                            </td>
                            <td className="px-3 py-1.5 text-end text-fg-muted tabular">{formatNumber(r.inventory?.reserved ?? 0, locale)}</td>
                            <td className="px-3 py-1.5 text-end">
                              {canWrite ? (
                                <Button size="sm" onClick={() => setAdjusting(r)} aria-label={t("inventory.adjustFor", { name })}>
                                  <SlidersHorizontal aria-hidden="true" />
                                  {t("inventory.adjust")}
                                </Button>
                              ) : null}
                            </td>
                          </>
                        ) : (
                          <td colSpan={shown.length + 3} className="px-3 py-1.5 text-end text-sm text-fg-subtle">
                            {t("inventory.untracked")}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {page.ok && (page.data.nextCursor || params.get("cursor")) ? <CursorPagination nextCursor={page.data.nextCursor} orderLabel={t("products.order")} /> : null}
        </div>
      </section>
      {adjusting ? <AdjustDialog row={adjusting} locations={shown} onClose={() => setAdjusting(null)} /> : null}
    </div>
  );
}

interface LevelSnapshot {
  inventoryItemId: string;
  locationId: string;
  onHand: number;
  reserved: number;
  available: number;
}

function AdjustDialog({ row, locations, onClose }: { row: InventoryRow; locations: Location[]; onClose: () => void }) {
  const { t, locale, describeError } = useI18n();
  const { apiBase } = useStore();
  const router = useRouter();
  const { toast } = useToast();
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [mode, setMode] = useState<"delta" | "set">("delta");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState<(typeof REASONS)[number]>("received");
  const [note, setNote] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const current = row.inventory?.byLocation.find((b) => b.locationId === locationId);
  const n = Number.parseInt(amount, 10);
  const valid = amount.trim() !== "" && Number.isInteger(n) && (mode === "set" ? n >= 0 : n !== 0);
  const resulting = !valid ? null : mode === "set" ? n : (current?.onHand ?? 0) + n;
  const name = row.variantTitle ? `${row.productTitle} · ${row.variantTitle}` : row.productTitle;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || !locationId) return;
    setPending(true);
    setError(null);
    const reasonText = `${t(`inventory.reasons.${reason}`)}${note.trim() ? `: ${note.trim()}` : ""}`.slice(0, 200);
    try {
      const level = await bff<LevelSnapshot>(`${apiBase}/inventory/adjustments`, {
        method: "POST",
        body: { variantId: row.variantId, locationId, ...(mode === "set" ? { setOnHand: n } : { delta: n }), reason: reasonText, idempotencyKey },
      });
      toast({ tone: "success", title: t("inventory.adjusted", { name, onHand: formatNumber(level.onHand, locale), available: formatNumber(level.available, locale) }) });
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
      title={t("inventory.dialog.title")}
      description={name}
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" type="submit" form="adjust-form" loading={pending} disabled={!valid || !locationId}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form id="adjust-form" onSubmit={submit} className="flex flex-col gap-4">
        {error ? (
          <FormAlert tone="danger" focusKey={error}>
            {describeError(error).message}
          </FormAlert>
        ) : null}
        {locations.length === 0 ? <p className="text-base text-fg-muted">{t("inventory.dialog.noLocations")}</p> : null}
        <Field label={t("inventory.dialog.location")}>
          <Select value={locationId} onValueChange={setLocationId} options={locations.map((l) => ({ value: l.id, label: l.name }))} />
        </Field>
        <p className="text-sm text-fg-muted">
          {t("inventory.dialog.current", { onHand: formatNumber(current?.onHand ?? 0, locale), reserved: formatNumber(current?.reserved ?? 0, locale), available: formatNumber(current?.available ?? 0, locale) })}
        </p>
        <SegmentedControl
          aria-label={t("inventory.dialog.mode")}
          value={mode}
          onValueChange={(v) => setMode(v as "delta" | "set")}
          options={[
            { value: "delta", label: t("inventory.dialog.delta") },
            { value: "set", label: t("inventory.dialog.set") },
          ]}
        />
        <Field label={mode === "set" ? t("inventory.dialog.countLabel") : t("inventory.dialog.deltaLabel")} description={mode === "set" ? t("inventory.dialog.countHint") : t("inventory.dialog.deltaHint")} required>
          <Input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} {...(mode === "set" ? { min: 0 } : {})} className="w-40 tabular" />
        </Field>
        {resulting !== null ? (
          <p className="text-sm text-fg" aria-live="polite">
            {t("inventory.dialog.result", { onHand: formatNumber(resulting, locale) })}
          </p>
        ) : null}
        <Field label={t("inventory.dialog.reason")}>
          <Select value={reason} onValueChange={(v) => setReason(v as (typeof REASONS)[number])} options={REASONS.map((r) => ({ value: r, label: t(`inventory.reasons.${r}`) }))} />
        </Field>
        <Field label={t("inventory.dialog.note")} optional>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={150} />
        </Field>
      </form>
    </Dialog>
  );
}
