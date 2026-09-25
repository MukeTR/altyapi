"use client";

import { ExternalLink, FileText, Film, ImagePlus, RefreshCw, Trash2, Type, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DateTime } from "@/components/data/date-time";
import { KeyValue } from "@/components/data/key-value";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertDialog, Dialog } from "@/components/ui/dialog";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FileDropzone } from "@/components/ui/file-dropzone";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { LocalizedTextField, type LocalizedValue } from "@/components/ui/localized-text-field";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { MEDIA_KINDS, MEDIA_PAGE_SIZE, type Asset, type MediaKind } from "@/lib/media/types";
import { AssetImage, signedAssetUrl } from "./asset-image";
import { rememberAsset } from "./use-asset";
import { useUploader } from "./use-uploader";


const UPLOAD_ACCEPT = "image/jpeg,image/png,image/webp,image/avif,image/gif,video/mp4,video/webm,font/woff2,.woff2";

function fileSize(bytes: number, locale: Parameters<typeof formatNumber>[1]): string {
  if (bytes < 1024) return formatNumber(bytes, locale, { style: "unit", unit: "byte", unitDisplay: "short" });
  if (bytes < 1024 * 1024) return formatNumber(bytes / 1024, locale, { style: "unit", unit: "kilobyte", unitDisplay: "short", maximumFractionDigits: 0 });
  return formatNumber(bytes / (1024 * 1024), locale, { style: "unit", unit: "megabyte", unitDisplay: "short", maximumFractionDigits: 1 });
}

function KindIcon({ kind, className }: { kind: string; className?: string }) {
  const Icon = kind === "video" ? Film : kind === "font" ? Type : kind === "image" ? ImagePlus : FileText;
  return <Icon aria-hidden="true" className={className} />;
}

/** Preview tile: the image itself, otherwise an icon for the file kind. */
function AssetTile({ asset, alt, className, variant }: { asset: Asset; alt: string; className?: string; variant?: "thumbnail" | "card" }) {
  if (asset.kind === "image") return <AssetImage asset={asset} alt={alt} className={className} {...(variant ? { variant } : {})} />;
  return (
    <span className={cn("flex items-center justify-center bg-surface-muted text-fg-subtle", className)}>
      <KindIcon kind={asset.kind} className="size-8" />
    </span>
  );
}

/**
 * Storefront › Media: the store's media library. Lists ready files by type, uploads new ones,
 * edits image alt text per store language and deletes files. Deleted files disappear from the
 * storefront wherever they are used.
 */
export function MediaLibrary({ initial, kind }: { initial: Asset[]; kind: MediaKind }) {
  const { t, locale } = useI18n();
  const { apiBase, can, store } = useStore();
  const { toastError } = useToast();
  const upload = useUploader();
  const [items, setItems] = useState(initial);
  const [hasMore, setHasMore] = useState(initial.length === MEDIA_PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const canWrite = can("media:write");

  useEffect(() => {
    setItems(initial);
    setHasMore(initial.length === MEDIA_PAGE_SIZE);
    for (const a of initial) rememberAsset(a);
  }, [initial]);

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(locale);
    return q ? items.filter((a) => (a.originalFilename ?? "").toLocaleLowerCase(locale).includes(q)) : items;
  }, [items, query, locale]);
  const open = items.find((a) => a.id === openId) ?? null;
  const altOf = (a: Asset) => a.altText[locale] ?? a.altText[store.defaultLocale] ?? "";

  const loadMore = async () => {
    const last = items[items.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const res = await bff<{ items: Asset[] }>(`${apiBase}/assets`, { query: { kind: kind === "all" ? undefined : kind, limit: MEDIA_PAGE_SIZE, before: last.createdAt } });
      for (const a of res.items) rememberAsset(a);
      setItems((prev) => {
        const seen = new Set(prev.map((a) => a.id));
        return [...prev, ...res.items.filter((a) => !seen.has(a.id))];
      });
      setHasMore(res.items.length === MEDIA_PAGE_SIZE);
    } catch (err) {
      if (err instanceof ApiError) toastError(err.toInfo());
      else throw err;
    } finally {
      setLoadingMore(false);
    }
  };

  const uploadButton = canWrite ? (
    <Button variant="primary" onClick={() => setUploadOpen(true)}>
      <Upload aria-hidden="true" />
      {t("media.upload")}
    </Button>
  ) : null;

  const body = (
    <div className="flex flex-col gap-4">
      {items.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("media.searchPlaceholder")} aria-label={t("media.searchLabel")} className="max-w-sm" />
          <span className="text-sm text-fg-muted" aria-live="polite">
            {t("media.fileCount", { count: visible.length })}
          </span>
        </div>
      ) : null}
      {items.length === 0 ? (
        <EmptyState
          icon={ImagePlus}
          title={kind === "all" ? t("media.emptyLibraryTitle") : t("media.emptyKindTitle")}
          description={kind === "all" ? (canWrite ? t("media.emptyLibraryBody") : t("media.emptyBodyReadOnly")) : t("media.emptyKindBody")}
          actions={uploadButton}
        />
      ) : visible.length === 0 ? (
        <EmptyState icon={ImagePlus} title={t("states.emptyFilteredTitle")} description={t("media.noMatches")} actions={<Button onClick={() => setQuery("")}>{t("states.clearFilters")}</Button>} />
      ) : (
        <ul aria-label={t("media.libraryLabel")} className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {visible.map((a) => {
            const name = a.originalFilename ?? t("media.untitled");
            const missingAlt = a.kind === "image" && !(a.altText[store.defaultLocale] ?? "").trim();
            return (
              <li key={a.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => setOpenId(a.id)}
                  aria-label={t("media.openDetails", { name })}
                  className="group flex w-full flex-col gap-1.5 rounded-lg border border-border p-1.5 text-start transition-colors hover:bg-surface-muted"
                >
                  <AssetTile asset={a} alt={altOf(a)} className="aspect-square w-full rounded-md" />
                  <span className="truncate px-0.5 text-sm text-fg">{name}</span>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-0.5 text-xs text-fg-muted tabular">
                    {a.width && a.height ? (
                      <span>
                        {a.width}×{a.height}
                      </span>
                    ) : (
                      <span>{t.maybe(`media.kinds.${a.kind}`) ?? a.kind}</span>
                    )}
                    <span>{fileSize(a.byteSize, locale)}</span>
                    {missingAlt ? <Badge tone="warning">{t("media.missingAlt")}</Badge> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {hasMore && items.length > 0 ? (
        <div className="flex justify-center">
          <Button loading={loadingMore} onClick={() => void loadMore()}>
            <RefreshCw aria-hidden="true" />
            {t("ui.table.loadMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
      <PageHeader title={t("media.title")} meta={t("media.libraryDescription")} actions={uploadButton} />
      {!canWrite ? <InlineAlert tone="info">{t("media.readOnly")}</InlineAlert> : null}
      <Card flush>
        {/* The grid is the active tab's panel, so the tab's aria-controls points at it. */}
        <Tabs
          className="p-4 pt-3"
          aria-label={t("media.filterLabel")}
          searchParam="kind"
          value={kind}
          items={MEDIA_KINDS.map((k) => ({ value: k, label: t(`media.filters.${k}`), content: k === kind ? body : null }))}
        />
      </Card>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen} size="lg" title={t("media.upload")} description={t("media.uploadDialogDescription")} footer={<Button onClick={() => setUploadOpen(false)}>{t("common.close")}</Button>}>
        <div className="flex flex-col gap-3">
          <FileDropzone
            accept={UPLOAD_ACCEPT}
            acceptLabel="JPG, PNG, WebP, AVIF, GIF, MP4, WebM, WOFF2"
            upload={async ({ file, sha256, onProgress, signal }) => {
              const asset = await upload({ file, sha256, onProgress, signal });
              rememberAsset(asset);
              // The list only shows ready files; a file still processing appears after a reload.
              if (asset.status === "ready" && (kind === "all" || asset.kind === kind)) setItems((prev) => [asset, ...prev.filter((a) => a.id !== asset.id)]);
            }}
          />
          <p className="text-sm text-fg-muted">{t("media.uploadAccept")}</p>
        </div>
      </Dialog>

      {open ? (
        <AssetDetails
          key={open.id}
          asset={open}
          canWrite={canWrite}
          onClose={() => setOpenId(null)}
          onUpdated={(a) => {
            rememberAsset(a);
            setItems((prev) => prev.map((x) => (x.id === a.id ? a : x)));
          }}
          onDeleted={(id) => {
            setOpenId(null);
            setItems((prev) => prev.filter((x) => x.id !== id));
          }}
        />
      ) : null}
    </div>
  );
}

/** Side sheet with a larger preview, file facts, alt text per store language and delete. */
function AssetDetails({ asset, canWrite, onClose, onUpdated, onDeleted }: { asset: Asset; canWrite: boolean; onClose: () => void; onUpdated: (asset: Asset) => void; onDeleted: (id: string) => void }) {
  const { t, locale, describeError } = useI18n();
  const { apiBase, store } = useStore();
  const { toast, toastError } = useToast();
  const [alt, setAlt] = useState<LocalizedValue>(asset.altText);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiErrorInfo | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<ApiErrorInfo | null>(null);
  const [opening, setOpening] = useState(false);
  const name = asset.originalFilename ?? t("media.untitled");
  const isImage = asset.kind === "image";
  const locales = store.supportedLocales.length > 0 ? store.supportedLocales : [store.defaultLocale];
  const cleaned = Object.fromEntries(Object.entries(alt).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, v.trim()]));
  const dirty = JSON.stringify(cleaned) !== JSON.stringify(Object.fromEntries(Object.entries(asset.altText).filter(([, v]) => v.trim() !== "")));

  const saveAlt = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await bff<Asset>(`${apiBase}/assets/${asset.id}`, { method: "PATCH", body: { altText: cleaned } });
      onUpdated(updated);
      setAlt(updated.altText);
      toast({ tone: "success", title: t("media.altSaved") });
    } catch (err) {
      if (err instanceof ApiError) setSaveError(err.toInfo());
      else throw err;
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await bff(`${apiBase}/assets/${asset.id}`, { method: "DELETE" });
      toast({ tone: "success", title: t("media.deleted") });
      setConfirmDelete(false);
      onDeleted(asset.id);
    } catch (err) {
      if (err instanceof ApiError) setDeleteError(err.toInfo());
      else throw err;
    } finally {
      setDeleting(false);
    }
  };

  // Private files and development setups have no public address; open a short-lived signed link.
  const openOriginal = async () => {
    if (asset.url) {
      window.open(asset.url, "_blank", "noopener");
      return;
    }
    const tab = window.open("about:blank", "_blank");
    setOpening(true);
    try {
      const url = await signedAssetUrl(apiBase, asset.id);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else window.open(url, "_blank", "noopener");
    } catch (err) {
      tab?.close();
      if (err instanceof ApiError) toastError(err.toInfo(), t("media.originalFailed"));
      else throw err;
    } finally {
      setOpening(false);
    }
  };

  return (
    <>
      <Drawer
        open
        onOpenChange={(o) => !o && onClose()}
        title={t("media.details")}
        description={name}
        footer={
          <>
            {canWrite ? (
              <Button variant="ghost" className="me-auto text-danger hover:text-danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden="true" />
                {t("media.delete")}
              </Button>
            ) : (
              <span className="me-auto" />
            )}
            <Button onClick={onClose}>{t("common.close")}</Button>
            {canWrite && isImage ? (
              <Button variant="primary" loading={saving} disabled={!dirty} onClick={() => void saveAlt()}>
                {t("media.saveAlt")}
              </Button>
            ) : null}
          </>
        }
      >
        <div className="flex flex-col gap-5 p-5">
          <div className="overflow-hidden rounded-lg border border-border bg-surface-muted">
            {isImage ? (
              <AssetImage asset={asset} alt={asset.altText[locale] ?? asset.altText[store.defaultLocale] ?? ""} variant="card" className="max-h-80 w-full object-contain" />
            ) : (
              <AssetTile asset={asset} alt="" className="h-40 w-full" />
            )}
          </div>
          <KeyValue
            items={[
              { label: t("media.fileName"), value: name },
              { label: t("media.type"), value: `${t.maybe(`media.kinds.${asset.kind}`) ?? asset.kind} · ${asset.contentType}` },
              ...(asset.width && asset.height ? [{ label: t("media.dimensions"), value: `${asset.width}×${asset.height}` }] : []),
              { label: t("media.fileSize"), value: fileSize(asset.byteSize, locale) },
              { label: t("media.uploadedAt"), value: <DateTime value={asset.createdAt} /> },
              ...(asset.url ? [{ label: t("media.address"), value: <span className="break-all text-sm">{asset.url}</span>, copy: { value: asset.url, label: t("media.copyAddress") } }] : []),
            ]}
          />
          <div>
            <Button size="sm" loading={opening} onClick={() => void openOriginal()}>
              <ExternalLink aria-hidden="true" />
              {t("media.openOriginal")}
            </Button>
          </div>
          {isImage ? (
            <div className="flex flex-col gap-2">
              <LocalizedTextField
                label={t("media.altText")}
                description={`${t("media.altTextHint")} ${t("media.altTextDecorative")}`}
                locales={locales}
                defaultLocale={store.defaultLocale}
                value={alt}
                onChange={setAlt}
                maxLength={500}
                disabled={!canWrite || saving}
              />
              {saveError ? <InlineAlert tone="danger">{describeError(saveError).message}</InlineAlert> : null}
            </div>
          ) : null}
        </div>
      </Drawer>
      <AlertDialog
        open={confirmDelete}
        onOpenChange={(o) => {
          if (!o) {
            setConfirmDelete(false);
            setDeleteError(null);
          }
        }}
        title={t("media.deleteTitle")}
        description={t("media.deleteBody", { name })}
        confirmLabel={t("media.delete")}
        pending={deleting}
        onConfirm={() => void remove()}
      >
        {deleteError ? <InlineAlert tone="danger">{describeError(deleteError).message}</InlineAlert> : null}
      </AlertDialog>
    </>
  );
}
