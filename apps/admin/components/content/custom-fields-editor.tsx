"use client";

import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { labelText } from "@/lib/content/fields";
import {
  CUSTOM_FIELD_TYPES,
  NON_LOCALIZABLE_FIELD_TYPES,
  NUMBER_UNITS,
  REFERENCE_TARGET_KINDS,
  RICH_BLOCK_TYPES,
  type ContentTypeSummary,
  type FieldDef,
  type FieldType,
  type RequiredMode,
} from "@/lib/content/types";
import { loadContentTypes } from "./record-pickers";

/**
 * Editor of a type's own fields (a custom type's fields, or the extra fields a site adds to a
 * built-in type). Offers the safe field set only: there is no raw HTML, JSON, JSON-LD, iframe or
 * script field to choose. Once saved, a field keeps its key, type and localization (entries may
 * hold data for it); labels, help, requirement and the other settings stay editable.
 */

const CONTAINER: readonly FieldType[] = ["group", "repeater"];

/** Keys the API reserves (entry columns and the GEO fieldset). */
export const RESERVED_KEYS = new Set([
  "id", "type", "typeId", "slug", "slugs", "seo", "status", "locale", "locales", "parent", "parentId", "position", "createdAt", "updatedAt", "publishedAt",
  "summary", "keyFacts", "faq", "sources", "authors", "reviewedBy", "lastReviewedAt", "significantUpdate",
]);

const KEY_PATTERN = /^[a-z][a-zA-Z0-9]{0,47}$/;
const OPTION_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** A new field with the defaults the API fills in. */
export function newField(type: FieldType = "text"): FieldDef {
  return { key: "", type, label: {}, localized: !NON_LOCALIZABLE_FIELD_TYPES.includes(type) && ["text", "textarea", "richDoc"].includes(type), required: false, ui: {}, visibility: "public", searchable: false, listColumn: false, filterable: false, significant: false, validation: defaultValidation(type) };
}

function defaultValidation(type: FieldType): FieldDef["validation"] {
  switch (type) {
    case "text":
      return { maxLength: 200 };
    case "textarea":
      return { maxLength: 2000 };
    case "select":
    case "multiSelect":
      return { options: [{ value: "", label: {} }] };
    case "reference":
      return { to: "entry" };
    case "multiReference":
      return { to: "entry", maxItems: 20 };
    case "asset":
      return { kinds: ["image"] };
    case "gallery":
      return { maxItems: 30 };
    case "keyFacts":
      return { maxItems: 12 };
    case "sources":
      return { maxItems: 20 };
    case "repeater":
      return { fields: [newField("text")], maxItems: 20 };
    case "group":
      return { fields: [newField("text")] };
    default:
      return {};
  }
}

/** Local problems of a field list (the API checks the same and more), as path → message key. */
export function fieldProblems(fields: readonly FieldDef[], prefix = "fields"): Record<string, string> {
  const out: Record<string, string> = {};
  const seen = new Set<string>();
  fields.forEach((f, i) => {
    const p = `${prefix}.${i}`;
    if (!KEY_PATTERN.test(f.key)) out[`${p}.key`] = "content.fieldsEditor.keyInvalid";
    else if (seen.has(f.key)) out[`${p}.key`] = "content.fieldsEditor.keyDuplicate";
    else if (prefix === "fields" && RESERVED_KEYS.has(f.key)) out[`${p}.key`] = "content.fieldsEditor.keyReserved";
    seen.add(f.key);
    if (!Object.values(f.label).some((v) => v?.trim())) out[`${p}.label`] = "content.fieldsEditor.labelRequired";
    if (f.type === "select" || f.type === "multiSelect") {
      const values = (f.validation.options ?? []).map((o) => o.value);
      if (!values.length || values.some((v) => !OPTION_PATTERN.test(v))) out[`${p}.validation.options`] = "content.fieldsEditor.optionInvalid";
      else if (new Set(values).size !== values.length) out[`${p}.validation.options`] = "content.fieldsEditor.optionDuplicate";
    }
    if (CONTAINER.includes(f.type)) Object.assign(out, fieldProblems(f.validation.fields ?? [], `${p}.validation.fields`));
  });
  return out;
}

/** The field as the API takes it (drops settings of other field types). */
export function cleanField(f: FieldDef): FieldDef {
  const label = Object.fromEntries(Object.entries(f.label).filter(([, v]) => v?.trim()));
  const help = Object.fromEntries(Object.entries(f.help ?? {}).filter(([, v]) => v?.trim()));
  const v = { ...f.validation };
  if (v.fields) v.fields = v.fields.map(cleanField);
  if (v.options) v.options = v.options.map((o) => ({ value: o.value, label: Object.fromEntries(Object.entries(o.label).filter(([, x]) => x?.trim())) }));
  if (v.typeKeys && !v.typeKeys.length) delete v.typeKeys;
  return {
    ...f,
    label,
    ...(Object.keys(help).length ? { help } : { help: undefined }),
    localized: NON_LOCALIZABLE_FIELD_TYPES.includes(f.type) ? false : f.localized,
    validation: v,
  } as FieldDef;
}

function FieldRow({
  field,
  index,
  count,
  locked,
  onChange,
  onRemove,
  onMove,
  problems,
  apiIssue,
  prefix,
  nested,
  types,
  disabled,
}: {
  field: FieldDef;
  index: number;
  count: number;
  /** Saved fields keep key, type and localization. */
  locked: boolean;
  onChange: (f: FieldDef) => void;
  onRemove: () => void;
  onMove: (to: number) => void;
  problems: Record<string, string>;
  apiIssue: (path: string) => string | undefined;
  prefix: string;
  nested: boolean;
  types: ContentTypeSummary[];
  disabled: boolean;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(!field.key);
  const p = `${prefix}.${index}`;
  const err = (path: string) => (problems[`${p}.${path}`] ? t(problems[`${p}.${path}`] as "content.fieldsEditor.keyInvalid") : apiIssue(`${p}.${path}`)) ?? null;
  const rowError = Object.keys(problems).some((k) => k.startsWith(`${p}.`)) || Boolean(apiIssue(p));
  const set = (patch: Partial<FieldDef>) => onChange({ ...field, ...patch });
  const setV = (patch: Partial<FieldDef["validation"]>) => onChange({ ...field, validation: { ...field.validation, ...patch } });
  const typeOptions = CUSTOM_FIELD_TYPES.filter((ty) => !nested || !CONTAINER.includes(ty)).map((ty) => ({ value: ty, label: t(`content.fieldTypes.${ty}`) }));
  const vl = field.validation;
  const name = labelText(field.label, locale) || field.key || t("content.fieldsEditor.newField");

  return (
    <li className={cn("rounded-md border", rowError ? "border-danger" : "border-border")}>
      <div className="flex items-center gap-2 p-2">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-2 text-start">
          {open ? <ChevronDown aria-hidden="true" className="size-4 shrink-0" /> : <ChevronRight aria-hidden="true" className="size-4 shrink-0 rtl:-scale-x-100" />}
          <span className="truncate font-medium text-fg">{name}</span>
          <span className="shrink-0 font-mono text-xs text-fg-muted">{field.key}</span>
          <span className="shrink-0 rounded-sm bg-surface-muted px-1.5 text-xs text-fg-muted">{t(`content.fieldTypes.${field.type as (typeof CUSTOM_FIELD_TYPES)[number]}`)}</span>
          {field.required ? <span className="shrink-0 text-xs text-fg-subtle">{t(`content.fieldsEditor.requiredModes.${field.required}`)}</span> : null}
        </button>
        <span className="flex shrink-0 gap-0.5">
          <Button size="icon-sm" variant="ghost" disabled={disabled || index === 0} aria-label={t("content.common.moveUpItem", { name })} onClick={() => onMove(index - 1)}>
            <ChevronDown aria-hidden="true" className="rotate-180" />
          </Button>
          <Button size="icon-sm" variant="ghost" disabled={disabled || index === count - 1} aria-label={t("content.common.moveDownItem", { name })} onClick={() => onMove(index + 1)}>
            <ChevronDown aria-hidden="true" />
          </Button>
          <Button size="icon-sm" variant="ghost" disabled={disabled} aria-label={t("content.common.removeItem", { name })} onClick={onRemove}>
            <Trash2 aria-hidden="true" />
          </Button>
        </span>
      </div>
      {open ? (
        <div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2">
          <Field label={t("content.fieldsEditor.labelTr")} required error={err("label")}>
            <Input value={field.label.tr ?? ""} maxLength={120} disabled={disabled} onChange={(e) => set({ label: { ...field.label, tr: e.target.value } })} />
          </Field>
          <Field label={t("content.fieldsEditor.labelEn")} optional>
            <Input value={field.label.en ?? ""} maxLength={120} disabled={disabled} onChange={(e) => set({ label: { ...field.label, en: e.target.value } })} />
          </Field>
          <Field label={t("content.fieldsEditor.key")} description={locked ? t("content.fieldsEditor.keyLocked") : t("content.fieldsEditor.keyHint")} required error={err("key")}>
            <Input value={field.key} maxLength={48} className="font-mono" disabled={disabled || locked} onChange={(e) => set({ key: e.target.value.replace(/[^a-zA-Z0-9]/g, "") })} />
          </Field>
          <Field label={t("content.fieldsEditor.type")} description={locked ? t("content.fieldsEditor.typeLocked") : null} error={err("type")}>
            <Select
              value={field.type}
              disabled={disabled || locked}
              onValueChange={(ty) => onChange({ ...newField(ty as FieldType), key: field.key, label: field.label, ...(field.help ? { help: field.help } : {}), required: field.required, visibility: field.visibility })}
              options={typeOptions}
            />
          </Field>
          <Field label={t("content.fieldsEditor.helpTr")} optional className="sm:col-span-2">
            <Input value={field.help?.tr ?? ""} maxLength={500} disabled={disabled} onChange={(e) => set({ help: { ...(field.help ?? {}), tr: e.target.value } })} />
          </Field>
          <Field label={t("content.fieldsEditor.required")}>
            <Select
              value={String(field.required)}
              disabled={disabled}
              onValueChange={(v) => set({ required: (v === "false" ? false : v) as RequiredMode })}
              options={(["false", "publish", "always"] as const).map((m) => ({ value: m, label: t(`content.fieldsEditor.requiredModes.${m}`) }))}
            />
          </Field>
          <Field label={t("content.fieldsEditor.visibility")} description={t("content.fieldsEditor.visibilityHint")}>
            <Select value={field.visibility} disabled={disabled} onValueChange={(v) => set({ visibility: v as FieldDef["visibility"] })} options={(["public", "internal"] as const).map((m) => ({ value: m, label: t(`content.fieldsEditor.visibilities.${m}`) }))} />
          </Field>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Checkbox
              checked={field.localized}
              disabled={disabled || locked || NON_LOCALIZABLE_FIELD_TYPES.includes(field.type)}
              onCheckedChange={(c) => set({ localized: c })}
              label={t("content.fieldsEditor.localized")}
              description={locked ? t("content.fieldsEditor.localizedLocked") : NON_LOCALIZABLE_FIELD_TYPES.includes(field.type) ? t("content.fieldsEditor.notLocalizable") : t("content.fieldsEditor.localizedHint")}
            />
            {!nested ? <Checkbox checked={field.listColumn} disabled={disabled} onCheckedChange={(c) => set({ listColumn: c })} label={t("content.fieldsEditor.listColumn")} /> : null}
            <Checkbox checked={field.searchable} disabled={disabled} onCheckedChange={(c) => set({ searchable: c })} label={t("content.fieldsEditor.searchable")} />
            <Checkbox checked={field.significant} disabled={disabled} onCheckedChange={(c) => set({ significant: c })} label={t("content.fieldsEditor.significant")} description={t("content.fieldsEditor.significantHint")} />
          </div>

          {field.type === "text" || field.type === "textarea" ? (
            <Field label={t("content.fieldsEditor.maxLength")} error={err("validation.maxLength")}>
              <Input type="number" min={1} max={field.type === "text" ? 1000 : 10000} value={String(vl.maxLength ?? "")} disabled={disabled} onChange={(e) => setV({ maxLength: e.target.value ? Number(e.target.value) : undefined })} />
            </Field>
          ) : null}
          {field.type === "number" ? (
            <>
              <Field label={t("content.fieldsEditor.unit")} optional>
                <Select value={vl.unit ?? "__none"} disabled={disabled} onValueChange={(u) => setV({ unit: u === "__none" ? undefined : (u as FieldDef["validation"]["unit"]) })} options={[{ value: "__none", label: t("content.fields.noneSelected") }, ...NUMBER_UNITS.map((u) => ({ value: u, label: t(`content.units.${u}`) }))]} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t("content.fieldsEditor.min")} optional error={err("validation")}>
                  <Input type="number" value={typeof vl.min === "number" ? String(vl.min) : ""} disabled={disabled} onChange={(e) => setV({ min: e.target.value === "" ? undefined : Number(e.target.value) })} />
                </Field>
                <Field label={t("content.fieldsEditor.max")} optional>
                  <Input type="number" value={typeof vl.max === "number" ? String(vl.max) : ""} disabled={disabled} onChange={(e) => setV({ max: e.target.value === "" ? undefined : Number(e.target.value) })} />
                </Field>
              </div>
              <Checkbox checked={vl.integer === true} disabled={disabled} onCheckedChange={(c) => setV({ integer: c })} label={t("content.fieldsEditor.integer")} />
            </>
          ) : null}
          {field.type === "select" || field.type === "multiSelect" ? (
            <fieldset className="flex flex-col gap-2 sm:col-span-2">
              <legend className="mb-1 text-sm font-medium text-fg">{t("content.fieldsEditor.options")}</legend>
              {(vl.options ?? []).map((o, oi) => (
                <div key={oi} className="flex items-center gap-2">
                  <Input aria-label={t("content.fieldsEditor.optionValueN", { n: oi + 1 })} placeholder={t("content.fieldsEditor.optionValue")} value={o.value} className="w-40 font-mono" disabled={disabled} onChange={(e) => setV({ options: (vl.options ?? []).map((x, j) => (j === oi ? { ...x, value: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") } : x)) })} />
                  <Input aria-label={t("content.fieldsEditor.optionLabelN", { n: oi + 1 })} placeholder={t("content.fieldsEditor.optionLabel")} value={o.label.tr ?? ""} disabled={disabled} onChange={(e) => setV({ options: (vl.options ?? []).map((x, j) => (j === oi ? { ...x, label: { ...x.label, tr: e.target.value } } : x)) })} />
                  <Button size="icon-sm" variant="ghost" aria-label={t("content.common.removeItem", { name: o.value || String(oi + 1) })} disabled={disabled || (vl.options ?? []).length <= 1} onClick={() => setV({ options: (vl.options ?? []).filter((_, j) => j !== oi) })}>
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              ))}
              {err("validation.options") ? <p className="text-sm text-danger">{err("validation.options")}</p> : null}
              <Button size="sm" className="self-start" disabled={disabled || (vl.options ?? []).length >= 100} onClick={() => setV({ options: [...(vl.options ?? []), { value: "", label: {} }] })}>
                <Plus aria-hidden="true" />
                {t("content.fieldsEditor.addOption")}
              </Button>
            </fieldset>
          ) : null}
          {field.type === "reference" || field.type === "multiReference" ? (
            <>
              <Field label={t("content.fieldsEditor.referenceTo")}>
                <Select value={vl.to ?? "entry"} disabled={disabled} onValueChange={(to) => setV({ to: to as FieldDef["validation"]["to"], typeKeys: undefined })} options={REFERENCE_TARGET_KINDS.map((k) => ({ value: k, label: t(`content.fieldsEditor.targets.${k}`) }))} />
              </Field>
              {(vl.to ?? "entry") === "entry" ? (
                <fieldset className="flex flex-col gap-1.5">
                  <legend className="mb-1 text-sm font-medium text-fg">{t("content.fieldsEditor.typeKeys")}</legend>
                  {types.length === 0 ? <p className="text-sm text-fg-muted">{t("content.fieldsEditor.anyType")}</p> : null}
                  {types.map((ty) => (
                    <Checkbox
                      key={ty.key}
                      checked={(vl.typeKeys ?? []).includes(ty.key)}
                      disabled={disabled}
                      onCheckedChange={(c) => setV({ typeKeys: c ? [...(vl.typeKeys ?? []), ty.key] : (vl.typeKeys ?? []).filter((k) => k !== ty.key) })}
                      label={labelText(ty.labels.namePlural, locale, ty.key)}
                    />
                  ))}
                </fieldset>
              ) : null}
            </>
          ) : null}
          {field.type === "multiReference" || field.type === "gallery" || field.type === "repeater" || field.type === "keyFacts" || field.type === "sources" ? (
            <Field label={t("content.fieldsEditor.maxItems")} error={err("validation.maxItems")}>
              <Input type="number" min={1} max={100} value={String(vl.maxItems ?? "")} disabled={disabled} onChange={(e) => setV({ maxItems: e.target.value ? Number(e.target.value) : undefined })} />
            </Field>
          ) : null}
          {field.type === "asset" ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-sm font-medium text-fg">{t("content.fieldsEditor.assetKinds")}</legend>
              {(["image", "video", "document"] as const).map((k) => (
                <Checkbox
                  key={k}
                  checked={(vl.kinds ?? ["image"]).includes(k)}
                  disabled={disabled || ((vl.kinds ?? ["image"]).length === 1 && (vl.kinds ?? ["image"]).includes(k))}
                  onCheckedChange={(c) => setV({ kinds: c ? [...(vl.kinds ?? ["image"]), k] : (vl.kinds ?? ["image"]).filter((x) => x !== k) })}
                  label={t(`content.fieldsEditor.assetKindNames.${k}`)}
                />
              ))}
            </fieldset>
          ) : null}
          {field.type === "richDoc" ? (
            <fieldset className="flex flex-col gap-1.5 sm:col-span-2">
              <legend className="mb-1 text-sm font-medium text-fg">{t("content.fieldsEditor.richNodes")}</legend>
              <div className="grid gap-1 sm:grid-cols-3">
                {RICH_BLOCK_TYPES.map((n) => {
                  const nodes = vl.nodes ?? [...RICH_BLOCK_TYPES];
                  return (
                    <Checkbox
                      key={n}
                      checked={nodes.includes(n)}
                      disabled={disabled || n === "paragraph"}
                      onCheckedChange={(c) => {
                        const next = c ? [...nodes, n] : nodes.filter((x) => x !== n);
                        setV({ nodes: next.length === RICH_BLOCK_TYPES.length ? undefined : next });
                      }}
                      label={t(`content.richNodes.${n}`)}
                    />
                  );
                })}
              </div>
            </fieldset>
          ) : null}
          {CONTAINER.includes(field.type) ? (
            <div className="flex flex-col gap-2 sm:col-span-2">
              <span className="text-sm font-medium text-fg">{t("content.fieldsEditor.children")}</span>
              <FieldList fields={vl.fields ?? []} onChange={(fields) => setV({ fields })} savedKeys={new Set()} problems={problems} apiIssue={apiIssue} prefix={`${p}.validation.fields`} nested disabled={disabled} />
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function FieldList({
  fields,
  onChange,
  savedKeys,
  problems,
  apiIssue,
  prefix,
  nested,
  disabled,
}: {
  fields: FieldDef[];
  onChange: (fields: FieldDef[]) => void;
  savedKeys: ReadonlySet<string>;
  problems: Record<string, string>;
  apiIssue: (path: string) => string | undefined;
  prefix: string;
  nested: boolean;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const { apiBase } = useStore();
  const [types, setTypes] = useState<ContentTypeSummary[]>([]);
  useEffect(() => {
    loadContentTypes(apiBase).then(setTypes, () => setTypes([]));
  }, [apiBase]);
  const move = (from: number, to: number) => {
    const next = [...fields];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x!);
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2">
      {fields.length ? (
        <ol className="flex flex-col gap-2">
          {fields.map((f, i) => (
            <FieldRow
              key={i}
              field={f}
              index={i}
              count={fields.length}
              locked={savedKeys.has(f.key)}
              onChange={(next) => onChange(fields.map((x, j) => (j === i ? next : x)))}
              onRemove={() => onChange(fields.filter((_, j) => j !== i))}
              onMove={(to) => move(i, to)}
              problems={problems}
              apiIssue={apiIssue}
              prefix={prefix}
              nested={nested}
              types={types.filter((ty) => ty.status === "active")}
              disabled={disabled}
            />
          ))}
        </ol>
      ) : (
        <p className="text-sm text-fg-muted">{t("content.fieldsEditor.empty")}</p>
      )}
      <Button size="sm" className="self-start" disabled={disabled || fields.length >= (nested ? 30 : 60)} onClick={() => onChange([...fields, newField("text")])}>
        <Plus aria-hidden="true" />
        {t("content.fieldsEditor.add")}
      </Button>
    </div>
  );
}

/** The field list of a type; `savedKeys` are fields that already exist (their key, type and localization are fixed). */
export function CustomFieldsEditor(props: { fields: FieldDef[]; onChange: (fields: FieldDef[]) => void; savedKeys: ReadonlySet<string>; problems: Record<string, string>; apiIssue: (path: string) => string | undefined; disabled: boolean }) {
  return <FieldList {...props} prefix="fields" nested={false} />;
}
