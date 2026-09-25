"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { AssetField } from "@/components/media/asset-picker";
import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "@/components/ui/button";
import { DateTimeInput } from "@/components/ui/date-time-input";
import { Field } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { fieldIssue, REQUIRED } from "@/lib/storefront/issues";
import { classifyField, deref, humanizeKey, objectDefaults, type FieldSpec } from "@/lib/storefront/schema";
import { moveItem } from "@/lib/storefront/sections";
import type { JsonSchema } from "@/lib/storefront/types";
import { useEditorContext } from "./editor-context";
import { LocalizedRichDocField, LocalizedRichHtmlField, LocalizedTextField } from "./localized-fields";
import { CollectionField, ColorSchemeField, HrefField, LinkField, MenuField, MenusField, ProductsField } from "./reference-fields";

type Props = Record<string, unknown>;
type ChangeOpts = { immediate?: boolean };

/**
 * Fields that only matter for some values of a sibling (the collection of a product showcase is
 * used only with the "collection" source). Keyed by the container: the section type for top-level
 * props, the prop name for nested objects.
 */
const CONDITIONS: Record<string, Record<string, (v: Props) => boolean>> = {
  "product-grid": { collectionId: (p) => p.source === "collection", tag: (p) => p.source === "tag", productIds: (p) => p.source === "manual" },
  video: { assetId: (p) => p.source === "asset", posterAssetId: (p) => p.source === "asset", url: (p) => p.source !== "asset" },
  countdown: { expiredMessage: (p) => p.expiredBehavior === "show_message" },
  frequency: { days: (p) => p.type === "every_n_days" },
};

/** Localized label of a prop: the interface catalog first, else a readable form of the key. */
export function usePropLabel() {
  const { t } = useI18n();
  return (key: string) => t.maybe(`sections.props.${key}`) ?? humanizeKey(key);
}

export function useValueLabel() {
  const { t } = useI18n();
  return (key: string, value: string) => t.maybe(`sections.values.${key}.${value}`) ?? t.maybe(`sections.values.common.${value}`) ?? humanizeKey(value);
}

/** Localizes an issue message (API error key, zod text or a local "required"). */
export function useIssueMessage() {
  const { t, catalog } = useI18n();
  return (message: string) => {
    if (message === REQUIRED) return t("ui.field.requiredValue");
    if (message.startsWith("errors.")) {
      const [key = message, arg] = message.split(":");
      if (key === "errors.section.required_missing") return t("editor.issues.requiredMissing", { name: arg ?? "" });
      return catalog.apiErrors[key] ?? t("ui.field.invalidValue");
    }
    if (/received undefined|required/i.test(message)) return t("ui.field.requiredValue");
    let m: RegExpExecArray | null;
    if ((m = /too big: expected string to have <=?(\d+)/i.exec(message))) return t("ui.field.tooLong", { max: m[1] ?? "" });
    if ((m = /too small: expected (?:number|int) to be >=?(-?\d+)/i.exec(message))) return t("ui.field.tooSmall", { min: m[1] ?? "" });
    if ((m = /too big: expected (?:number|int) to be <=?(-?\d+)/i.exec(message))) return t("ui.field.tooLarge", { max: m[1] ?? "" });
    if (/invalid option/i.test(message)) return t("ui.field.invalidOption");
    if (/invalid url|invalid uri/i.test(message)) return t("editor.issues.invalidUrl");
    return t("ui.field.invalidValue");
  };
}

export interface SchemaFieldsProps {
  schema: JsonSchema;
  root: JsonSchema;
  value: Props;
  onChange: (next: Props, opts?: ChangeOpts) => void;
  /** Issue path of the instance ("section:<id>" or "section:<id>/block:<id>"). */
  issueBase: string;
  /** Path of these fields inside the instance ("props" or "props.trigger"). */
  fieldPrefix: string;
  /** Container key for conditional fields (section type or nested prop name). */
  container?: string;
  /** Leave out these keys (e.g. a union's discriminator). */
  omit?: readonly string[];
  /** Render nothing (instead of a notice) when there is no field to show. */
  quietWhenEmpty?: boolean;
}

/** Form fields generated from a JSON Schema object. */
export function SchemaFields({ schema, root, value, onChange, issueBase, fieldPrefix, container, omit, quietWhenEmpty }: SchemaFieldsProps) {
  const { t } = useI18n();
  const labelOf = usePropLabel();
  const { issues } = useEditorContext();
  const issueText = useIssueMessage();
  const s = deref(schema, root);
  const conditions = container ? CONDITIONS[container] : undefined;
  const entries = Object.entries(s.properties ?? {}).filter(([k]) => !omit?.includes(k) && (conditions?.[k]?.(value) ?? true));
  const fields = entries.map(([key, prop]) => ({ key, spec: classifyField(key, prop, root), prop }));
  const visible = fields.filter((f) => f.spec.kind !== "hidden");
  if (visible.length === 0) return quietWhenEmpty ? null : <p className="text-base text-fg-muted">{t("editor.props.noFields")}</p>;
  return (
    <div className="flex flex-col gap-4">
      {visible.map(({ key, spec, prop }) => {
        const issue = fieldIssue(issues, issueBase, `${fieldPrefix}.${key}`);
        return (
          <FieldRenderer
            key={key}
            name={key}
            label={labelOf(key)}
            spec={spec}
            schema={prop}
            root={root}
            value={value[key]}
            required={s.required?.includes(key) ?? false}
            error={issue ? issueText(issue.message) : undefined}
            issueBase={issueBase}
            fieldPath={`${fieldPrefix}.${key}`}
            onChange={(v, opts) => onChange({ ...value, [key]: v }, opts)}
          />
        );
      })}
    </div>
  );
}

interface FieldRendererProps {
  name: string;
  label: string;
  spec: FieldSpec;
  schema: JsonSchema;
  root: JsonSchema;
  value: unknown;
  required: boolean;
  error: string | undefined;
  issueBase: string;
  fieldPath: string;
  onChange: (value: unknown, opts?: ChangeOpts) => void;
}

function FieldRenderer({ name, label, spec, root, value, required, error, issueBase, fieldPath, onChange }: FieldRendererProps) {
  const { t } = useI18n();
  const { canEdit } = useEditorContext();
  const valueLabel = useValueLabel();
  const hint = t.maybe(`sections.hints.${name}`);
  const immediate = { immediate: true };

  switch (spec.kind) {
    case "localizedText":
      return <LocalizedTextField label={label} value={value} onChange={onChange} error={error} description={hint} required={required} maxLength={spec.maxLength} multiline={spec.multiline} />;
    case "localizedRichHtml":
      return <LocalizedRichHtmlField label={label} value={value} onChange={onChange} error={error} description={hint} required={required} />;
    case "localizedRichDoc":
      return <LocalizedRichDocField label={label} value={value} onChange={onChange} error={error} description={hint} required={required} />;
    case "asset":
      return <AssetField label={label} value={typeof value === "string" ? value : null} onChange={(v) => onChange(v, immediate)} clearable={spec.nullable} disabled={!canEdit} error={error ?? null} {...(hint ? { description: hint } : {})} />;
    case "link":
      return <LinkField label={label} value={value} nullable={spec.nullable} labelMaxLength={spec.labelMaxLength} error={error} onChange={(v, im) => onChange(v, im ? immediate : undefined)} />;
    case "href":
      return <HrefField label={label} value={value} nullable={spec.nullable} error={error} description={hint} onChange={onChange} />;
    case "url":
      return (
        <Field label={label} error={error} optional={spec.nullable} description={hint}>
          <Input type="url" inputMode="url" value={typeof value === "string" ? value : ""} disabled={!canEdit} placeholder="https://" onChange={(e) => onChange(e.target.value === "" && spec.nullable ? null : e.target.value)} />
        </Field>
      );
    case "colorScheme":
      return <ColorSchemeField label={label} value={value} options={spec.options} onChange={(v) => onChange(v, immediate)} error={error} />;
    case "enum":
      return (
        <Field label={label} error={error} description={hint}>
          <Select
            options={[...(spec.nullable ? [{ value: "__none", label: t("editor.fields.none") }] : []), ...spec.options.map((o) => ({ value: o, label: valueLabel(name, o) }))]}
            value={typeof value === "string" ? value : spec.nullable ? "__none" : undefined}
            onValueChange={(v) => onChange(v === "__none" ? null : v, immediate)}
            disabled={!canEdit}
          />
        </Field>
      );
    case "boolean":
      return <Switch label={label} {...(hint ? { description: hint } : {})} checked={Boolean(value)} disabled={!canEdit} onCheckedChange={(c) => onChange(c, immediate)} />;
    case "number":
      return <NumberField label={label} spec={spec} value={value} onChange={onChange} error={error} hint={hint} name={name} />;
    case "text":
      return (
        <Field label={label} error={error} optional={spec.nullable} description={hint}>
          <Input
            value={typeof value === "string" ? value : ""}
            disabled={!canEdit}
            {...(spec.maxLength ? { maxLength: spec.maxLength, showCount: spec.maxLength <= 200 } : {})}
            onChange={(e) => onChange(e.target.value === "" && spec.nullable ? null : e.target.value)}
          />
        </Field>
      );
    case "datetime":
      return (
        <Field label={label} error={error} required={required} description={hint}>
          <DateTimeInput value={typeof value === "string" ? value : null} disabled={!canEdit} onChange={(iso) => onChange(iso ?? (spec.nullable ? null : undefined), immediate)} />
        </Field>
      );
    case "collection":
      return <CollectionField label={label} value={value} nullable={spec.nullable} error={error} description={hint} onChange={(v) => onChange(v, immediate)} />;
    case "products":
      return <ProductsField label={label} value={value} maxItems={spec.maxItems} error={error} onChange={(v) => onChange(v, immediate)} />;
    case "menu":
      return <MenuField label={label} value={value} error={error} onChange={(v) => onChange(v, immediate)} />;
    case "menus":
      return <MenusField label={label} value={value} maxItems={spec.maxItems} error={error} onChange={(v) => onChange(v, immediate)} />;
    case "stringList":
      return <StringListField label={label} value={value} maxItems={spec.maxItems} error={error} hint={hint} onChange={onChange} />;
    case "objectList":
      return <ObjectListField name={name} label={label} item={spec.item} root={root} maxItems={spec.maxItems} value={value} onChange={onChange} error={error} issueBase={issueBase} fieldPath={fieldPath} />;
    case "object":
      return (
        <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
          <legend className="px-1 text-base font-medium text-fg">{label}</legend>
          <SchemaFields
            schema={spec.schema}
            root={root}
            value={(value as Props) ?? {}}
            onChange={(v, o) => onChange(v, o)}
            issueBase={issueBase}
            fieldPrefix={fieldPath}
            container={name}
          />
        </fieldset>
      );
    case "union":
      return <UnionField name={name} label={label} spec={spec} root={root} value={value} onChange={onChange} issueBase={issueBase} fieldPath={fieldPath} />;
    case "hidden":
      return null;
    case "unsupported":
    default:
      return (
        <div className="flex flex-col gap-1">
          <span className="text-base font-medium text-fg">{label}</span>
          <p className="text-sm text-fg-muted">{t("editor.props.unsupported")}</p>
        </div>
      );
  }
}

const UNITS: Record<string, string> = {
  logoWidth: "px",
  overlayOpacity: "%",
  rotateSeconds: "sn",
  intervalSeconds: "sn",
  delaySeconds: "sn",
  seconds: "sn",
  percent: "%",
};

function NumberField({ label, name, spec, value, onChange, error, hint }: { label: string; name: string; spec: Extract<FieldSpec, { kind: "number" }>; value: unknown; onChange: (v: unknown) => void; error?: string | undefined; hint: string | null }) {
  const { t } = useI18n();
  const { canEdit } = useEditorContext();
  const [text, setText] = useState(typeof value === "number" ? String(value) : "");
  useEffect(() => {
    setText((prev) => (Number(prev) === value && prev !== "" ? prev : typeof value === "number" ? String(value) : ""));
  }, [value]);
  const n = Number(text.replace(",", "."));
  const outOfRange = text !== "" && (!Number.isFinite(n) || (spec.integer && !Number.isInteger(n)) || (spec.min !== null && n < spec.min) || (spec.max !== null && n > spec.max));
  const range = spec.min !== null && spec.max !== null ? t("editor.fields.range", { min: spec.min, max: spec.max }) : null;
  const unit = UNITS[name];
  return (
    <Field label={label} error={error ?? (outOfRange ? (range ?? t("ui.field.invalidValue")) : null)} description={[hint, range].filter(Boolean).join(" ") || null} optional={spec.nullable}>
      <Input
        type="number"
        inputMode={spec.integer ? "numeric" : "decimal"}
        value={text}
        disabled={!canEdit}
        {...(spec.min !== null ? { min: spec.min } : {})}
        {...(spec.max !== null ? { max: spec.max } : {})}
        step={spec.integer ? 1 : "any"}
        {...(unit ? { suffix: unit } : {})}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          if (raw === "") {
            if (spec.nullable) onChange(null);
            return;
          }
          const v = Number(raw.replace(",", "."));
          if (!Number.isFinite(v) || (spec.integer && !Number.isInteger(v))) return;
          if ((spec.min !== null && v < spec.min) || (spec.max !== null && v > spec.max)) return;
          onChange(v);
        }}
      />
    </Field>
  );
}

/** One value per line (route patterns, UTM values, tags). */
export function StringListField({ label, value, onChange, maxItems, error, hint }: { label: string; value: unknown; onChange: (v: string[]) => void; maxItems: number | null; error?: string | undefined; hint: string | null }) {
  const { t } = useI18n();
  const { canEdit } = useEditorContext();
  const list = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  const [text, setText] = useState(list.join("\n"));
  useEffect(() => {
    setText((prev) => (prev.split("\n").map((l) => l.trim()).filter(Boolean).join("\n") === list.join("\n") ? prev : list.join("\n")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.join("\n")]);
  return (
    <Field label={label} error={error} description={[hint, t("editor.fields.onePerLine"), maxItems ? t("editor.fields.maxLines", { max: maxItems }) : null].filter(Boolean).join(" ")}>
      <Textarea
        rows={3}
        value={text}
        disabled={!canEdit}
        onChange={(e) => {
          setText(e.target.value);
          const items = e.target.value
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
          onChange(maxItems ? items.slice(0, maxItems) : items);
        }}
      />
    </Field>
  );
}

function ObjectListField({
  name,
  label,
  item,
  root,
  maxItems,
  value,
  onChange,
  error,
  issueBase,
  fieldPath,
}: {
  name: string;
  label: string;
  item: JsonSchema;
  root: JsonSchema;
  maxItems: number | null;
  value: unknown;
  onChange: (v: unknown, opts?: ChangeOpts) => void;
  error?: string | undefined;
  issueBase: string;
  fieldPath: string;
}) {
  const { t } = useI18n();
  const { canEdit } = useEditorContext();
  const legendId = useId();
  const list = Array.isArray(value) ? (value as Props[]) : [];
  const full = maxItems !== null && list.length >= maxItems;
  return (
    <fieldset aria-labelledby={legendId} className="flex flex-col gap-2">
      <span id={legendId} className="text-base font-medium text-fg">
        {label}
      </span>
      {list.length === 0 ? <p className="text-sm text-fg-muted">{t("editor.fields.emptyList")}</p> : null}
      <ol className="flex flex-col gap-2">
        {list.map((entry, i) => (
          <li key={i} className="flex flex-col gap-3 rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-fg-muted">{t("editor.fields.itemNumber", { n: i + 1 })}</span>
              <div className="flex gap-0.5">
                <Button size="icon-sm" variant="ghost" aria-label={t("editor.tree.moveUp")} disabled={!canEdit || i === 0} onClick={() => onChange(moveItem(list, i, i - 1), { immediate: true })}>
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={t("editor.tree.moveDown")} disabled={!canEdit || i === list.length - 1} onClick={() => onChange(moveItem(list, i, i + 1), { immediate: true })}>
                  <ArrowDown aria-hidden="true" />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={t("editor.fields.removeItem", { n: i + 1 })} disabled={!canEdit} onClick={() => onChange(list.filter((_, j) => j !== i), { immediate: true })}>
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </div>
            <SchemaFields
              schema={item}
              root={root}
              value={entry}
              onChange={(v, o) => onChange(list.map((e, j) => (j === i ? v : e)), o)}
              issueBase={issueBase}
              fieldPrefix={`${fieldPath}.${i}`}
              container={name}
            />
          </li>
        ))}
      </ol>
      <Button size="sm" className="self-start" disabled={!canEdit || full} onClick={() => onChange([...list, objectDefaults(item, root)], { immediate: true })}>
        <Plus aria-hidden="true" />
        {t("editor.fields.addItem")}
      </Button>
      {full ? <p className="text-sm text-fg-muted">{t("editor.fields.listFull", { max: maxItems ?? 0 })}</p> : null}
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
    </fieldset>
  );
}

function UnionField({
  name,
  label,
  spec,
  root,
  value,
  onChange,
  issueBase,
  fieldPath,
}: {
  name: string;
  label: string;
  spec: Extract<FieldSpec, { kind: "union" }>;
  root: JsonSchema;
  value: unknown;
  onChange: (v: unknown, opts?: ChangeOpts) => void;
  issueBase: string;
  fieldPath: string;
}) {
  const { canEdit } = useEditorContext();
  const valueLabel = useValueLabel();
  const obj = (value && typeof value === "object" ? value : {}) as Props;
  const current = typeof obj[spec.discriminator] === "string" ? (obj[spec.discriminator] as string) : spec.variants[0]?.value;
  const variant = spec.variants.find((v) => v.value === current) ?? spec.variants[0];
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
      <legend className="px-1 text-base font-medium text-fg">{label}</legend>
      <Select
        aria-label={label}
        options={spec.variants.map((v) => ({ value: v.value, label: valueLabel(name, v.value) }))}
        value={current}
        disabled={!canEdit}
        onValueChange={(v) => {
          const next = spec.variants.find((x) => x.value === v);
          if (next) onChange({ ...objectDefaults(next.schema, root), [spec.discriminator]: v }, { immediate: true });
        }}
      />
      {variant ? (
        <SchemaFields schema={variant.schema} root={root} value={obj} onChange={(v, o) => onChange(v, o)} issueBase={issueBase} fieldPrefix={fieldPath} container={name} omit={[spec.discriminator]} quietWhenEmpty />
      ) : null}
    </fieldset>
  );
}
