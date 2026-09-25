"use client";

import { Archive, ExternalLink, LayoutTemplate, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog } from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { ErrorSummary, FormSection } from "@/components/ui/form-section";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { LocalizedTextField } from "@/components/ui/localized-text-field";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { ApiResult } from "@/lib/api/server";
import { PREFIX_PATTERN, labelText, localizedPath } from "@/lib/content/fields";
import type { ContentTypeDetail, ContentTypeSettings, FieldDef, TypeTemplates } from "@/lib/content/types";
import { localeLabel } from "@/lib/locales";
import { CustomFieldsEditor, cleanField, fieldProblems } from "./custom-fields-editor";
import { invalidateContentTypes } from "./record-pickers";

const PREFIX_KEYS = new Set(["errors.content_type.prefix_taken", "errors.content_type.prefix_reserved", "errors.content_type.invalid_prefix", "errors.content_type.prefix_taken_by_page"]);

function clean(map: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(map).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
}

/**
 * Content › type settings: names, localized URL prefixes (moving a prefix keeps old URLs with
 * 301s), list and index behaviour, hidden optional fields, the site's own fields, the template
 * pages entries render with, and archiving.
 */
export function TypeSettings({ initial, templates }: { initial: ContentTypeDetail; templates: ApiResult<TypeTemplates> }) {
  const { t, locale, describeError } = useI18n();
  const { apiBase, basePath, store, can } = useStore();
  const router = useRouter();
  const { toast, toastError } = useToast();
  const [type, setType] = useState(initial);
  const canManage = can("content:manage") && type.status === "active";
  const storeLocales = [store.defaultLocale, ...store.supportedLocales.filter((l) => l !== store.defaultLocale)];
  const labelLocales = [...new Set([...storeLocales, "tr", "en"])];
  const prefixable = type.kind !== "taxonomy" && (type.routable || !type.builtinKey);

  // General: labels, prefixes, settings
  const toGeneral = (ty: ContentTypeDetail) => ({
    name: { ...ty.labels.name } as Record<string, string>,
    namePlural: { ...ty.labels.namePlural } as Record<string, string>,
    prefixes: Object.fromEntries(storeLocales.map((l) => [l, ty.routePrefix[l] ?? ""])) as Record<string, string>,
    settings: { ...ty.settings } as ContentTypeSettings,
  });
  const [general, setGeneral] = useState(() => toGeneral(initial));
  const [generalPending, setGeneralPending] = useState(false);
  const [generalError, setGeneralError] = useState<ApiErrorInfo | null>(null);
  const [tried, setTried] = useState(false);
  const generalDirty = JSON.stringify(general) !== JSON.stringify(toGeneral(type));

  const prefixProblems: Record<string, string> = {};
  if (prefixable) for (const l of storeLocales) if (general.prefixes[l] && !PREFIX_PATTERN.test(general.prefixes[l]!)) prefixProblems[l] = t("content.types.prefixInvalid");
  const described = generalError ? describeError(generalError) : null;
  const errorLocale = (generalError?.details as { locale?: string } | undefined)?.locale;
  const prefixError = (l: string) => (tried ? prefixProblems[l] : undefined) ?? (generalError && PREFIX_KEYS.has(generalError.messageKey) && (errorLocale === l || (!errorLocale && l === store.defaultLocale)) ? described?.message : undefined) ?? null;

  const saveGeneral = async () => {
    setTried(true);
    if (Object.keys(prefixProblems).length) return;
    setGeneralPending(true);
    setGeneralError(null);
    try {
      const body: Record<string, unknown> = {};
      const labels = { name: clean(general.name), namePlural: clean(general.namePlural) };
      if (JSON.stringify(labels) !== JSON.stringify({ name: clean(type.labels.name), namePlural: clean(type.labels.namePlural) })) body.labels = labels;
      const nextPrefixes = { ...type.routePrefix };
      for (const l of storeLocales) {
        const p = general.prefixes[l]?.trim() ?? "";
        if (p) nextPrefixes[l] = p;
        else delete nextPrefixes[l];
      }
      // Other registry languages keep their prefixes, unless the type's routes are removed entirely.
      const removeAll = storeLocales.every((l) => !general.prefixes[l]?.trim());
      if (prefixable && JSON.stringify(removeAll ? {} : nextPrefixes) !== JSON.stringify(type.routePrefix)) body.routePrefix = removeAll ? {} : nextPrefixes;
      if (JSON.stringify(general.settings) !== JSON.stringify(type.settings)) body.settings = general.settings;
      if (Object.keys(body).length) {
        const next = await bff<ContentTypeDetail>(`${apiBase}/content/types/${encodeURIComponent(type.key)}`, { method: "PATCH", body });
        setType(next);
        setGeneral(toGeneral(next));
        invalidateContentTypes();
        router.refresh();
      }
      setTried(false);
      toast({ tone: "success", title: t("content.typeSettings.saved") });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setGeneralError(err.toInfo());
    } finally {
      setGeneralPending(false);
    }
  };

  // Fields
  const savedKeys = new Set(type.customFields.map((f) => f.key));
  const [fields, setFields] = useState<FieldDef[]>(() => type.customFields);
  const [fieldsPending, setFieldsPending] = useState(false);
  const [fieldsError, setFieldsError] = useState<ApiErrorInfo | null>(null);
  const [fieldsTried, setFieldsTried] = useState(false);
  const fieldsDirty = JSON.stringify(fields) !== JSON.stringify(type.customFields);
  const problems = fieldProblems(fields);
  const fieldsDescribed = fieldsError ? describeError(fieldsError) : null;
  const saveFields = async () => {
    setFieldsTried(true);
    if (Object.keys(problems).length) return;
    setFieldsPending(true);
    setFieldsError(null);
    try {
      const next = await bff<ContentTypeDetail>(`${apiBase}/content/types/${encodeURIComponent(type.key)}`, { method: "PATCH", body: { customFields: fields.map(cleanField) } });
      setType(next);
      setFields(next.customFields);
      setFieldsTried(false);
      invalidateContentTypes();
      toast({ tone: "success", title: t("content.typeSettings.fieldsSaved") });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setFieldsError(err.toInfo());
    } finally {
      setFieldsPending(false);
    }
  };

  // Templates and archive
  const [tpl, setTpl] = useState(templates);
  const [tplPending, setTplPending] = useState(false);
  const createTemplates = async () => {
    setTplPending(true);
    try {
      const res = await bff<TypeTemplates>(`${apiBase}/content/types/${encodeURIComponent(type.key)}/templates`, { method: "POST" });
      setTpl({ ok: true, data: res });
      toast({ tone: "success", title: t("content.typeSettings.templatesCreated") });
    } catch (err) {
      if (err instanceof ApiError) toastError(err.toInfo());
      else throw err;
    } finally {
      setTplPending(false);
    }
  };
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archivePending, setArchivePending] = useState(false);
  const archive = async () => {
    setArchivePending(true);
    try {
      const next = await bff<ContentTypeDetail>(`${apiBase}/content/types/${encodeURIComponent(type.key)}/archive`, { method: "POST" });
      setType(next);
      invalidateContentTypes();
      setArchiveOpen(false);
      toast({ tone: "success", title: t("content.typeSettings.archived") });
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) toastError(err.toInfo(), t("content.typeSettings.archiveFailed"));
      else throw err;
    } finally {
      setArchivePending(false);
    }
  };

  const hideable = type.fields.filter((f) => !f.required && f.key !== type.titleField);
  const setSettings = (patch: Partial<ContentTypeSettings>) => setGeneral((g) => ({ ...g, settings: { ...g.settings, ...patch } }));
  const plural = labelText(type.labels.namePlural, locale, type.key);

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-8">
      <PageHeader
        title={t("content.typeSettings.title", { name: plural })}
        breadcrumbs={[
          { label: t("content.title"), href: `${basePath}/content` },
          { label: plural, href: `${basePath}/content/${encodeURIComponent(type.key)}` },
        ]}
        status={type.status === "archived" ? <Badge tone="neutral">{t("statuses.contentType.archived")}</Badge> : null}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{type.key}</span>·<span>{t(`content.kinds.${type.kind}`)}</span>·<span>{type.builtinKey ? t("content.typeSettings.builtin", { key: type.builtinKey, version: type.builtinVersion ?? 1 }) : t("content.types.custom")}</span>
          </span>
        }
      />
      {!can("content:manage") ? <InlineAlert tone="info">{t("content.types.readOnly")}</InlineAlert> : null}
      {type.status === "archived" ? <InlineAlert tone="warning">{t("content.typeSettings.archivedNotice")}</InlineAlert> : null}

      <FormSection
        title={t("content.typeSettings.generalTitle")}
        description={t("content.typeSettings.generalDescription")}
        canEdit={canManage}
        pending={generalPending}
        dirty={generalDirty}
        onCancel={() => {
          setGeneral(toGeneral(type));
          setGeneralError(null);
          setTried(false);
        }}
        onSubmit={() => void saveGeneral()}
        error={described && !(PREFIX_KEYS.has(generalError!.messageKey)) ? <ErrorSummary message={described.message} items={Object.entries(described.fields).map(([p, m]) => ({ fieldId: "ts-name", message: m, label: p }))} /> : null}
      >
        <LocalizedTextField label={t("content.typeSettings.name")} locales={labelLocales} defaultLocale={store.defaultLocale} value={general.name} maxLength={120} required disabled={!canManage} onChange={(name) => setGeneral((g) => ({ ...g, name }))} />
        <LocalizedTextField label={t("content.typeSettings.plural")} locales={labelLocales} defaultLocale={store.defaultLocale} value={general.namePlural} maxLength={120} required disabled={!canManage} onChange={(namePlural) => setGeneral((g) => ({ ...g, namePlural }))} />
        {prefixable ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-base font-medium text-fg">{t("content.typeSettings.prefixes")}</legend>
            <p className="-mt-1 text-sm text-fg-muted">{t("content.typeSettings.prefixesHint")}</p>
            {storeLocales.map((l) => {
              const p = general.prefixes[l]?.trim();
              return (
                <Field
                  key={l}
                  id={`ts-prefix-${l}`}
                  label={localeLabel(l, locale)}
                  error={prefixError(l)}
                  description={p ? <span className="font-mono">{localizedPath(l, store.defaultLocale, `/${p}${type.kind === "singleton" ? "" : "/…"}`)}</span> : t("content.typeSettings.prefixEmpty")}
                >
                  <Input value={general.prefixes[l] ?? ""} prefix="/" maxLength={100} className="font-mono" disabled={!canManage} onChange={(e) => setGeneral((g) => ({ ...g, prefixes: { ...g.prefixes, [l]: e.target.value.toLowerCase() } }))} />
                </Field>
              );
            })}
            {type.routable && storeLocales.every((l) => !general.prefixes[l]?.trim()) ? <InlineAlert tone="warning">{t("content.typeSettings.removeRoutesWarning")}</InlineAlert> : null}
          </fieldset>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("content.typeSettings.sortField")}>
              <Select
                value={general.settings.defaultSort?.field ?? "updatedAt"}
                disabled={!canManage}
                onValueChange={(field) => setSettings({ defaultSort: { field: field as "title", direction: general.settings.defaultSort?.direction ?? "desc" } })}
                options={(["publishedAt", "updatedAt", "position", "title"] as const).map((f) => ({ value: f, label: t(`content.typeSettings.sortFields.${f}`) }))}
              />
            </Field>
            <Field label={t("content.typeSettings.sortDirection")}>
              <Select
                value={general.settings.defaultSort?.direction ?? "desc"}
                disabled={!canManage}
                onValueChange={(direction) => setSettings({ defaultSort: { field: general.settings.defaultSort?.field ?? "updatedAt", direction: direction as "asc" } })}
                options={(["asc", "desc"] as const).map((d) => ({ value: d, label: t(`content.typeSettings.directions.${d}`) }))}
              />
            </Field>
        </div>
        {type.kind === "collection" && type.routable ? (
          <Field label={t("content.typeSettings.indexMode")} description={t(`content.typeSettings.indexModeHints.${general.settings.indexMode ?? "auto"}`)}>
            <Select value={general.settings.indexMode ?? "auto"} disabled={!canManage} onValueChange={(v) => setSettings({ indexMode: v as "auto" })} options={(["auto", "page", "none"] as const).map((m) => ({ value: m, label: t(`content.typeSettings.indexModes.${m}`) }))} />
          </Field>
        ) : null}
        {type.kind !== "singleton" ? (
          <div className="flex flex-col gap-3">
            <Switch checked={general.settings.hierarchical === true} disabled={!canManage} onCheckedChange={(c) => setSettings({ hierarchical: c })} label={t("content.typeSettings.hierarchical")} description={t("content.typeSettings.hierarchicalHint")} />
            {general.settings.hierarchical ? (
              <Field label={t("content.typeSettings.maxDepth")} className="w-40">
                <Input type="number" min={1} max={10} value={String(general.settings.maxDepth ?? 3)} disabled={!canManage} onChange={(e) => setSettings({ maxDepth: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })} />
              </Field>
            ) : null}
          </div>
        ) : null}
        {hideable.length ? (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-base font-medium text-fg">{t("content.typeSettings.hiddenFields")}</legend>
            <p className="mb-1 text-sm text-fg-muted">{t("content.typeSettings.hiddenFieldsHint")}</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {hideable.map((f) => {
                const hidden = (general.settings.hiddenFields ?? []).includes(f.key);
                return (
                  <Checkbox
                    key={f.key}
                    checked={hidden}
                    disabled={!canManage}
                    onCheckedChange={(c) => setSettings({ hiddenFields: c ? [...(general.settings.hiddenFields ?? []), f.key] : (general.settings.hiddenFields ?? []).filter((k) => k !== f.key) })}
                    label={labelText(f.label, locale, f.key)}
                  />
                );
              })}
            </div>
          </fieldset>
        ) : null}
      </FormSection>

      <FormSection
        title={type.builtinKey ? t("content.typeSettings.extraFieldsTitle") : t("content.typeSettings.fieldsTitle")}
        description={type.builtinKey ? t("content.typeSettings.extraFieldsDescription") : t("content.typeSettings.fieldsDescription")}
        canEdit={canManage}
        pending={fieldsPending}
        dirty={fieldsDirty}
        onCancel={() => {
          setFields(type.customFields);
          setFieldsError(null);
          setFieldsTried(false);
        }}
        onSubmit={() => void saveFields()}
        error={fieldsDescribed ? <ErrorSummary message={fieldsDescribed.message} items={Object.entries(fieldsDescribed.fields).map(([p, m]) => ({ fieldId: "ts-fields", message: m, label: p }))} /> : null}
      >
        <div id="ts-fields">
          {type.builtinKey ? (
            <p className="mb-3 text-sm text-fg-muted">{t("content.typeSettings.builtinFields", { fields: type.fields.filter((f) => !f.custom).map((f) => labelText(f.label, locale, f.key)).join(", ") })}</p>
          ) : null}
          <CustomFieldsEditor fields={fields} onChange={setFields} savedKeys={savedKeys} problems={fieldsTried ? problems : {}} apiIssue={(p) => fieldsDescribed?.fields[p]} disabled={!canManage || fieldsPending} />
        </div>
      </FormSection>

      {type.routable || (tpl.ok && tpl.data.items.length) ? (
        <Card title={t("content.typeSettings.templatesTitle")} description={t("content.typeSettings.templatesDescription")}>
          {tpl.ok ? (
            <div className="flex flex-col gap-3">
              {tpl.data.items.length ? (
                <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                  {tpl.data.items.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <LayoutTemplate aria-hidden="true" className="size-4 text-fg-muted" />
                        <span className="truncate">{labelText(p.title, locale, p.handle)}</span>
                        <span className="font-mono text-xs text-fg-subtle">{p.templateKey}</span>
                        {p.hasUnpublishedChanges ? <Badge tone="warning">{t("content.entries.unpublishedChanges")}</Badge> : null}
                      </span>
                      {can("storefront:read") ? (
                        <Link href={`${basePath}/storefront/editor?page=${p.id}`} className="inline-flex shrink-0 items-center gap-1 text-sm text-link underline">
                          <ExternalLink aria-hidden="true" className="size-3.5" />
                          {t("content.typeSettings.openTemplate")}
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {tpl.data.missing.length ? (
                <InlineAlert
                  tone="info"
                  actions={
                    can("storefront:write") && type.status === "active" ? (
                      <Button size="sm" loading={tplPending} onClick={() => void createTemplates()}>
                        <Plus aria-hidden="true" />
                        {t("content.typeSettings.createTemplates")}
                      </Button>
                    ) : null
                  }
                >
                  {t("content.typeSettings.templatesMissing", { keys: tpl.data.missing.join(", ") })}
                </InlineAlert>
              ) : null}
            </div>
          ) : (
            <ErrorState error={tpl.error} compact />
          )}
        </Card>
      ) : null}

      {can("content:manage") && type.status === "active" ? (
        <Card title={t("content.typeSettings.archiveTitle")} description={t("content.typeSettings.archiveDescription")}>
          <Button variant="danger" onClick={() => setArchiveOpen(true)}>
            <Archive aria-hidden="true" />
            {t("content.typeSettings.archive")}
          </Button>
        </Card>
      ) : null}
      <AlertDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={t("content.typeSettings.archiveConfirmTitle", { name: plural })}
        description={t("content.typeSettings.archiveConfirmBody")}
        confirmLabel={t("content.typeSettings.archive")}
        pending={archivePending}
        onConfirm={() => void archive()}
      />
    </div>
  );
}
