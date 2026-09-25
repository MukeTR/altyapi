"use client";

import { ArrowLeft, ArrowRight, ImagePlus, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { AssetPickerDialog } from "@/components/media/asset-picker";
import { rememberAsset } from "@/components/media/use-asset";
import { useUploader } from "@/components/media/use-uploader";
import { Thumb } from "@/components/commerce/thumb";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { FileDropzone, type UploadTask } from "@/components/ui/file-dropzone";
import { controlClasses } from "@/components/ui/input-styles";
import type { Asset } from "@/lib/media/types";
import { localeDir, localeHtmlLang } from "@/lib/locales";
import { labelIn, newKey, variantTitle, type MediaDraft, type ProductDraft } from "./product-draft";

const IMAGE_TYPES = "image/jpeg,image/png,image/webp,image/avif,image/gif";

/**
 * Product images: upload (straight to storage, then processed by the worker) or pick from the
 * media library; reorder with buttons (the first image is the main one), alt text per content
 * language, and optional variant assignment.
 */
export function MediaEditor({ draft, locale, disabled, onChange }: { draft: ProductDraft; locale: string; disabled: boolean; onChange: (media: MediaDraft[]) => void }) {
  const { t } = useI18n();
  const { can, store } = useStore();
  const upload = useUploader();
  const [pickerOpen, setPickerOpen] = useState(false);
  const media = draft.media;
  const canUpload = can("media:write");
  const canBrowse = can("media:read");
  const hasOptions = draft.options.some((o) => o.values.length > 0);

  const add = useCallback(
    (asset: Asset) => {
      rememberAsset(asset);
      onChange([...media, { key: newKey("m"), assetId: asset.id, preview: asset.url, alt: { ...asset.altText }, variantKeys: [] }]);
    },
    [media, onChange],
  );

  const onUpload = useCallback(
    async ({ file, sha256, onProgress, signal }: UploadTask) => {
      const asset = await upload({ file, sha256, purpose: "media", onProgress, signal });
      if (asset.status !== "ready") throw new Error(t("products.media.stillProcessing"));
      add(asset);
    },
    [upload, add, t],
  );

  const move = (index: number, delta: number) => {
    const next = [...media];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(index + delta, 0, item);
    onChange(next);
  };

  const update = (key: string, fn: (m: MediaDraft) => MediaDraft) => onChange(media.map((m) => (m.key === key ? fn(m) : m)));
  const variantOptions = draft.variants.map((v) => ({ value: v.key, label: variantTitle(draft, v, store.defaultLocale) }));

  return (
    <div className="flex flex-col gap-3">
      {media.length > 0 ? (
        <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {media.map((m, i) => (
            <li key={m.key} className="flex flex-col gap-2 rounded-lg border border-border p-2">
              <div className="flex items-start gap-3">
                <Thumb src={m.preview} size={96} alt={labelIn(m.alt, locale)} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-sm font-medium text-fg">{i === 0 ? t("products.media.main") : t("products.media.position", { n: i + 1 })}</span>
                  <div className="flex gap-1">
                    <Button size="icon-sm" variant="ghost" disabled={disabled || i === 0} aria-label={t("products.media.moveEarlier", { n: i + 1 })} onClick={() => move(i, -1)}>
                      <ArrowLeft aria-hidden="true" className="rtl:rotate-180" />
                    </Button>
                    <Button size="icon-sm" variant="ghost" disabled={disabled || i === media.length - 1} aria-label={t("products.media.moveLater", { n: i + 1 })} onClick={() => move(i, 1)}>
                      <ArrowRight aria-hidden="true" className="rtl:rotate-180" />
                    </Button>
                    <Button size="icon-sm" variant="ghost" disabled={disabled} aria-label={t("products.media.remove", { n: i + 1 })} onClick={() => onChange(media.filter((x) => x.key !== m.key))}>
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              </div>
              <label className="flex flex-col gap-1 text-sm text-fg-muted">
                {t("products.media.alt")}
                <input
                  lang={localeHtmlLang(locale)}
                  dir={localeDir(locale)}
                  value={m.alt[locale] ?? ""}
                  maxLength={250}
                  disabled={disabled}
                  placeholder={locale === store.defaultLocale ? t("products.media.altPlaceholder") : labelIn(m.alt, store.defaultLocale)}
                  onChange={(e) => update(m.key, (x) => ({ ...x, alt: { ...x.alt, [locale]: e.target.value } }))}
                  className={controlClasses({ size: "sm" })}
                />
              </label>
              {hasOptions ? (
                <div className="flex flex-col gap-1 text-sm text-fg-muted">
                  <span aria-hidden="true">{t("products.media.variants")}</span>
                  <Combobox
                    multiple
                    size="sm"
                    aria-label={t("products.media.variantsFor", { n: i + 1 })}
                    placeholder={t("products.media.allVariants")}
                    options={variantOptions}
                    value={m.variantKeys}
                    disabled={disabled}
                    onChange={(keys) => update(m.key, (x) => ({ ...x, variantKeys: keys }))}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {!disabled && canUpload ? <FileDropzone upload={onUpload} accept={IMAGE_TYPES} acceptLabel="JPG, PNG, WebP, AVIF, GIF · 20 MB" /> : null}
      {!disabled && canBrowse ? (
        <Button className="self-start" onClick={() => setPickerOpen(true)}>
          <ImagePlus aria-hidden="true" />
          {t("products.media.fromLibrary")}
        </Button>
      ) : null}
      {!canUpload && !canBrowse ? <p className="text-sm text-fg-muted">{t("products.media.noPermission")}</p> : null}
      {pickerOpen ? <AssetPickerDialog open onOpenChange={setPickerOpen} selectedId={null} onSelect={(asset) => { add(asset); setPickerOpen(false); }} /> : null}
    </div>
  );
}
