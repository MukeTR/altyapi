"use client";

import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, MoreHorizontal, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { AssetField } from "@/components/media/asset-picker";
import { Thumb } from "@/components/commerce/thumb";
import { useProductSearch } from "@/components/commerce/use-product-search";
import { DateTime } from "@/components/data/date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { AlertDialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { ErrorSummary } from "@/components/ui/form-section";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { controlClasses } from "@/components/ui/input-styles";
import { MoneyInput } from "@/components/ui/money-input";
import { PageHeader } from "@/components/ui/page-header";
import { RadioGroup, SegmentedControl } from "@/components/ui/radio-group";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { mediaUrl, type MediaConfig } from "@/lib/commerce/media";
import { COLLECTION_SORT_ORDERS, type Category, type CollectionDetail, type CollectionRule, type CollectionSortOrder, type ProductListItem, type RuleField, type RuleOperator } from "@/lib/commerce/types";
import { utcToZonedInput, zonedToUtc } from "@/lib/format";
import { localeDir, localeHtmlLang, localeLabel } from "@/lib/locales";

const NUMERIC_FIELDS: RuleField[] = ["price", "compare_at_price", "inventory"];
const FIELD_ORDER: RuleField[] = ["tag", "title", "vendor", "product_type", "category", "price", "compare_at_price", "inventory", "attribute", "created_at"];

function operatorsFor(field: RuleField): RuleOperator[] {
  if (NUMERIC_FIELDS.includes(field)) return ["equals", "not_equals", "greater_than", "less_than"];
  if (field === "created_at") return ["greater_than", "less_than"];
  if (field === "category") return ["equals"];
  return ["equals", "not_equals", "contains", "not_contains", "starts_with", "in"];
}

interface RuleDraft extends CollectionRule {
  key: string;
}

interface TranslationDraft {
  title: string;
  handle: string;
  descriptionHtml: string;
  seoTitle: string;
  seoDescription: string;
}

const emptyTr = (): TranslationDraft => ({ title: "", handle: "", descriptionHtml: "", seoTitle: "", seoDescription: "" });
let ruleSeq = 0;
const ruleKey = () => `r${++ruleSeq}`;

export interface CollectionFormProps {
  collection: CollectionDetail | null;
  /** Current members of a manual collection (most recently updated first; the API does not return the saved order). */
  members: ProductListItem[];
  membersTruncated: boolean;
  categories: Category[];
  media: MediaConfig;
}

export function CollectionForm({ collection, members, membersTruncated, categories, media }: CollectionFormProps) {
  const { t, locale: ui, describeError } = useI18n();
  const { store, apiBase, basePath, can } = useStore();
  const router = useRouter();
  const { toast } = useToast();
  const defaultLocale = store.defaultLocale;
  const isNew = collection === null;
  const canWrite = can("catalog:write");
  const disabled = !canWrite;

  const initial = useMemo(() => {
    const translations: Record<string, TranslationDraft> = {};
    for (const l of store.supportedLocales) {
      const tr = collection?.translations[l];
      translations[l] = tr ? { title: tr.title, handle: tr.handle, descriptionHtml: tr.descriptionHtml ?? "", seoTitle: tr.seoTitle ?? "", seoDescription: tr.seoDescription ?? "" } : emptyTr();
    }
    return {
      type: collection?.type ?? ("manual" as const),
      sortOrder: collection?.sortOrder ?? ("manual" as CollectionSortOrder),
      matchAll: collection?.matchAll ?? true,
      imageAssetId: collection?.imageAssetId ?? null,
      isPublished: collection?.isPublished ?? true,
      translations,
      rules: (collection?.rules ?? []).map((r) => ({ ...r, key: ruleKey() })) as RuleDraft[],
      productIds: members.map((m) => m.id),
    };
  }, [collection, members, store.supportedLocales]);

  const [draft, setDraft] = useState(initial);
  const [known, setKnown] = useState<Map<string, ProductListItem>>(() => new Map(members.map((m) => [m.id, m])));
  const [locale, setLocale] = useState(defaultLocale);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<ApiErrorInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resetNonce, setResetNonce] = useState(0);
  const search = useProductSearch();

  const initialJson = useMemo(() => JSON.stringify(initial), [initial]);
  // Hidden between a successful save and the re-render with the saved collection.
  const [savedAwaitingRefresh, setSavedAwaitingRefresh] = useState(false);
  const dirty = !savedAwaitingRefresh && JSON.stringify(draft) !== initialJson;
  const membershipDirty = JSON.stringify(draft.productIds) !== JSON.stringify(initial.productIds);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const tr = draft.translations[locale] ?? emptyTr();
  const setTr = (changes: Partial<TranslationDraft>) => setDraft((d) => ({ ...d, translations: { ...d.translations, [locale]: { ...(d.translations[locale] ?? emptyTr()), ...changes } } }));
  const langProps = { lang: localeHtmlLang(locale), dir: localeDir(locale) } as const;
  const title = draft.translations[defaultLocale]?.title.trim();

  const categoryOptions = categories.map((c) => ({ value: c.id, label: c.name[defaultLocale] ?? Object.values(c.name)[0] ?? c.handle, description: c.handle }));

  const setRule = (key: string, changes: Partial<RuleDraft>) => setDraft((d) => ({ ...d, rules: d.rules.map((r) => (r.key === key ? { ...r, ...changes } : r)) }));

  const save = async () => {
    setApiError(null);
    const local: Record<string, string> = {};
    if (!draft.translations[defaultLocale]?.title.trim()) local[`translations.${defaultLocale}.title`] = t("ui.field.requiredValue");
    if (draft.type === "automated") {
      if (draft.rules.length === 0) local.rules = t("collections.rules.required");
      draft.rules.forEach((r, i) => {
        if (!r.value.trim()) local[`rules.${i}.value`] = t("ui.field.requiredValue");
        if (r.field === "attribute" && !r.attributeKey?.trim()) local[`rules.${i}.attributeKey`] = t("ui.field.requiredValue");
      });
    }
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const translations: Record<string, unknown> = {};
      for (const [l, x] of Object.entries(draft.translations)) {
        if (!x.title.trim() && l !== defaultLocale) continue;
        translations[l] = {
          title: x.title.trim(),
          ...(x.handle.trim() ? { handle: x.handle.trim() } : {}),
          descriptionHtml: x.descriptionHtml,
          seoTitle: x.seoTitle.trim() || null,
          seoDescription: x.seoDescription.trim() || null,
        };
      }
      const body = {
        type: draft.type,
        translations,
        sortOrder: draft.sortOrder,
        matchAll: draft.matchAll,
        rules: draft.type === "automated" ? draft.rules.map(({ key: _key, ...r }) => ({ field: r.field, operator: r.operator, value: r.value.trim(), ...(r.field === "attribute" ? { attributeKey: r.attributeKey?.trim() } : {}) })) : [],
        imageAssetId: draft.imageAssetId,
        isPublished: draft.isPublished,
      };
      const saved = await bff<CollectionDetail>(isNew ? `${apiBase}/collections` : `${apiBase}/collections/${collection.id}`, { method: isNew ? "POST" : "PUT", body });
      if (draft.type === "manual" && (membershipDirty || (isNew && draft.productIds.length > 0))) {
        await bff(`${apiBase}/collections/${saved.id}/products`, { method: "PUT", body: { productIds: draft.productIds } });
      }
      setSavedAwaitingRefresh(true);
      toast({ tone: "success", title: isNew ? t("collections.saved.created") : t("collections.saved.updated") });
      if (isNew) router.replace(`${basePath}/products/collections/${saved.id}`);
      else router.refresh();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      const info = err.toInfo();
      setErrors(describeError(info).fields);
      setApiError(info);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!collection) return;
    setDeleting(true);
    try {
      await bff(`${apiBase}/collections/${collection.id}`, { method: "DELETE" });
      toast({ tone: "success", title: t("collections.delete.done") });
      router.push(`${basePath}/products/collections`);
    } catch (err) {
      if (err instanceof ApiError) setApiError(err.toInfo());
      else throw err;
      setDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  const addProduct = (id: string | null) => {
    if (!id || draft.productIds.includes(id)) return;
    const item = search.items.find((p) => p.id === id);
    if (item) setKnown((m) => new Map(m).set(id, item));
    setDraft((d) => ({ ...d, productIds: [...d.productIds, id] }));
  };
  const moveProduct = (index: number, delta: number) =>
    setDraft((d) => {
      const next = [...d.productIds];
      const [x] = next.splice(index, 1);
      if (x) next.splice(index + delta, 0, x);
      return { ...d, productIds: next };
    });

  const summary = Object.entries(errors).map(([path, message]) => ({ fieldId: path.startsWith("translations") ? "collection-title" : "collection-rules", message, label: path.startsWith("translations") ? t("collections.fields.title") : t("collections.rules.title") }));

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
      <PageHeader
        breadcrumbs={[
          { label: t("products.title"), href: `${basePath}/products` },
          { label: t("collections.title"), href: `${basePath}/products/collections` },
        ]}
        title={title || (isNew ? t("collections.new.title") : t("collections.untitled"))}
        status={collection ? <Badge tone={collection.type === "automated" ? "accent" : "neutral"}>{t(`collections.types.${collection.type}`)}</Badge> : null}
        meta={
          collection ? (
            <span>
              {t("collections.productCount", { count: collection.productCount })} · {t("products.meta.updated")} <DateTime value={collection.updatedAt} format="relative" />
            </span>
          ) : null
        }
        actions={
          <>
            {collection && canWrite ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-md" aria-label={t("common.rowActions", { name: title || t("collections.untitled") })}>
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem tone="danger" onSelect={() => setDeleteOpen(true)}>
                    {t("collections.delete.action")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {canWrite ? (
              <Button variant="primary" loading={saving} disabled={!dirty && !isNew} onClick={save}>
                {isNew ? t("collections.actions.create") : t("common.save")}
              </Button>
            ) : null}
          </>
        }
      />

      {!canWrite ? <InlineAlert tone="info">{t("commerce.noPermission", { permission: "catalog:write" })}</InlineAlert> : null}
      {apiError || summary.length ? <ErrorSummary {...(apiError ? { message: describeError(apiError).message } : {})} items={summary} /> : null}

      {store.supportedLocales.length > 1 ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-fg-muted">{t("products.contentLocale")}</span>
          <SegmentedControl
            aria-label={t("products.contentLocale")}
            value={locale}
            onValueChange={setLocale}
            options={[defaultLocale, ...store.supportedLocales.filter((l) => l !== defaultLocale)].map((l) => ({ value: l, label: l === defaultLocale ? `${localeLabel(l, ui)} · ${t("common.default")}` : localeLabel(l, ui) }))}
          />
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={t("collections.sections.content")} padding="form">
            <div className="flex flex-col gap-4">
              <Field label={t("collections.fields.title")} required={locale === defaultLocale} id="collection-title" error={errors[`translations.${locale}.title`] ?? null}>
                <Input {...langProps} value={tr.title} maxLength={200} showCount disabled={disabled} onChange={(e) => setTr({ title: e.target.value })} placeholder={locale === defaultLocale ? t("collections.fields.titlePlaceholder") : (draft.translations[defaultLocale]?.title ?? "")} />
              </Field>
              <div className="flex flex-col gap-1.5">
                <span id="collection-description-label" className="text-base font-medium text-fg">
                  {t("collections.fields.description")}
                </span>
                <RichTextEditor
                  key={`c-desc-${locale}-${resetNonce}`}
                  aria-labelledby="collection-description-label"
                  initialContent={tr.descriptionHtml}
                  onChange={(c) => setTr({ descriptionHtml: c.isEmpty ? "" : c.html })}
                  disabled={disabled}
                  lang={langProps.lang}
                  dir={langProps.dir}
                />
              </div>
            </div>
          </Card>

          {draft.type === "automated" ? (
            <Card title={t("collections.rules.title")} description={t("collections.rules.description")} padding="form">
              <div className="flex flex-col gap-4" id="collection-rules" tabIndex={-1}>
                <RadioGroup
                  aria-label={t("collections.rules.matchLabel")}
                  orientation="horizontal"
                  name="matchAll"
                  value={draft.matchAll ? "all" : "any"}
                  disabled={disabled}
                  onValueChange={(v) => setDraft((d) => ({ ...d, matchAll: v === "all" }))}
                  options={[
                    { value: "all", label: t("collections.rules.matchAll") },
                    { value: "any", label: t("collections.rules.matchAny") },
                  ]}
                />
                {errors.rules ? <p className="text-sm text-danger">{errors.rules}</p> : null}
                <ol className="flex flex-col gap-2">
                  {draft.rules.map((r, i) => (
                    <li key={r.key} className="flex flex-wrap items-start gap-2 rounded-lg border border-border p-2">
                      <div className="w-full sm:w-44">
                        <Select
                          aria-label={t("collections.rules.fieldN", { n: i + 1 })}
                          value={r.field}
                          disabled={disabled}
                          onValueChange={(v) => {
                            const field = v as RuleField;
                            const ops = operatorsFor(field);
                            setRule(r.key, { field, operator: ops.includes(r.operator) ? r.operator : ops[0]!, value: "", attributeKey: field === "attribute" ? (r.attributeKey ?? "") : null });
                          }}
                          options={FIELD_ORDER.map((f) => ({ value: f, label: t(`collections.rules.fields.${f}`) }))}
                        />
                      </div>
                      {r.field === "attribute" ? (
                        <input
                          value={r.attributeKey ?? ""}
                          disabled={disabled}
                          placeholder={t("collections.rules.attributeKey")}
                          aria-label={t("collections.rules.attributeKeyN", { n: i + 1 })}
                          aria-invalid={errors[`rules.${i}.attributeKey`] ? true : undefined}
                          onChange={(e) => setRule(r.key, { attributeKey: e.target.value })}
                          className={controlClasses({ invalid: Boolean(errors[`rules.${i}.attributeKey`]), className: "w-full font-mono sm:w-36" })}
                        />
                      ) : null}
                      <div className="w-full sm:w-44">
                        <Select
                          aria-label={t("collections.rules.operatorN", { n: i + 1 })}
                          value={r.operator}
                          disabled={disabled}
                          onValueChange={(v) => setRule(r.key, { operator: v as RuleOperator })}
                          options={operatorsFor(r.field).map((o) => ({ value: o, label: t(`collections.rules.operators.${o}`) }))}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <RuleValueInput rule={r} index={i} categories={categoryOptions} disabled={disabled} invalid={Boolean(errors[`rules.${i}.value`])} onChange={(value) => setRule(r.key, { value })} />
                        {errors[`rules.${i}.value`] ? <p className="mt-1 text-sm text-danger">{errors[`rules.${i}.value`]}</p> : null}
                      </div>
                      <Button variant="ghost" size="icon-md" disabled={disabled} aria-label={t("collections.rules.remove", { n: i + 1 })} onClick={() => setDraft((d) => ({ ...d, rules: d.rules.filter((x) => x.key !== r.key) }))}>
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ol>
                {draft.rules.length < 30 ? (
                  <Button className="self-start" disabled={disabled} onClick={() => setDraft((d) => ({ ...d, rules: [...d.rules, { key: ruleKey(), field: "tag", operator: "equals", value: "", attributeKey: null }] }))}>
                    <Plus aria-hidden="true" />
                    {t("collections.rules.add")}
                  </Button>
                ) : null}
                <p className="text-xs text-fg-subtle">{t("collections.rules.note")}</p>
              </div>
            </Card>
          ) : (
            <Card title={t("collections.members.title", { count: draft.productIds.length })} description={t("collections.members.description")} padding="form">
              <div className="flex flex-col gap-3">
                {membersTruncated ? <InlineAlert tone="warning">{t("collections.members.truncated")}</InlineAlert> : null}
                {!isNew && draft.sortOrder === "manual" ? <p className="text-sm text-fg-muted">{t("collections.members.orderNote")}</p> : null}
                {canWrite ? (
                  <Field label={t("collections.members.add")}>
                    <Combobox
                      value={null}
                      onChange={addProduct}
                      onSearch={search.search}
                      loading={search.loading}
                      error={search.error ? describeError(search.error.toInfo()).message : null}
                      onRetry={search.retry}
                      placeholder={t("collections.members.searchPlaceholder")}
                      options={search.items.filter((p) => !draft.productIds.includes(p.id)).map((p) => ({ value: p.id, label: p.title || p.handle, description: p.skus[0] ?? "" }))}
                    />
                  </Field>
                ) : null}
                {draft.productIds.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-base text-fg-muted">{t("collections.members.empty")}</p>
                ) : (
                  <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
                    {draft.productIds.map((id, i) => {
                      const p = known.get(id);
                      const name = p?.title || p?.handle || id;
                      return (
                        <li key={id} className="flex items-center gap-3 px-3 py-2">
                          <span className="w-6 text-end text-sm text-fg-subtle tabular">{i + 1}</span>
                          <Thumb src={mediaUrl(media, p?.imageObjectKey)} size={28} />
                          <span className="min-w-0 flex-1 truncate text-base text-fg">{name}</span>
                          {canWrite ? (
                            <span className="flex gap-1">
                              <Button size="icon-sm" variant="ghost" disabled={i === 0} aria-label={t("collections.members.up", { name })} onClick={() => moveProduct(i, -1)}>
                                <ArrowUp aria-hidden="true" />
                              </Button>
                              <Button size="icon-sm" variant="ghost" disabled={i === draft.productIds.length - 1} aria-label={t("collections.members.down", { name })} onClick={() => moveProduct(i, 1)}>
                                <ArrowDown aria-hidden="true" />
                              </Button>
                              <Button size="icon-sm" variant="ghost" aria-label={t("collections.members.remove", { name })} onClick={() => setDraft((d) => ({ ...d, productIds: d.productIds.filter((x) => x !== id) }))}>
                                <X aria-hidden="true" />
                              </Button>
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </Card>
          )}

          <Card title={t("products.sections.seo")} description={t("products.seo.description")} padding="form">
            <div className="flex flex-col gap-4">
              <Field label={t("products.fields.handle")} optional description={t("collections.fields.handleHint")} error={errors[`translations.${locale}.handle`] ?? null}>
                <Input {...langProps} value={tr.handle} maxLength={200} disabled={disabled} onChange={(e) => setTr({ handle: e.target.value.toLowerCase() })} prefix={<span className="font-mono text-xs">{locale === defaultLocale ? "" : `/${locale}`}/collections/</span>} />
              </Field>
              <Field label={t("products.fields.seoTitle")} optional>
                <Input {...langProps} value={tr.seoTitle} maxLength={70} showCount disabled={disabled} onChange={(e) => setTr({ seoTitle: e.target.value })} placeholder={tr.title} />
              </Field>
              <Field label={t("products.fields.seoDescription")} optional>
                <Textarea {...langProps} value={tr.seoDescription} maxLength={320} showCount rows={3} disabled={disabled} onChange={(e) => setTr({ seoDescription: e.target.value })} />
              </Field>
            </div>
          </Card>
        </div>

        <aside aria-label={t("collections.aside")} className="flex min-w-0 flex-col gap-4">
          <Card title={t("collections.sections.type")}>
            {isNew ? (
              <RadioGroup
                aria-label={t("collections.sections.type")}
                name="type"
                value={draft.type}
                disabled={disabled}
                onValueChange={(v) => setDraft((d) => ({ ...d, type: v as "manual" | "automated", sortOrder: v === "automated" && d.sortOrder === "manual" ? "newest" : d.sortOrder }))}
                options={[
                  { value: "manual", label: t("collections.types.manual"), description: t("collections.types.manualHint") },
                  { value: "automated", label: t("collections.types.automated"), description: t("collections.types.automatedHint") },
                ]}
              />
            ) : (
              <p className="text-base text-fg-muted">{t(`collections.types.${draft.type}Hint`)}</p>
            )}
          </Card>
          <Card title={t("collections.sections.visibility")}>
            <div className="flex flex-col gap-4">
              <Switch checked={draft.isPublished} disabled={disabled} onCheckedChange={(v) => setDraft((d) => ({ ...d, isPublished: v }))} label={t("collections.fields.isPublished")} description={t("collections.fields.isPublishedHint")} />
              <Field label={t("collections.fields.sortOrder")}>
                <Select
                  value={draft.sortOrder}
                  disabled={disabled}
                  onValueChange={(v) => setDraft((d) => ({ ...d, sortOrder: v as CollectionSortOrder }))}
                  options={COLLECTION_SORT_ORDERS.filter((o) => draft.type === "manual" || o !== "manual").map((o) => ({ value: o, label: t(`collections.sort.${o}`) }))}
                />
              </Field>
            </div>
          </Card>
          <Card title={t("collections.sections.image")}>
            <AssetField label={t("collections.fields.image")} value={draft.imageAssetId} onChange={(id) => setDraft((d) => ({ ...d, imageAssetId: id }))} disabled={disabled} />
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
              <Button variant="primary" loading={saving} onClick={save}>
                {isNew ? t("collections.actions.create") : t("common.save")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {collection ? (
        <AlertDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={t("collections.delete.title")}
          description={t("collections.delete.body")}
          confirmLabel={t("collections.delete.action")}
          pending={deleting}
          onConfirm={remove}
        />
      ) : null}
    </div>
  );
}

function RuleValueInput({ rule, index, categories, disabled, invalid, onChange }: { rule: RuleDraft; index: number; categories: { value: string; label: string; description?: string }[]; disabled: boolean; invalid: boolean; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const { store } = useStore();
  const label = t("collections.rules.valueN", { n: index + 1 });
  if (rule.field === "price" || rule.field === "compare_at_price") {
    return (
      <Field label={label} hideLabel>
        <MoneyInput currency={store.defaultCurrency} value={rule.value || null} onChange={(v) => onChange(v ?? "")} disabled={disabled} />
      </Field>
    );
  }
  if (rule.field === "inventory") {
    return <input type="number" inputMode="numeric" min={0} value={rule.value} disabled={disabled} aria-label={label} aria-invalid={invalid || undefined} onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))} className={controlClasses({ invalid, className: "tabular" })} />;
  }
  if (rule.field === "created_at") {
    return (
      <input
        type="datetime-local"
        value={rule.value ? utcToZonedInput(rule.value, store.timezone) : ""}
        disabled={disabled}
        aria-label={label}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value ? (zonedToUtc(e.target.value, store.timezone) ?? "") : "")}
        className={controlClasses({ invalid, className: "tabular" })}
      />
    );
  }
  if (rule.field === "category") {
    return categories.length ? (
      <Field label={label} hideLabel>
        <Combobox options={categories} value={rule.value || null} onChange={(v) => onChange(v ?? "")} disabled={disabled} />
      </Field>
    ) : (
      <p className="py-1.5 text-sm text-fg-muted">{t("products.organization.noCategories")}</p>
    );
  }
  return (
    <input
      value={rule.value}
      disabled={disabled}
      maxLength={200}
      aria-label={label}
      aria-invalid={invalid || undefined}
      placeholder={rule.operator === "in" ? t("collections.rules.inPlaceholder") : ""}
      onChange={(e) => onChange(e.target.value)}
      className={controlClasses({ invalid })}
    />
  );
}

