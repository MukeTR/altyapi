"use client";

import { useRouter } from "next/navigation";
import { ExternalLink, MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { TagInput } from "@/components/commerce/tag-input";
import { DateTime } from "@/components/data/date-time";
import { AlertDialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { ConflictBanner } from "@/components/ui/conflict-banner";
import { DateTimeInput } from "@/components/ui/date-time-input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { ErrorSummary, type ErrorSummaryItem } from "@/components/ui/form-section";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedControl } from "@/components/ui/radio-group";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { mediaUrl, type MediaConfig } from "@/lib/commerce/media";
import type { ProductEditorData } from "@/lib/commerce/product-editor-data";
import type { Category, ProductDetail, ResolvedPrice } from "@/lib/commerce/types";
import { formatBps } from "@/lib/format";
import { localeDir, localeHtmlLang, localeLabel } from "@/lib/locales";
import { MediaEditor } from "./product-media";
import { PriceListsCard } from "./product-prices";
import { OptionsEditor, VariantFields, VariantsTable, type FieldErrors } from "./product-variants";
import { draftFromDetail, draftToInput, emptyTranslation, labelIn, newProductDraft, regenerateVariants, validateDraft, type ProductDraft } from "./product-draft";

export interface ProductFormProps {
  /** null for a new product. */
  product: ProductDetail | null;
  data: ProductEditorData;
  /** Resolved prices per currency (existing products, pricing:read). */
  resolvedPrices: Record<string, ResolvedPrice[]> | null;
  media: MediaConfig;
}

function categoryOptions(categories: Category[], locale: string): { value: string; label: string }[] {
  const byParent = new Map<string | null, Category[]>();
  for (const c of categories) byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c]);
  const out: { value: string; label: string }[] = [];
  const walk = (parent: string | null, prefix: string, depth: number) => {
    if (depth > 6) return;
    for (const c of (byParent.get(parent) ?? []).sort((a, b) => a.position - b.position)) {
      const name = labelIn(c.name, locale) || c.handle;
      const label = prefix ? `${prefix} › ${name}` : name;
      out.push({ value: c.id, label });
      walk(c.id, label, depth + 1);
    }
  };
  walk(null, "", 0);
  return out;
}

export function ProductForm({ product, data, resolvedPrices, media }: ProductFormProps) {
  const { t, locale: ui, describeError } = useI18n();
  const { store, basePath, apiBase, can, storefrontUrl } = useStore();
  const router = useRouter();
  const { toast } = useToast();
  const defaultLocale = store.defaultLocale;
  const isNew = product === null;
  const canWrite = can("catalog:write");
  const disabled = !canWrite;

  const manualIds = useMemo(() => new Set(data.collections.filter((c) => c.type === "manual").map((c) => c.id)), [data.collections]);
  const initial = useMemo(
    () => (product ? draftFromDetail(product, store.supportedLocales, manualIds, (key) => mediaUrl(media, key, "card")) : newProductDraft(store.supportedLocales)),
    [product, store.supportedLocales, manualIds, media],
  );
  const [draft, setDraft] = useState<ProductDraft>(initial);
  const [locale, setLocale] = useState(defaultLocale);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [apiError, setApiError] = useState<ApiErrorInfo | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [scheduled, setScheduled] = useState(Boolean(initial.publishAt));
  // Bumped on "discard" so the uncontrolled rich text editor reloads the saved text.
  const [resetNonce, setResetNonce] = useState(0);

  const initialJson = useMemo(() => JSON.stringify(initial), [initial]);
  // After a successful save the page re-renders with the saved product (new key); until then
  // the form must not claim unsaved changes.
  const [savedAwaitingRefresh, setSavedAwaitingRefresh] = useState(false);
  const dirty = useMemo(() => !savedAwaitingRefresh && JSON.stringify(draft) !== initialJson, [draft, initialJson, savedAwaitingRefresh]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const patch = useCallback((changes: Partial<ProductDraft>) => setDraft((d) => ({ ...d, ...changes })), []);
  const translation = draft.translations[locale] ?? emptyTranslation();
  const setTranslation = (changes: Partial<typeof translation>) =>
    setDraft((d) => ({ ...d, translations: { ...d.translations, [locale]: { ...(d.translations[locale] ?? emptyTranslation()), ...changes } } }));

  const titleDefault = draft.translations[defaultLocale]?.title.trim();
  const currency = store.defaultCurrency;
  const hasOptions = draft.options.some((o) => o.values.length > 0);
  const langProps = { lang: localeHtmlLang(locale), dir: localeDir(locale) } as const;
  const localeName = (code: string) => localeLabel(code, ui);

  const clientMessage = (code: string) =>
    code === "required" ? t("ui.field.requiredValue") : code === "compareAt" ? t("products.errors.compareAt") : code === "optionName" ? t("products.errors.optionName") : t("products.errors.optionValue");

  const save = async (expectedUpdatedAt?: string) => {
    setApiError(null);
    setConflict(null);
    const local = validateDraft(draft, defaultLocale);
    if (Object.keys(local).length > 0) {
      setErrors(Object.fromEntries(Object.entries(local).map(([k, v]) => [k, clientMessage(v)])));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const body = draftToInput(draft, { defaultLocale, isNew, ...(product ? { expectedUpdatedAt: expectedUpdatedAt ?? product.updatedAt } : {}) });
      const saved = await bff<ProductDetail>(isNew ? `${apiBase}/products` : `${apiBase}/products/${product.id}`, { method: isNew ? "POST" : "PUT", body });
      setSavedAwaitingRefresh(true);
      toast({ tone: "success", title: isNew ? t("products.saved.created") : t("products.saved.updated") });
      if (isNew) router.replace(`${basePath}/products/${saved.id}`);
      else router.refresh();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      const info = err.toInfo();
      if (info.status === 409 && info.messageKey === "errors.content.revision_conflict") {
        const current = (info.details as { updatedAt?: string } | undefined)?.updatedAt;
        setConflict(current ?? "");
      } else {
        const d = describeError(info);
        setErrors(d.fields);
        setApiError(info);
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!product) return;
    setDeleting(true);
    try {
      const res = await bff<{ outcome: "deleted" | "archived" }>(`${apiBase}/products/${product.id}`, { method: "DELETE" });
      setDeleteOpen(false);
      if (res.outcome === "deleted") {
        toast({ tone: "success", title: t("products.delete.deleted") });
        router.push(`${basePath}/products`);
      } else {
        toast({ tone: "info", title: t("products.delete.archived") });
        router.refresh();
      }
    } catch (err) {
      if (err instanceof ApiError) setApiError(err.toInfo());
      else throw err;
      setDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  const summaryItems: ErrorSummaryItem[] = Object.entries(errors).map(([path, message]) => ({ fieldId: fieldIdFor(path), message, label: fieldLabel(path) }));
  function fieldIdFor(path: string): string {
    const m = /^translations\.([a-z]{2})\.(\w+)/.exec(path);
    if (m) return `product-${m[2]}`;
    const v = /^variants\.(\d+)/.exec(path);
    if (v) return "product-variants";
    if (path.startsWith("options")) return "product-options";
    return "product-form-top";
  }
  function fieldLabel(path: string): string {
    const m = /^translations\.([a-z]{2})\.(\w+)/.exec(path);
    if (m) return `${localeName(m[1] ?? "")} · ${t.maybe(`products.fields.${m[2]}`) ?? m[2]}`;
    const v = /^variants\.(\d+)\.?(\w+)?/.exec(path);
    if (v) return `${t("products.variants.variantN", { n: Number(v[1]) + 1 })}${v[2] ? ` · ${t.maybe(`products.fields.${v[2]}`) ?? v[2]}` : ""}`;
    const o = /^options\.(\d+)/.exec(path);
    if (o) return t("products.options.optionN", { n: Number(o[1]) + 1 });
    return t.maybe(`products.fields.${path}`) ?? path;
  }

  const publicUrl = product && product.status === "active" && product.publishedAt ? `${storefrontUrl}/products/${product.translations[defaultLocale]?.handle ?? ""}` : null;
  const categoryOpts = useMemo(() => categoryOptions(data.categories, defaultLocale), [data.categories, defaultLocale]);
  const collectionOpts = data.collections.filter((c) => c.type === "manual").map((c) => ({ value: c.id, label: c.title || c.handle }));
  const productTax = data.taxClasses?.find((c) => c.id === draft.taxClassId) ?? data.taxClasses?.find((c) => c.isDefault) ?? null;
  const handlePath = `${locale === defaultLocale ? "" : `/${locale}`}/products/`;

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6" id="product-form-top" tabIndex={-1}>
      <PageHeader
        breadcrumbs={[{ label: t("products.title"), href: `${basePath}/products` }]}
        title={titleDefault || (isNew ? t("products.new.title") : t("products.untitled"))}
        status={product ? <StatusPill domain="product" value={product.status} /> : null}
        meta={
          product ? (
            <span>
              {t("products.meta.updated")} <DateTime value={product.updatedAt} format="relative" />
              {product.publishAt ? (
                <>
                  {" · "}
                  {t("products.meta.scheduled")} <DateTime value={product.publishAt} />
                </>
              ) : null}
            </span>
          ) : null
        }
        actions={
          <>
            {publicUrl ? (
              <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm">
                <ExternalLink aria-hidden="true" className="size-4" />
                {t("products.actions.viewInStore")}
                <span className="sr-only"> ({t("common.openInNewTab")})</span>
              </a>
            ) : null}
            {product && canWrite ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-md" aria-label={t("common.rowActions", { name: titleDefault || t("products.untitled") })}>
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem tone="danger" onSelect={() => setDeleteOpen(true)}>
                    {product.publishedAt ? t("products.delete.archiveAction") : t("products.delete.action")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {canWrite ? (
              <Button variant="primary" loading={saving} disabled={!dirty && !isNew} onClick={() => save()}>
                {isNew ? t("products.actions.create") : t("common.save")}
              </Button>
            ) : null}
          </>
        }
      />

      {!canWrite ? <InlineAlert tone="info">{t("commerce.noPermission", { permission: "catalog:write" })}</InlineAlert> : null}
      {data.error ? <InlineAlert tone="warning">{describeError(data.error).message}</InlineAlert> : null}
      {conflict !== null ? (
        <ConflictBanner
          onReload={() => {
            setConflict(null);
            setDraft(initial);
            setResetNonce((n) => n + 1);
            router.refresh();
          }}
          {...(conflict ? { onOverwrite: () => save(conflict) } : {})}
          pending={saving}
        />
      ) : null}
      {apiError || summaryItems.length > 0 ? (
        <ErrorSummary {...(apiError ? { message: describeError(apiError).message } : {})} items={summaryItems} />
      ) : null}

      {store.supportedLocales.length > 1 ? (
        <div className="flex flex-wrap items-center gap-3">
          <span id="content-locale-label" className="text-sm font-medium text-fg-muted">
            {t("products.contentLocale")}
          </span>
          <SegmentedControl
            aria-label={t("products.contentLocale")}
            value={locale}
            onValueChange={setLocale}
            options={[defaultLocale, ...store.supportedLocales.filter((l) => l !== defaultLocale)].map((l) => ({
              value: l,
              label: l === defaultLocale ? `${localeName(l)} · ${t("common.default")}` : localeName(l),
            }))}
          />
          {locale !== defaultLocale ? <span className="text-xs text-fg-subtle">{t("products.localeHint", { locale: localeName(defaultLocale) })}</span> : null}
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={t("products.sections.content")} padding="form">
            <div className="flex flex-col gap-4">
              <Field label={t("products.fields.title")} required={locale === defaultLocale} error={errors[`translations.${locale}.title`] ?? null} id="product-title">
                <Input
                  {...langProps}
                  value={translation.title}
                  onChange={(e) => setTranslation({ title: e.target.value })}
                  maxLength={250}
                  showCount
                  disabled={disabled}
                  placeholder={locale === defaultLocale ? t("products.fields.titlePlaceholder") : (draft.translations[defaultLocale]?.title ?? "")}
                />
              </Field>
              <div className="flex flex-col gap-1.5">
                <span id="product-description-label" className="text-base font-medium text-fg">
                  {t("products.fields.descriptionHtml")}
                </span>
                <RichTextEditor
                  key={`desc-${locale}-${resetNonce}`}
                  id="product-descriptionHtml"
                  aria-labelledby="product-description-label"
                  initialContent={translation.descriptionHtml}
                  resetKey={locale}
                  onChange={(c) => setTranslation({ descriptionHtml: c.isEmpty ? "" : c.html })}
                  disabled={disabled}
                  lang={langProps.lang}
                  dir={langProps.dir}
                  invalid={Boolean(errors[`translations.${locale}.descriptionHtml`])}
                />
              </div>
            </div>
          </Card>

          <Card title={t("products.sections.media")} description={t("products.media.description")} padding="form">
            <MediaEditor draft={draft} locale={locale} disabled={disabled} onChange={(m) => patch({ media: m })} />
          </Card>

          <Card title={t("products.sections.variants")} description={t("products.options.description")} padding="form">
            <div className="flex flex-col gap-4" id="product-options" tabIndex={-1}>
              <OptionsEditor
                options={draft.options}
                locale={locale}
                defaultLocale={defaultLocale}
                disabled={disabled}
                errors={errors}
                onChange={(options) => setDraft((d) => ({ ...d, options, variants: regenerateVariants(options, d.variants) }))}
              />
              <div id="product-variants" tabIndex={-1} className="outline-none">
                {hasOptions ? (
                  <VariantsTable
                    draft={draft}
                    currency={currency}
                    taxClasses={data.taxClasses}
                    locations={data.locations}
                    isNewProduct={isNew}
                    disabled={disabled}
                    errors={errors}
                    onChange={(i, v) => setDraft((d) => ({ ...d, variants: d.variants.map((x, j) => (j === i ? v : x)) }))}
                  />
                ) : draft.variants[0] ? (
                  <VariantFields
                    variant={draft.variants[0]}
                    index={0}
                    currency={currency}
                    productTaxClassId={draft.taxClassId}
                    taxClasses={data.taxClasses}
                    locations={data.locations}
                    isNewProduct={isNew}
                    disabled={disabled}
                    errors={errors}
                    onChange={(v) => setDraft((d) => ({ ...d, variants: [v, ...d.variants.slice(1)] }))}
                  />
                ) : null}
              </div>
            </div>
          </Card>

          <Card title={t("products.sections.shipping")} description={t("products.shipping.description")} padding="form">
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label={t("products.shipping.weight")} optional>
                <Input type="number" inputMode="numeric" min={0} value={draft.weightGrams} onChange={(e) => patch({ weightGrams: e.target.value })} disabled={disabled} suffix="g" className="tabular" />
              </Field>
              {(["length", "width", "height"] as const).map((dim) => (
                <Field key={dim} label={t(`products.shipping.${dim}`)} optional>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={draft.dimensions[dim]}
                    onChange={(e) => patch({ dimensions: { ...draft.dimensions, [dim]: e.target.value } })}
                    disabled={disabled}
                    suffix="mm"
                    className="tabular"
                  />
                </Field>
              ))}
            </div>
          </Card>

          <Card title={t("products.sections.seo")} description={t("products.seo.description")} padding="form">
            <div className="flex flex-col gap-4">
              <Field label={t("products.fields.handle")} optional description={t("products.seo.handleHint")} error={errors[`translations.${locale}.handle`] ?? null} id="product-handle">
                <Input {...langProps} value={translation.handle} onChange={(e) => setTranslation({ handle: e.target.value.toLowerCase() })} maxLength={200} disabled={disabled} prefix={<span className="font-mono text-xs">{handlePath}</span>} />
              </Field>
              <Field label={t("products.fields.seoTitle")} optional error={errors[`translations.${locale}.seoTitle`] ?? null} id="product-seoTitle">
                <Input {...langProps} value={translation.seoTitle} onChange={(e) => setTranslation({ seoTitle: e.target.value })} maxLength={70} showCount disabled={disabled} placeholder={translation.title} />
              </Field>
              <Field label={t("products.fields.seoDescription")} optional error={errors[`translations.${locale}.seoDescription`] ?? null} id="product-seoDescription">
                <Textarea {...langProps} value={translation.seoDescription} onChange={(e) => setTranslation({ seoDescription: e.target.value })} maxLength={320} showCount rows={3} disabled={disabled} />
              </Field>
              <SearchPreview
                title={translation.seoTitle || translation.title || draft.translations[defaultLocale]?.title || ""}
                description={translation.seoDescription}
                url={`${new URL(storefrontUrl).host}${handlePath}${translation.handle || "…"}`}
                lang={langProps.lang}
                dir={langProps.dir}
              />
            </div>
          </Card>

          {product && data.priceLists && resolvedPrices ? <PriceListsCard product={product} draft={initial} priceLists={data.priceLists} resolved={resolvedPrices} /> : null}
        </div>

        <aside aria-label={t("products.aside")} className="flex min-w-0 flex-col gap-4">
          <Card title={t("products.sections.status")}>
            <div className="flex flex-col gap-3">
              <Field label={t("products.fields.status")} hideLabel>
                <Select
                  value={draft.status}
                  disabled={disabled}
                  onValueChange={(v) => patch({ status: v as ProductDraft["status"] })}
                  options={(["draft", "active", "archived"] as const).map((s) => ({ value: s, label: t(`statuses.product.${s}`) }))}
                />
              </Field>
              <p className="text-sm text-fg-muted">{t(`products.statusHint.${draft.status}`)}</p>
              {draft.status === "active" ? (
                <>
                  <Switch
                    checked={scheduled}
                    disabled={disabled}
                    onCheckedChange={(v) => {
                      setScheduled(v);
                      if (!v) patch({ publishAt: null });
                    }}
                    label={t("products.schedule.toggle")}
                  />
                  {scheduled ? (
                    <Field label={t("products.schedule.at")} description={t("products.schedule.hint")}>
                      <DateTimeInput value={draft.publishAt} onChange={(v) => patch({ publishAt: v })} disabled={disabled} />
                    </Field>
                  ) : null}
                </>
              ) : null}
              {product?.publishedAt ? (
                <p className="text-xs text-fg-subtle">
                  {t("products.meta.firstPublished")} <DateTime value={product.publishedAt} format="date" />
                </p>
              ) : null}
            </div>
          </Card>

          <Card title={t("products.sections.organization")}>
            <div className="flex flex-col gap-3">
              <Field label={t("products.fields.category")} optional>
                {categoryOpts.length > 0 ? (
                  <Combobox options={categoryOpts} value={draft.categoryId} onChange={(v) => patch({ categoryId: v })} disabled={disabled} placeholder={t("products.organization.noCategory")} />
                ) : (
                  <p className="text-sm text-fg-muted">{t("products.organization.noCategories")}</p>
                )}
              </Field>
              <Field label={t("products.fields.vendorName")} optional>
                <Input value={draft.vendorName} onChange={(e) => patch({ vendorName: e.target.value })} maxLength={120} disabled={disabled} />
              </Field>
              <Field label={t("products.fields.productType")} optional>
                <Input value={draft.productType} onChange={(e) => patch({ productType: e.target.value })} maxLength={120} disabled={disabled} />
              </Field>
              <Field label={t("products.fields.collectionIds")} optional description={collectionOpts.length === 0 ? t("products.organization.noManualCollections") : t("products.organization.collectionsHint")}>
                {collectionOpts.length > 0 ? <Combobox multiple options={collectionOpts} value={draft.collectionIds} onChange={(v) => patch({ collectionIds: v })} disabled={disabled} /> : <span />}
              </Field>
              <Field label={t("products.fields.tags")} optional>
                <TagInput value={draft.tags} onChange={(tags) => patch({ tags })} disabled={disabled} />
              </Field>
            </div>
          </Card>

          <Card title={t("products.sections.tax")}>
            {data.taxClasses ? (
              <div className="flex flex-col gap-2">
                <Field label={t("products.fields.taxClassId")} hideLabel>
                  <Select
                    value={draft.taxClassId ?? "default"}
                    disabled={disabled}
                    onValueChange={(v) => patch({ taxClassId: v === "default" ? null : v })}
                    options={[
                      { value: "default", label: t("products.tax.storeDefault") },
                      ...data.taxClasses.map((c) => ({ value: c.id, label: `${c.name} · ${formatBps(c.rateBps, ui)}` })),
                    ]}
                  />
                </Field>
                {productTax ? (
                  <p className="text-sm text-fg-muted">
                    {productTax.pricesIncludeTax ? t("products.tax.included", { rate: formatBps(productTax.rateBps, ui) }) : t("products.tax.excluded", { rate: formatBps(productTax.rateBps, ui) })}
                  </p>
                ) : null}
                <p className="text-xs text-fg-subtle">{t("products.tax.costNote")}</p>
              </div>
            ) : (
              <p className="text-sm text-fg-muted">{t("products.tax.noPermission")}</p>
            )}
          </Card>
        </aside>
      </div>

      {canWrite && dirty ? (
        <div role="region" aria-label={t("commerce.unsaved")} className="sticky bottom-3 z-30 rounded-lg border border-border bg-surface shadow-md">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="text-base font-medium text-fg">{t("commerce.unsaved")}</span>
            <div className="flex gap-2">
              <Button
                disabled={saving}
                onClick={() => {
                  setDraft(initial);
                  setErrors({});
                  setApiError(null);
                  setResetNonce((n) => n + 1);
                }}
              >
                {t("products.actions.discard")}
              </Button>
              <Button variant="primary" loading={saving} onClick={() => save()}>
                {isNew ? t("products.actions.create") : t("common.save")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {product ? (
        <AlertDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={product.publishedAt ? t("products.delete.archiveTitle") : t("products.delete.title")}
          description={product.publishedAt ? t("products.delete.archiveBody") : t("products.delete.body")}
          confirmLabel={product.publishedAt ? t("products.delete.archiveAction") : t("products.delete.action")}
          pending={deleting}
          onConfirm={remove}
        />
      ) : null}
    </div>
  );
}

/** How the product may look in search results (title ~60 chars, description ~160 chars shown). */
function SearchPreview({ title, description, url, lang, dir }: { title: string; description: string; url: string; lang: string; dir: "ltr" | "rtl" }) {
  const { t } = useI18n();
  return (
    <figure className="flex flex-col gap-1 rounded-lg border border-border bg-surface-muted p-3" lang={lang} dir={dir}>
      <figcaption className="text-xs font-medium text-fg-subtle">{t("products.seo.preview")}</figcaption>
      <span className="truncate text-sm text-fg-muted">{url}</span>
      <span className="truncate text-md text-link">{title || t("products.untitled")}</span>
      <span className="line-clamp-2 text-sm text-fg-muted">{description || t("products.seo.noDescription")}</span>
    </figure>
  );
}
