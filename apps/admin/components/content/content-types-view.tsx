"use client";

import { Download, FileText, Plus, Settings2, Shapes, Tags } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { ErrorSummary } from "@/components/ui/form-section";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { RadioGroup } from "@/components/ui/radio-group";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { PREFIX_PATTERN, labelText, typeIndexPath } from "@/lib/content/fields";
import type { BuiltinTypeInfo, ContentTypeDetail, ContentTypeKind, ContentTypeSummary, FieldDef } from "@/lib/content/types";
import { localeLabel } from "@/lib/locales";
import { CustomFieldsEditor, cleanField, fieldProblems, newField } from "./custom-fields-editor";
import { invalidateContentTypes } from "./record-pickers";

/**
 * Content › Types: the types installed on the site (with entry counts), the built-in types that
 * can be installed, and custom types built from the safe field set.
 */
export function ContentTypesView({ types, available }: { types: ContentTypeSummary[]; available: BuiltinTypeInfo[] }) {
  const { t, locale } = useI18n();
  const { basePath, apiBase, can, store } = useStore();
  const router = useRouter();
  const { toast, toastError } = useToast();
  const [installing, setInstalling] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const canManage = can("content:manage");
  const active = types.filter((ty) => ty.status === "active");
  const main = active.filter((ty) => ty.kind !== "taxonomy");
  const taxonomies = active.filter((ty) => ty.kind === "taxonomy");
  const archived = types.filter((ty) => ty.status === "archived");
  const installable = available.filter((d) => !d.installed && d.kind !== "taxonomy");

  const install = async (d: BuiltinTypeInfo) => {
    setInstalling(d.key);
    try {
      const type = await bff<ContentTypeDetail>(`${apiBase}/content/types/install`, { method: "POST", body: { builtinKey: d.key } });
      invalidateContentTypes();
      toast({ tone: "success", title: t("content.types.installed", { name: labelText(type.labels.namePlural, locale, type.key) }) });
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) toastError(err.toInfo(), t("content.types.installFailed"));
      else throw err;
    } finally {
      setInstalling(null);
    }
  };

  const counts = (ty: ContentTypeSummary) => {
    const c = ty.entryCounts ?? {};
    return [
      c.published ? t("content.types.countPublished", { count: c.published }) : null,
      c.draft ? t("content.types.countDraft", { count: c.draft }) : null,
      c.scheduled ? t("content.types.countScheduled", { count: c.scheduled }) : null,
    ].filter(Boolean);
  };

  const typeRow = (ty: ContentTypeSummary) => {
    const path = typeIndexPath(ty, store.defaultLocale, store.defaultLocale);
    const list = counts(ty);
    return (
      <li key={ty.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`${basePath}/content/${encodeURIComponent(ty.key)}`} className="font-medium text-fg">
              {labelText(ty.labels.namePlural, locale, ty.key)}
            </Link>
            <Badge tone="neutral">{t(`content.kinds.${ty.kind}`)}</Badge>
            {ty.builtinKey ? null : <Badge tone="info">{t("content.types.custom")}</Badge>}
            {ty.upgradeAvailable ? <Badge tone="warning">{t("content.types.upgradeAvailable")}</Badge> : null}
          </span>
          <span className="text-sm text-fg-muted">
            {path ? <span className="font-mono">{path}</span> : ty.kind === "taxonomy" ? t("content.types.termsNoUrl") : t("content.types.noRoutes")}
            {" · "}
            {list.length ? list.join(" · ") : t("content.types.noEntries")}
          </span>
        </div>
        <span className="flex shrink-0 gap-2">
          <ButtonLink href={`${basePath}/content/${encodeURIComponent(ty.key)}`} size="sm">
            {ty.kind === "taxonomy" ? t("content.types.openTerms") : t("content.types.openEntries")}
          </ButtonLink>
          <ButtonLink href={`${basePath}/content/${encodeURIComponent(ty.key)}/settings`} size="sm" variant="ghost" aria-label={t("content.types.settingsOf", { name: labelText(ty.labels.namePlural, locale, ty.key) })}>
            <Settings2 aria-hidden="true" />
          </ButtonLink>
        </span>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {!canManage ? <InlineAlert tone="info">{t("content.types.readOnly")}</InlineAlert> : null}
      <Card
        title={t("content.types.installedTitle")}
        description={t("content.types.installedDescription")}
        flush
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden="true" />
              {t("content.types.newCustom")}
            </Button>
          ) : null
        }
      >
        {main.length ? (
          <ul className="divide-y divide-border">{main.map(typeRow)}</ul>
        ) : (
          <EmptyState icon={FileText} title={t("content.types.emptyTitle")} description={t("content.types.emptyBody")} />
        )}
      </Card>

      {taxonomies.length ? (
        <Card title={t("content.types.taxonomiesTitle")} description={t("content.types.taxonomiesDescription")} flush>
          <ul className="divide-y divide-border">{taxonomies.map(typeRow)}</ul>
        </Card>
      ) : null}

      <Card title={t("content.types.availableTitle")} description={t("content.types.availableDescription")}>
        {installable.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {installable.map((d) => (
              <li key={d.key} className="flex flex-col gap-2 rounded-md border border-border p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <Shapes aria-hidden="true" className="size-4 text-fg-muted" />
                    <span className="font-medium text-fg">{labelText(d.labels.namePlural, locale, d.key)}</span>
                  </span>
                  <Badge tone="neutral">{t(`content.kinds.${d.kind}`)}</Badge>
                </div>
                <p className="text-sm text-fg-muted">{labelText(d.description, locale)}</p>
                <p className="text-xs text-fg-subtle">
                  {d.routable ? <span className="font-mono">/{d.defaultPrefixes[store.defaultLocale] ?? d.defaultPrefixes.en}</span> : t("content.types.noRoutes")}
                  {d.requires.length ? ` · ${t("content.types.bringsAlong", { types: d.requires.map((r) => labelText(available.find((x) => x.key === r)?.labels.namePlural, locale, r)).join(", ") })}` : ""}
                </p>
                {canManage ? (
                  <Button size="sm" className="mt-1 self-start" loading={installing === d.key} disabled={installing !== null} onClick={() => void install(d)}>
                    <Download aria-hidden="true" />
                    {t("content.types.install")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-muted">{t("content.types.allInstalled")}</p>
        )}
      </Card>

      {archived.length ? (
        <Card title={t("content.types.archivedTitle")} description={t("content.types.archivedDescription")} flush>
          <ul className="divide-y divide-border">
            {archived.map((ty) => (
              <li key={ty.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="flex items-center gap-2">
                  <Tags aria-hidden="true" className="size-4 text-fg-subtle" />
                  {labelText(ty.labels.namePlural, locale, ty.key)}
                  <span className="font-mono text-xs text-fg-subtle">{ty.key}</span>
                </span>
                <ButtonLink href={`${basePath}/content/${encodeURIComponent(ty.key)}`} size="sm" variant="ghost">
                  {t("content.types.openEntries")}
                </ButtonLink>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {createOpen ? <CreateCustomTypeDialog onClose={() => setCreateOpen(false)} /> : null}
    </div>
  );
}

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,47}$/;

function CreateCustomTypeDialog({ onClose }: { onClose: () => void }) {
  const { t, locale, describeError } = useI18n();
  const { apiBase, basePath, store } = useStore();
  const router = useRouter();
  const [key, setKey] = useState("");
  const [kind, setKind] = useState<ContentTypeKind>("collection");
  const [name, setName] = useState({ tr: "", en: "" });
  const [plural, setPlural] = useState({ tr: "", en: "" });
  const [routable, setRoutable] = useState(true);
  const [prefixes, setPrefixes] = useState<Record<string, string>>({});
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [tried, setTried] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const locales = [store.defaultLocale, ...store.supportedLocales.filter((l) => l !== store.defaultLocale)];

  const local: Record<string, string> = {};
  if (!KEY_PATTERN.test(key)) local.key = t("content.types.keyInvalid");
  if (!name.tr.trim() && !name.en.trim()) local["labels.name"] = t("content.fieldsEditor.labelRequired");
  if (!plural.tr.trim() && !plural.en.trim()) local["labels.namePlural"] = t("content.fieldsEditor.labelRequired");
  const hasRoutes = kind !== "taxonomy" && routable;
  if (hasRoutes) for (const l of locales) if (prefixes[l] && !PREFIX_PATTERN.test(prefixes[l]!)) local[`routePrefix.${l}`] = t("content.types.prefixInvalid");
  if (hasRoutes && !prefixes[store.defaultLocale]) local[`routePrefix.${store.defaultLocale}`] = t("content.types.prefixRequired");
  const problems = fieldProblems(fields);
  const described = error ? describeError(error, { "errors.content_type.key_taken": "key", "errors.content_type.key_reserved": "key", "errors.content_type.invalid_key": "key" }) : null;
  const apiField = (path: string) => described?.fields[path] ?? Object.entries(described?.fields ?? {}).find(([p]) => p.startsWith(`${path}.`))?.[1];
  const prefixError = (l: string) => {
    if (tried && local[`routePrefix.${l}`]) return local[`routePrefix.${l}`];
    const d = error?.details as { locale?: string } | undefined;
    return error && d?.locale === l && error.messageKey.startsWith("errors.content_type.prefix") ? described?.message : null;
  };

  const submit = async () => {
    setTried(true);
    if (Object.keys(local).length || Object.keys(problems).length) return;
    setPending(true);
    setError(null);
    try {
      const labels = { name: Object.fromEntries(Object.entries(name).filter(([, v]) => v.trim())), namePlural: Object.fromEntries(Object.entries(plural).filter(([, v]) => v.trim())) };
      const routePrefix = hasRoutes ? Object.fromEntries(Object.entries(prefixes).filter(([, v]) => v)) : {};
      const created = await bff<ContentTypeDetail>(`${apiBase}/content/types`, { method: "POST", body: { key, kind, labels, routePrefix, fields: fields.map(cleanField) } });
      invalidateContentTypes();
      router.push(`${basePath}/content/${encodeURIComponent(created.key)}`);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err.toInfo());
      setPending(false);
    }
  };

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onClose()}
      title={t("content.types.newCustomTitle")}
      description={t("content.types.newCustomDescription")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" loading={pending} onClick={() => void submit()}>
            {t("content.types.create")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {described && !Object.keys(described.fields).length && !(error?.details as { locale?: string } | undefined)?.locale ? <InlineAlert tone="danger" live="alert">{described.message}</InlineAlert> : null}
        {described && Object.keys(described.fields).length ? <ErrorSummary message={described.message} items={Object.entries(described.fields).map(([p, m]) => ({ fieldId: "ct-key", message: m, label: p }))} /> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="ct-name-tr" label={t("content.types.nameTr")} required error={tried ? local["labels.name"] : null}>
            <Input value={name.tr} maxLength={120} onChange={(e) => setName({ ...name, tr: e.target.value })} />
          </Field>
          <Field label={t("content.types.nameEn")} optional>
            <Input value={name.en} maxLength={120} onChange={(e) => setName({ ...name, en: e.target.value })} />
          </Field>
          <Field id="ct-plural-tr" label={t("content.types.pluralTr")} required error={tried ? local["labels.namePlural"] : null}>
            <Input value={plural.tr} maxLength={120} onChange={(e) => setPlural({ ...plural, tr: e.target.value })} />
          </Field>
          <Field label={t("content.types.pluralEn")} optional>
            <Input value={plural.en} maxLength={120} onChange={(e) => setPlural({ ...plural, en: e.target.value })} />
          </Field>
          <Field id="ct-key" label={t("content.types.key")} description={t("content.types.keyHint")} required error={(tried ? local.key : null) ?? described?.fields.key ?? null}>
            <Input value={key} maxLength={48} className="font-mono" onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} />
          </Field>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-base font-medium text-fg">{t("content.types.kind")}</legend>
          <RadioGroup
            value={kind}
            onValueChange={(v) => setKind(v as ContentTypeKind)}
            aria-label={t("content.types.kind")}
            options={(["collection", "singleton", "taxonomy"] as const).map((k) => ({ value: k, label: t(`content.kinds.${k}`), description: t(`content.kindHints.${k}`) }))}
          />
        </fieldset>
        {kind !== "taxonomy" ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-base font-medium text-fg">{t("content.types.routes")}</legend>
            <RadioGroup
              value={routable ? "yes" : "no"}
              onValueChange={(v) => setRoutable(v === "yes")}
              aria-label={t("content.types.routes")}
              options={[
                { value: "yes", label: t("content.types.routesYes"), description: t("content.types.routesYesHint") },
                { value: "no", label: t("content.types.routesNo"), description: t("content.types.routesNoHint") },
              ]}
            />
            {routable ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {locales.map((l) => (
                  <Field key={l} label={t("content.types.prefixIn", { language: localeLabel(l, locale) })} required={l === store.defaultLocale} error={prefixError(l) ?? null}>
                    <Input value={prefixes[l] ?? ""} prefix="/" maxLength={100} className="font-mono" onChange={(e) => setPrefixes({ ...prefixes, [l]: e.target.value.toLowerCase() })} />
                  </Field>
                ))}
              </div>
            ) : null}
          </fieldset>
        ) : null}
        <div className="flex flex-col gap-2">
          <span className="text-base font-medium text-fg">{t("content.types.fields")}</span>
          <p className="text-sm text-fg-muted">{t("content.types.fieldsHint")}</p>
          <CustomFieldsEditor fields={fields} onChange={setFields} savedKeys={new Set()} problems={tried ? problems : {}} apiIssue={apiField} disabled={pending} />
          {fields.length === 0 ? (
            <Button size="sm" variant="ghost" className="self-start" onClick={() => setFields([{ ...newField("richDoc"), key: "body", label: { tr: "İçerik", en: "Body" }, localized: true }])}>
              {t("content.types.addBodyField")}
            </Button>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
