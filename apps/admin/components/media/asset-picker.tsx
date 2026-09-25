"use client";

import { ImagePlus, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FileDropzone } from "@/components/ui/file-dropzone";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { cn } from "@/lib/cn";
import type { Asset } from "@/lib/media/types";
import { AssetImage } from "./asset-image";
import { rememberAsset, useAsset } from "./use-asset";
import { useUploader } from "./use-uploader";

const PAGE_SIZE = 40;

export interface AssetFieldProps {
  /** Visible label (the field is a group labelled by it). */
  label: string;
  description?: string;
  value: string | null;
  onChange: (assetId: string | null) => void;
  disabled?: boolean;
  /** Error from the API for this field. */
  error?: string | null;
  /** Allow clearing the value (nullable props). */
  clearable?: boolean;
}

/**
 * Image reference field: shows the chosen image and opens the media library to pick or upload
 * another one. Only ready images of the store can be chosen.
 */
export function AssetField({ label, description, value, onChange, disabled, error, clearable = true }: AssetFieldProps) {
  const { t, locale } = useI18n();
  const { can, store } = useStore();
  const labelId = useId();
  const descId = useId();
  const [open, setOpen] = useState(false);
  const state = useAsset(value);
  const canRead = can("media:read");
  const alt = state.status === "ready" ? (state.asset.altText[locale] ?? state.asset.altText[store.defaultLocale] ?? "") : "";

  return (
    <div role="group" aria-labelledby={labelId} aria-describedby={description || !canRead ? descId : undefined} className="flex min-w-0 flex-col gap-1.5">
      <span id={labelId} className="text-base font-medium text-fg">
        {label}
      </span>
      <div className={cn("flex items-center gap-3 rounded-md border bg-surface p-2", error ? "border-danger" : "border-border")}>
        <div className="size-14 shrink-0 overflow-hidden rounded-md border border-border">
          {state.status === "ready" ? (
            <AssetImage asset={state.asset} alt={alt} className="size-full" />
          ) : state.status === "loading" ? (
            <Skeleton className="size-full rounded-none" />
          ) : (
            <span className="flex size-full items-center justify-center bg-surface-muted text-fg-subtle">
              <ImagePlus aria-hidden="true" className="size-5" />
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-sm text-fg">
            {state.status === "ready"
              ? (state.asset.originalFilename ?? t("media.untitled"))
              : state.status === "error"
                ? t("media.missingAsset")
                : state.status === "empty"
                  ? t("media.noImage")
                  : t("common.loading")}
          </span>
          {state.status === "ready" && state.asset.width && state.asset.height ? (
            <span className="text-xs text-fg-subtle tabular">
              {state.asset.width}×{state.asset.height}
            </span>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" onClick={() => setOpen(true)} disabled={disabled || !canRead}>
              {value ? t("media.replace") : t("media.choose")}
            </Button>
            {clearable && value ? (
              <Button size="sm" variant="ghost" onClick={() => onChange(null)} disabled={disabled}>
                <X aria-hidden="true" />
                {t("common.remove")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      {description || !canRead ? (
        <p id={descId} className="text-sm text-fg-muted">
          {!canRead ? t("media.noReadPermission") : description}
        </p>
      ) : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {open ? (
        <AssetPickerDialog
          open={open}
          onOpenChange={setOpen}
          selectedId={value}
          onSelect={(asset) => {
            rememberAsset(asset);
            onChange(asset.id);
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

type LibraryState = { status: "loading" } | { status: "error"; error: ApiErrorInfo } | { status: "ready"; items: Asset[]; hasMore: boolean; loadingMore: boolean };

/** Media library dialog: pick a ready image or upload new ones (uploads are selected when done). */
export function AssetPickerDialog({
  open,
  onOpenChange,
  selectedId,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedId: string | null;
  onSelect: (asset: Asset) => void;
}) {
  const { t, locale } = useI18n();
  const { apiBase, can, store } = useStore();
  const upload = useUploader();
  const [tab, setTab] = useState("library");
  const [state, setState] = useState<LibraryState>({ status: "loading" });
  const [selected, setSelected] = useState<string | null>(selectedId);
  const [query, setQuery] = useState("");
  const gridRef = useRef<HTMLUListElement>(null);
  const canUpload = can("media:write");

  const load = useCallback(
    async (before?: string) => {
      try {
        const res = await bff<{ items: Asset[] }>(`${apiBase}/assets`, { query: { kind: "image", limit: PAGE_SIZE, before } });
        for (const a of res.items) rememberAsset(a);
        setState((prev) => {
          const existing = before && prev.status === "ready" ? prev.items : [];
          const seen = new Set(existing.map((a) => a.id));
          return { status: "ready", items: [...existing, ...res.items.filter((a) => !seen.has(a.id))], hasMore: res.items.length === PAGE_SIZE, loadingMore: false };
        });
      } catch (err) {
        if (err instanceof ApiError) {
          const info = err.toInfo();
          setState((prev) => (before && prev.status === "ready" ? { ...prev, loadingMore: false } : { status: "error", error: info }));
        } else throw err;
      }
    },
    [apiBase],
  );

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const items = state.status === "ready" ? state.items : [];
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(locale);
    return q ? items.filter((a) => (a.originalFilename ?? "").toLocaleLowerCase(locale).includes(q)) : items;
  }, [items, query, locale]);
  const selectedAsset = items.find((a) => a.id === selected) ?? null;

  const onGridKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const buttons = Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>("button[data-asset]") ?? []);
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    const rect = (b: HTMLButtonElement) => b.getBoundingClientRect();
    const here = rect(buttons[current]!);
    let target: HTMLButtonElement | undefined;
    if (e.key === "ArrowRight") target = buttons[current + 1];
    else if (e.key === "ArrowLeft") target = buttons[current - 1];
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const down = e.key === "ArrowDown";
      const candidates = buttons.filter((b) => (down ? rect(b).top > here.top + 4 : rect(b).top < here.top - 4));
      const rowTop = down ? Math.min(...candidates.map((b) => rect(b).top)) : Math.max(...candidates.map((b) => rect(b).top));
      target = candidates.filter((b) => Math.abs(rect(b).top - rowTop) < 4).sort((a, b) => Math.abs(rect(a).left - here.left) - Math.abs(rect(b).left - here.left))[0];
    } else return;
    e.preventDefault();
    target?.focus();
  };

  const library =
    state.status === "loading" ? (
      <ul aria-label={t("media.loadingLibrary")} className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i}>
            <Skeleton className="aspect-square w-full" />
          </li>
        ))}
      </ul>
    ) : state.status === "error" ? (
      <ErrorState error={state.error} compact onRetry={() => void load()} />
    ) : items.length === 0 ? (
      <EmptyState
        icon={ImagePlus}
        title={t("media.emptyTitle")}
        description={canUpload ? t("media.emptyBody") : t("media.emptyBodyReadOnly")}
        actions={
          canUpload ? (
            <Button variant="primary" onClick={() => setTab("upload")}>
              {t("media.uploadTab")}
            </Button>
          ) : null
        }
      />
    ) : (
      <div className="flex flex-col gap-3">
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("media.searchPlaceholder")} aria-label={t("media.searchLabel")} />
        {visible.length === 0 ? (
          <p className="py-6 text-center text-base text-fg-muted">{t("media.noMatches")}</p>
        ) : (
          <ul ref={gridRef} onKeyDown={onGridKey} aria-label={t("media.libraryLabel")} className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {visible.map((a) => {
              const isSelected = a.id === selected;
              const alt = a.altText[locale] ?? a.altText[store.defaultLocale] ?? "";
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    data-asset=""
                    aria-pressed={isSelected}
                    onClick={() => setSelected(a.id)}
                    onDoubleClick={() => onSelect(a)}
                    className={cn(
                      "group flex w-full flex-col gap-1 rounded-lg border p-1.5 text-start transition-colors hover:bg-surface-muted",
                      isSelected ? "border-accent bg-accent-subtle ring-2 ring-accent" : "border-border",
                    )}
                  >
                    <AssetImage asset={a} alt={alt} className="aspect-square w-full rounded-md" />
                    <span className="truncate text-xs text-fg-muted">{a.originalFilename ?? t("media.untitled")}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {state.hasMore ? (
          <div className="flex justify-center">
            <Button
              size="sm"
              loading={state.loadingMore}
              onClick={() => {
                const last = items[items.length - 1];
                if (!last) return;
                setState({ ...state, loadingMore: true });
                void load(last.createdAt);
              }}
            >
              <RefreshCw aria-hidden="true" />
              {t("ui.table.loadMore")}
            </Button>
          </div>
        ) : null}
      </div>
    );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t("media.pickerTitle")}
      description={t("media.pickerDescription")}
      footer={
        <>
          <span className="me-auto truncate text-sm text-fg-muted" aria-live="polite">
            {selectedAsset ? t("media.selectedName", { name: selectedAsset.originalFilename ?? t("media.untitled") }) : ""}
          </span>
          <Button onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!selectedAsset} onClick={() => selectedAsset && onSelect(selectedAsset)}>
            {t("media.useSelected")}
          </Button>
        </>
      }
    >
      <Tabs
        aria-label={t("media.pickerTitle")}
        value={tab}
        onValueChange={setTab}
        items={[
          { value: "library", label: t("media.libraryTab"), content: library },
          {
            value: "upload",
            label: t("media.uploadTab"),
            content: canUpload ? (
              <div className="flex flex-col gap-3">
                <FileDropzone
                  accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                  acceptLabel="JPG, PNG, WebP, GIF, AVIF"
                  upload={async ({ file, sha256, onProgress, signal }) => {
                    const asset = await upload({ file, sha256, onProgress, signal });
                    rememberAsset(asset);
                    setState((prev) => (prev.status === "ready" ? { ...prev, items: [asset, ...prev.items.filter((a) => a.id !== asset.id)] } : { status: "ready", items: [asset], hasMore: false, loadingMore: false }));
                    if (asset.status === "ready") {
                      setSelected(asset.id);
                      setTab("library");
                    }
                  }}
                />
                <p className="text-sm text-fg-muted">{t("media.uploadHint")}</p>
              </div>
            ) : (
              <p className="py-6 text-center text-base text-fg-muted">{t("media.noUploadPermission")}</p>
            ),
          },
        ]}
      />
    </Dialog>
  );
}
