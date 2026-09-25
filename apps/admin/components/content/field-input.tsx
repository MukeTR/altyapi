"use client";

import { ArrowDown, ArrowUp, ImagePlus, Plus, Trash2 } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { AssetField, AssetPickerDialog } from "@/components/media/asset-picker";
import { AssetImage } from "@/components/media/asset-image";
import { rememberAsset, useAsset } from "@/components/media/use-asset";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { AddressFields, emptyAddress } from "@/components/site/address-fields";
import { OpeningHoursEditor, emptyOpeningHours } from "@/components/site/opening-hours-editor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateTimeInput } from "@/components/ui/date-time-input";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { asRecord, labelText, withLocale } from "@/lib/content/fields";
import type { FieldDef } from "@/lib/content/types";
import { localeDir, localeHtmlLang, localeLabel } from "@/lib/locales";
import type { OpeningHours, SiteAddress } from "@/lib/site/types";
import { LinkTargetField, type LinkTarget } from "./link-target-field";
import { MultiRecordPicker, RecordPicker } from "./record-pickers";
import { embedIdFrom } from "./rich-blocks";
import { RichDocEditor } from "./rich-doc-editor";

/**
 * Schema-driven form control of one content field (FieldDef of packages/content): picks the
 * widget for the field type and edits the value in the stored shape. Localized fields edit the
 * value of the language being edited; everything else edits the value itself. Messages of the
 * API's validation issues are shown on the field they belong to (`issueAt(path)`).
 */

export interface FieldInputProps {
  field: FieldDef;
  /** Stored value (a { locale: value } map for localized fields). */
  value: unknown;
  onChange: (value: unknown) => void;
  /** Language being edited. */
  locale: string;
  /** Issue path of the value ("data.title", "data.authors.0.name"). */
  path: string;
  issueAt: (path: string) => string | undefined;
  disabled: boolean;
  /** Changes when the stored value is replaced from outside (undo, restore, reload). */
  resetKey: string;
}

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const nonEmpty = (o: Obj): Obj | null => {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "" && !(typeof v === "object" && !Array.isArray(v) && Object.keys(v as Obj).length === 0)));
  return Object.keys(out).length ? out : null;
};

function LocaleBadge({ locale }: { locale: string }) {
  const { locale: ui } = useI18n();
  return (
    <span className="rounded-sm border border-border px-1 text-xs font-medium uppercase text-fg-muted" title={localeLabel(locale, ui)}>
      <span aria-hidden="true">{locale}</span>
      <span className="sr-only">{localeLabel(locale, ui)}</span>
    </span>
  );
}

function useFieldText(field: FieldDef) {
  const { t, locale } = useI18n();
  const label = labelText(field.label, locale, field.key);
  const help = field.help ? labelText(field.help, locale) : "";
  const publishNote = field.required === "publish" ? t("content.fields.requiredToPublish") : "";
  const description = [help, publishNote].filter(Boolean).join(" ");
  const placeholder = field.ui?.placeholder ? labelText(field.ui.placeholder, locale) : undefined;
  return { label, description, placeholder };
}

/** A group of controls under a legend (for fields that are not one input). */
function FieldGroup({ label, description, error, required, badge, children }: { label: string; description?: string; error?: string | undefined; required?: boolean; badge?: ReactNode; children: ReactNode }) {
  const { t } = useI18n();
  const id = useId();
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={[description ? `${id}-d` : "", error ? `${id}-e` : ""].filter(Boolean).join(" ") || undefined} aria-invalid={error ? true : undefined}>
      <legend className="flex w-full items-baseline justify-between gap-2 text-base font-medium text-fg">
        <span>
          {label}
          {required ? <span className="ms-1 text-sm font-normal text-fg-subtle">({t("common.required")})</span> : null}
        </span>
        {badge}
      </legend>
      {description ? (
        <p id={`${id}-d`} className="-mt-1 text-sm text-fg-muted">
          {description}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={`${id}-e`} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Listed values (key facts, sources, gallery, repeater items) with move and remove buttons. */
function ItemControls({ index, count, onMove, onRemove, disabled, name }: { index: number; count: number; onMove: (to: number) => void; onRemove: () => void; disabled: boolean; name: string }) {
  const { t } = useI18n();
  return (
    <span className="flex shrink-0 gap-0.5">
      <Button size="icon-sm" variant="ghost" disabled={disabled || index === 0} aria-label={t("content.common.moveUpItem", { name })} onClick={() => onMove(index - 1)}>
        <ArrowUp aria-hidden="true" />
      </Button>
      <Button size="icon-sm" variant="ghost" disabled={disabled || index === count - 1} aria-label={t("content.common.moveDownItem", { name })} onClick={() => onMove(index + 1)}>
        <ArrowDown aria-hidden="true" />
      </Button>
      <Button size="icon-sm" variant="ghost" disabled={disabled} aria-label={t("content.common.removeItem", { name })} onClick={onRemove}>
        <Trash2 aria-hidden="true" />
      </Button>
    </span>
  );
}

function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x!);
  return next;
}

/** One image use: the asset, its alt text in the language being edited, and the decorative flag. */
function AssetUsageInput({ label, description, value, onChange, locale, path, issueAt, disabled, required, kinds }: { label: string; description: string; value: unknown; onChange: (v: unknown) => void; locale: string; path: string; issueAt: (p: string) => string | undefined; disabled: boolean; required: boolean; kinds: readonly string[] }) {
  const { t } = useI18n();
  const v = asRecord(value);
  const assetId = str(v.assetId) || null;
  const imagesOnly = kinds.every((k) => k === "image");
  const set = (patch: Obj) => onChange(nonEmpty({ ...v, ...patch }) && (patch.assetId ?? v.assetId) ? { ...v, ...patch } : null);
  return (
    <div className="flex flex-col gap-2">
      <AssetField label={label} description={description} value={assetId} disabled={disabled} error={issueAt(`${path}.assetId`) ?? (issueAt(path) && !issueAt(`${path}.alt`) ? issueAt(path) : null)} onChange={(id) => (id ? set({ assetId: id }) : onChange(null))} />
      {assetId && imagesOnly ? (
        <div className="ms-2 flex flex-col gap-2 border-s border-border ps-3">
          <Checkbox checked={v.decorative === true} disabled={disabled} onCheckedChange={(c) => set({ decorative: c ? true : undefined })} label={t("content.fields.decorative")} description={t("content.fields.decorativeHint")} />
          {v.decorative !== true ? (
            <Field label={t("content.fields.alt")} description={t("content.fields.altHint")} error={issueAt(`${path}.alt`) ?? null} labelAside={<LocaleBadge locale={locale} />} required={required}>
              <Input
                value={str(asRecord(v.alt)[locale])}
                maxLength={300}
                disabled={disabled}
                lang={localeHtmlLang(locale)}
                dir={localeDir(locale)}
                onChange={(e) => set({ alt: withLocale(v.alt, locale, e.target.value) ?? undefined })}
              />
            </Field>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function GalleryItem({ item, index, count, locale, disabled, onChange, onMove, onRemove, error }: { item: Obj; index: number; count: number; locale: string; disabled: boolean; onChange: (v: Obj) => void; onMove: (to: number) => void; onRemove: () => void; error: string | undefined }) {
  const { t } = useI18n();
  const state = useAsset(str(item.assetId));
  return (
    <li className={cn("flex items-start gap-3 rounded-md border p-2", error ? "border-danger" : "border-border")}>
      <div className="size-16 shrink-0 overflow-hidden rounded-md border border-border">
        {state.status === "ready" ? <AssetImage asset={state.asset} alt="" className="size-full" /> : <Skeleton className="size-full rounded-none" />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Checkbox checked={item.decorative === true} disabled={disabled} onCheckedChange={(c) => onChange({ ...item, decorative: c ? true : undefined })} label={t("content.fields.decorative")} />
        {item.decorative !== true ? (
          <Input
            aria-label={t("content.fields.altN", { n: index + 1, locale: locale.toUpperCase() })}
            placeholder={t("content.fields.alt")}
            value={str(asRecord(item.alt)[locale])}
            maxLength={300}
            disabled={disabled}
            onChange={(e) => onChange({ ...item, alt: withLocale(item.alt, locale, e.target.value) ?? undefined })}
          />
        ) : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>
      <ItemControls index={index} count={count} onMove={onMove} onRemove={onRemove} disabled={disabled} name={t("content.fields.imageN", { n: index + 1 })} />
    </li>
  );
}

function GalleryInput({ label, description, value, onChange, locale, path, issueAt, disabled, maxItems }: { label: string; description: string; value: unknown; onChange: (v: unknown) => void; locale: string; path: string; issueAt: (p: string) => string | undefined; disabled: boolean; maxItems: number }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const items = arr(value) as Obj[];
  const set = (next: Obj[]) => onChange(next.length ? next : null);
  return (
    <FieldGroup label={label} description={description} error={issueAt(path) && !items.some((_, i) => issueAt(`${path}.${i}`)) ? issueAt(path) : undefined}>
      {items.length ? (
        <ul className="flex flex-col gap-2">
          {items.map((item, i) => (
            <GalleryItem
              key={`${str(item.assetId)}-${i}`}
              item={item}
              index={i}
              count={items.length}
              locale={locale}
              disabled={disabled}
              error={issueAt(`${path}.${i}`)}
              onChange={(v) => set(items.map((x, j) => (j === i ? v : x)))}
              onMove={(to) => set(moved(items, i, to))}
              onRemove={() => set(items.filter((_, j) => j !== i))}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-muted">{t("content.fields.galleryEmpty")}</p>
      )}
      <Button size="sm" className="self-start" disabled={disabled || items.length >= maxItems} onClick={() => setOpen(true)}>
        <ImagePlus aria-hidden="true" />
        {t("content.fields.galleryAdd")}
      </Button>
      {open ? (
        <AssetPickerDialog
          open={open}
          onOpenChange={setOpen}
          selectedId={null}
          onSelect={(asset) => {
            rememberAsset(asset);
            set([...items, { assetId: asset.id }]);
            setOpen(false);
          }}
        />
      ) : null}
    </FieldGroup>
  );
}

function KeyFactsInput({ value, onChange, path, issueAt, disabled, maxItems }: { value: unknown; onChange: (v: unknown) => void; path: string; issueAt: (p: string) => string | undefined; disabled: boolean; maxItems: number }) {
  const { t } = useI18n();
  const items = arr(value) as Obj[];
  const set = (next: Obj[]) => onChange(next.length ? next : null);
  return (
    <div className="flex flex-col gap-2">
      {items.length ? (
        <ul className="flex flex-col gap-2">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <Input aria-label={t("content.keyFacts.labelN", { n: i + 1 })} placeholder={t("content.keyFacts.label")} value={str(item.label)} maxLength={80} disabled={disabled} aria-invalid={issueAt(`${path}.${i}.label`) ? true : undefined} onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <Input aria-label={t("content.keyFacts.valueN", { n: i + 1 })} placeholder={t("content.keyFacts.value")} value={str(item.value)} maxLength={300} disabled={disabled} aria-invalid={issueAt(`${path}.${i}.value`) ? true : undefined} onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                {issueAt(`${path}.${i}`) ? <p className="text-sm text-danger sm:col-span-2">{issueAt(`${path}.${i}`)}</p> : null}
              </div>
              <ItemControls index={i} count={items.length} disabled={disabled} name={str(item.label) || t("content.keyFacts.factN", { n: i + 1 })} onMove={(to) => set(moved(items, i, to))} onRemove={() => set(items.filter((_, j) => j !== i))} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-muted">{t("content.keyFacts.empty")}</p>
      )}
      <Button size="sm" className="self-start" disabled={disabled || items.length >= maxItems} onClick={() => set([...items, { label: "", value: "" }])}>
        <Plus aria-hidden="true" />
        {t("content.keyFacts.add")}
      </Button>
    </div>
  );
}

function SourcesInput({ value, onChange, path, issueAt, disabled, maxItems }: { value: unknown; onChange: (v: unknown) => void; path: string; issueAt: (p: string) => string | undefined; disabled: boolean; maxItems: number }) {
  const { t } = useI18n();
  const items = arr(value) as Obj[];
  const set = (next: Obj[]) => onChange(next.length ? next : null);
  const setItem = (i: number, patch: Obj) => set(items.map((x, j) => (j === i ? (nonEmpty({ ...x, ...patch }) ?? {}) : x)));
  return (
    <div className="flex flex-col gap-2">
      {items.length ? (
        <ol className="flex flex-col gap-2">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 rounded-md border border-border p-3">
              <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                <Field label={t("content.sources.title")} required error={issueAt(`${path}.${i}.title`) ?? null} className="sm:col-span-2">
                  <Input value={str(item.title)} maxLength={300} disabled={disabled} onChange={(e) => setItem(i, { title: e.target.value })} />
                </Field>
                <Field label={t("content.sources.url")} optional error={issueAt(`${path}.${i}.url`) ? t("content.link.httpsOnly") : null}>
                  <Input value={str(item.url)} inputMode="url" placeholder="https://" disabled={disabled} onChange={(e) => setItem(i, { url: e.target.value.trim() || undefined })} />
                </Field>
                <Field label={t("content.sources.publisher")} optional>
                  <Input value={str(item.publisher)} maxLength={200} disabled={disabled} onChange={(e) => setItem(i, { publisher: e.target.value || undefined })} />
                </Field>
                <Field label={t("content.sources.date")} description={t("content.sources.dateHint")} optional error={issueAt(`${path}.${i}.date`) ?? null}>
                  <Input value={str(item.date)} maxLength={10} placeholder="2025-06-30" disabled={disabled} onChange={(e) => setItem(i, { date: e.target.value.trim() || undefined })} />
                </Field>
                <Field label={t("content.sources.reference")} description={t("content.sources.referenceHint")} optional>
                  <Input value={str(item.reference)} maxLength={200} disabled={disabled} onChange={(e) => setItem(i, { reference: e.target.value || undefined })} />
                </Field>
              </div>
              <ItemControls index={i} count={items.length} disabled={disabled} name={str(item.title) || t("content.sources.sourceN", { n: i + 1 })} onMove={(to) => set(moved(items, i, to))} onRemove={() => set(items.filter((_, j) => j !== i))} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-fg-muted">{t("content.sources.empty")}</p>
      )}
      <Button size="sm" className="self-start" disabled={disabled || items.length >= maxItems} onClick={() => set([...items, { title: "" }])}>
        <Plus aria-hidden="true" />
        {t("content.sources.add")}
      </Button>
    </div>
  );
}

function CredentialsInput({ value, onChange, locale, path, issueAt, disabled, maxItems }: { value: unknown; onChange: (v: unknown) => void; locale: string; path: string; issueAt: (p: string) => string | undefined; disabled: boolean; maxItems: number }) {
  const { t } = useI18n();
  const { can } = useStore();
  const canVerify = can("site:manage");
  const items = arr(value) as Obj[];
  const set = (next: Obj[]) => onChange(next.length ? next : null);
  const setItem = (i: number, patch: Obj) => set(items.map((x, j) => (j === i ? Object.fromEntries(Object.entries({ ...x, ...patch }).filter(([, v]) => v !== undefined && v !== "")) : x)));
  return (
    <div className="flex flex-col gap-2">
      {!canVerify ? <p className="text-sm text-fg-muted">{t("content.credentials.verifyOwnerOnly")}</p> : null}
      <ul className="flex flex-col gap-2">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 rounded-md border border-border p-3">
            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
              <Field label={t("content.credentials.kind")}>
                <Select value={str(item.kind) || "certificate"} disabled={disabled} onValueChange={(v) => setItem(i, { kind: v })} options={(["licence", "certificate", "membership", "award"] as const).map((k) => ({ value: k, label: t(`content.credentials.kinds.${k}`) }))} />
              </Field>
              <Field label={t("content.credentials.name")} required labelAside={<LocaleBadge locale={locale} />} error={issueAt(`${path}.${i}.name`) ?? null}>
                <Input value={str(asRecord(item.name)[locale])} maxLength={200} disabled={disabled} onChange={(e) => setItem(i, { name: withLocale(item.name, locale, e.target.value) ?? {} })} />
              </Field>
              <Field label={t("content.credentials.issuer")} required error={issueAt(`${path}.${i}.issuer`) ?? null}>
                <Input value={str(item.issuer)} maxLength={200} disabled={disabled} onChange={(e) => setItem(i, { issuer: e.target.value })} />
              </Field>
              <Field label={t("content.credentials.number")} optional>
                <Input value={str(item.number)} maxLength={100} disabled={disabled} onChange={(e) => setItem(i, { number: e.target.value })} />
              </Field>
              <Field label={t("content.credentials.url")} optional error={issueAt(`${path}.${i}.url`) ? t("content.link.httpsOnly") : null}>
                <Input value={str(item.url)} inputMode="url" placeholder="https://" disabled={disabled} onChange={(e) => setItem(i, { url: e.target.value.trim() })} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t("content.credentials.validFrom")} optional>
                  <Input type="date" value={str(item.validFrom)} disabled={disabled} onChange={(e) => setItem(i, { validFrom: e.target.value })} />
                </Field>
                <Field label={t("content.credentials.validUntil")} optional error={issueAt(`${path}.${i}`) ?? null}>
                  <Input type="date" value={str(item.validUntil)} disabled={disabled} onChange={(e) => setItem(i, { validUntil: e.target.value })} />
                </Field>
              </div>
              <Checkbox className="sm:col-span-2" checked={item.verified === true} disabled={disabled || !canVerify} onCheckedChange={(c) => setItem(i, { verified: c })} label={t("content.credentials.verified")} description={t("content.credentials.verifiedHint")} />
            </div>
            <ItemControls index={i} count={items.length} disabled={disabled} name={str(asRecord(item.name)[locale]) || t("content.credentials.itemN", { n: i + 1 })} onMove={(to) => set(moved(items, i, to))} onRemove={() => set(items.filter((_, j) => j !== i))} />
          </li>
        ))}
      </ul>
      <Button size="sm" className="self-start" disabled={disabled || items.length >= maxItems} onClick={() => set([...items, { kind: "certificate", name: {}, issuer: "", verified: false }])}>
        <Plus aria-hidden="true" />
        {t("content.credentials.add")}
      </Button>
    </div>
  );
}

/** Nested fields of a group or of one repeater item. */
function NestedFields({ fields, value, onChange, locale, path, issueAt, disabled, resetKey }: { fields: FieldDef[]; value: Obj; onChange: (v: Obj) => void; locale: string; path: string; issueAt: (p: string) => string | undefined; disabled: boolean; resetKey: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-6">
      {fields.map((child) => (
        <div key={child.key} className={widthClass(child)}>
          <FieldInput field={child} value={value[child.key]} onChange={(v) => onChange({ ...value, [child.key]: v ?? undefined })} locale={locale} path={`${path}.${child.key}`} issueAt={issueAt} disabled={disabled} resetKey={resetKey} />
        </div>
      ))}
    </div>
  );
}

/** Grid span of a field inside a six-column grid (ui.width). */
export function widthClass(field: FieldDef): string {
  const w = field.ui?.width;
  return w === "half" ? "sm:col-span-3" : w === "third" ? "sm:col-span-2" : "sm:col-span-6";
}

export function FieldInput({ field, value, onChange, locale, path, issueAt, disabled, resetKey }: FieldInputProps) {
  const { t, locale: ui } = useI18n();
  const { store } = useStore();
  const { label, description, placeholder } = useFieldText(field);
  const id = useId();
  const v = field.localized ? asRecord(value)[locale] : value;
  const setV = (next: unknown) => onChange(field.localized ? withLocale(value, locale, next) : next === "" || next === undefined ? null : next);
  const vPath = field.localized ? `${path}.${locale}` : path;
  const ownError = issueAt(vPath);
  // An issue in another language of a localized field is shown with that language.
  const otherLocaleError = field.localized && !ownError ? Object.keys(asRecord(value)).concat(store.supportedLocales).map((l) => (l !== locale && issueAt(`${path}.${l}`) ? `${l.toUpperCase()}: ${issueAt(`${path}.${l}`)}` : null)).find(Boolean) : null;
  const error = ownError ?? otherLocaleError ?? (issueAt(path) && !field.localized ? issueAt(path) : undefined) ?? undefined;
  const required = field.required === "always";
  const badge = field.localized ? <LocaleBadge locale={locale} /> : undefined;
  const control = { lang: field.localized ? localeHtmlLang(locale) : undefined, dir: field.localized ? localeDir(locale) : undefined } as const;
  const fieldProps = { id: `${id}-c`, label, description: description || undefined, error: error ?? null, required, optional: !field.required, labelAside: badge };
  const vl = field.validation;

  switch (field.type) {
    case "text":
    case "email":
      return (
        <Field {...fieldProps}>
          <Input type={field.type === "email" ? "email" : "text"} value={str(v)} maxLength={vl.maxLength ?? (field.type === "email" ? 254 : 200)} showCount={field.type === "text"} placeholder={placeholder} disabled={disabled} {...control} onChange={(e) => setV(e.target.value)} />
        </Field>
      );
    case "textarea":
      return (
        <Field {...fieldProps}>
          <Textarea value={str(v)} maxLength={vl.maxLength ?? 2000} showCount rows={field.key === "summary" ? 4 : 3} placeholder={placeholder} disabled={disabled} {...control} onChange={(e) => setV(e.target.value)} />
        </Field>
      );
    case "slug":
      return (
        <Field {...fieldProps} description={description || t("content.fields.slugHint")}>
          <Input value={str(v)} maxLength={63} className="font-mono" disabled={disabled} onChange={(e) => setV(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} />
        </Field>
      );
    case "richDoc":
      return (
        <div className="flex flex-col gap-1.5">
          <span className="flex items-baseline justify-between gap-2">
            <label id={`${id}-label`} htmlFor={`${id}-c`} className="text-base font-medium text-fg">
              {label}
              {required ? <span className="ms-1 text-sm font-normal text-fg-subtle">({t("common.required")})</span> : null}
            </label>
            {badge}
          </span>
          {description ? (
            <p id={`${id}-d`} className="-mt-1 text-sm text-fg-muted">
              {description}
            </p>
          ) : null}
          <RichDocEditor
            id={`${id}-c`}
            aria-labelledby={`${id}-label`}
            {...(description ? { "aria-describedby": `${id}-d` } : {})}
            value={v}
            onChange={(doc) => setV(doc)}
            resetKey={`${resetKey}:${locale}`}
            nodes={vl.nodes}
            marks={vl.marks}
            maxChars={vl.maxChars}
            invalid={Boolean(error)}
            disabled={disabled}
            {...(control.lang ? { lang: control.lang } : {})}
            {...(control.dir ? { dir: control.dir } : {})}
          />
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      );
    case "number":
    case "duration": {
      const unit = field.type === "duration" ? t("content.units.minute") : vl.unit ? t(`content.units.${vl.unit}`) : undefined;
      return (
        <Field {...fieldProps}>
          <Input
            type="number"
            inputMode={vl.integer || field.type === "duration" ? "numeric" : "decimal"}
            step={vl.integer || field.type === "duration" ? 1 : "any"}
            min={typeof vl.min === "number" ? vl.min : field.type === "duration" ? (vl.minMinutes ?? 0) : undefined}
            max={typeof vl.max === "number" ? vl.max : field.type === "duration" ? vl.maxMinutes : undefined}
            value={num(v) === null ? "" : String(v)}
            suffix={unit}
            disabled={disabled}
            onChange={(e) => setV(e.target.value === "" ? null : Number(e.target.value))}
          />
        </Field>
      );
    }
    case "money": {
      const m = asRecord(v);
      const currencies = vl.currency ? [vl.currency] : store.supportedCurrencies;
      const currency = str(m.currency) || currencies[0] || store.defaultCurrency;
      return (
        <FieldGroup label={label} description={description} error={error} required={required} badge={badge}>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <MoneyInput
                currency={currency}
                hideCurrency
                value={typeof m.amountMinor === "number" ? String(m.amountMinor) : null}
                disabled={disabled}
                allowNegative={(vl.minMinor ?? 0) < 0}
                onChange={(minor) => setV(minor === null ? null : { amountMinor: Number(minor), currency })}
              />
            </div>
            {currencies.length > 1 ? (
              <div className="w-28">
                <Select aria-label={t("content.fields.currency")} value={currency} disabled={disabled} onValueChange={(c) => setV(typeof m.amountMinor === "number" ? { amountMinor: m.amountMinor, currency: c } : null)} options={currencies.map((c) => ({ value: c, label: c }))} />
              </div>
            ) : (
              <span className="self-center text-sm text-fg-muted">{currency}</span>
            )}
          </div>
        </FieldGroup>
      );
    }
    case "boolean":
      return (
        <div className="flex flex-col gap-1">
          <Switch checked={v === true} disabled={disabled} onCheckedChange={(c) => setV(c)} label={label} description={description || undefined} />
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>
      );
    case "date":
      return (
        <Field {...fieldProps}>
          <Input type="date" value={str(v)} min={typeof vl.min === "string" ? vl.min : undefined} max={typeof vl.max === "string" ? vl.max : undefined} disabled={disabled} onChange={(e) => setV(e.target.value)} />
        </Field>
      );
    case "datetime":
      return (
        <Field {...fieldProps}>
          <DateTimeInput value={str(v) || null} timeZone={store.timezone} disabled={disabled} onChange={(iso) => setV(iso)} />
        </Field>
      );
    case "dateRange": {
      const r = asRecord(v);
      const setR = (patch: Obj) => {
        const next = { ...r, ...patch };
        setV(str(next.from) || str(next.to) ? { from: str(next.from) || str(next.to), to: str(next.to) || str(next.from) } : null);
      };
      return (
        <FieldGroup label={label} description={description} error={error} required={required} badge={badge}>
          <div className="flex flex-wrap gap-3">
            <Field label={t("content.fields.from")} className="w-44">
              <Input type="date" value={str(r.from)} disabled={disabled} onChange={(e) => setR({ from: e.target.value })} />
            </Field>
            <Field label={t("content.fields.to")} className="w-44">
              <Input type="date" value={str(r.to)} min={str(r.from) || undefined} disabled={disabled} onChange={(e) => setR({ to: e.target.value })} />
            </Field>
          </div>
        </FieldGroup>
      );
    }
    case "select": {
      const options = (vl.options ?? []).map((o) => ({ value: o.value, label: labelText(o.label, ui, o.value) }));
      return (
        <Field {...fieldProps}>
          <Select value={str(v) || "__none"} disabled={disabled} onValueChange={(x) => setV(x === "__none" ? null : x)} options={[{ value: "__none", label: t("content.fields.noneSelected") }, ...options]} />
        </Field>
      );
    }
    case "multiSelect": {
      const chosen = arr(v) as string[];
      return (
        <FieldGroup label={label} description={description} error={error} required={required}>
          <div className="flex flex-col gap-1.5">
            {(vl.options ?? []).map((o) => (
              <Checkbox
                key={o.value}
                checked={chosen.includes(o.value)}
                disabled={disabled || (!chosen.includes(o.value) && vl.maxItems !== undefined && chosen.length >= vl.maxItems)}
                onCheckedChange={(c) => {
                  const next = c ? (vl.options ?? []).map((x) => x.value).filter((x) => x === o.value || chosen.includes(x)) : chosen.filter((x) => x !== o.value);
                  setV(next.length ? next : null);
                }}
                label={labelText(o.label, ui, o.value)}
              />
            ))}
          </div>
        </FieldGroup>
      );
    }
    case "color":
      return (
        <Field {...fieldProps}>
          <div className="flex items-center gap-2">
            <input type="color" aria-label={label} value={/^#[0-9a-f]{6}$/i.test(str(v)) ? str(v) : "#000000"} disabled={disabled} onChange={(e) => setV(e.target.value.toLowerCase())} className="h-8 w-10 cursor-pointer rounded-md border border-border-control bg-surface" />
            <Input value={str(v)} maxLength={7} placeholder="#1a2b3c" className="w-32 font-mono" disabled={disabled} onChange={(e) => setV(e.target.value.trim())} />
          </div>
        </Field>
      );
    case "asset":
      return <AssetUsageInput label={label} description={description} value={v} onChange={setV} locale={locale} path={vPath} issueAt={issueAt} disabled={disabled} required={required} kinds={vl.kinds ?? ["image"]} />;
    case "gallery":
      return <GalleryInput label={label} description={description} value={v} onChange={setV} locale={locale} path={vPath} issueAt={issueAt} disabled={disabled} maxItems={vl.maxItems ?? 30} />;
    case "video": {
      const vid = asRecord(v);
      const provider = str(vid.provider) || "youtube";
      const setVid = (patch: Obj) => {
        const next: Obj = { ...vid, provider, ...patch };
        setV(str(next.id) ? nonEmpty(next) : null);
      };
      return (
        <FieldGroup label={label} description={description} error={error} required={required} badge={badge}>
          <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <Field label={t("content.blocks.embed.provider")}>
              <Select value={provider} disabled={disabled} onValueChange={(p) => setV(str(vid.id) ? { ...vid, provider: p, id: "" } : null)} options={(["youtube", "vimeo"] as const).map((p) => ({ value: p, label: t(`content.blocks.embed.providers.${p}`) }))} />
            </Field>
            <Field label={t("content.blocks.embed.id")} description={t(`content.blocks.embed.idHints.${provider as "youtube"}`)} error={issueAt(`${vPath}.id`) ?? null}>
              <Input value={str(vid.id)} className="font-mono" disabled={disabled} onChange={(e) => setVid({ id: embedIdFrom(provider, e.target.value) })} />
            </Field>
          </div>
          <Field label={t("content.fields.videoTitle")} optional labelAside={<LocaleBadge locale={locale} />}>
            <Input value={str(asRecord(vid.title)[locale])} maxLength={200} disabled={disabled} onChange={(e) => setVid({ title: withLocale(vid.title, locale, e.target.value) ?? undefined })} />
          </Field>
          <Field label={t("content.fields.transcript")} description={t("content.fields.transcriptHint")} optional labelAside={<LocaleBadge locale={locale} />}>
            <Textarea value={str(asRecord(vid.transcript)[locale])} rows={3} maxLength={50_000} disabled={disabled} onChange={(e) => setVid({ transcript: withLocale(vid.transcript, locale, e.target.value) ?? undefined })} />
          </Field>
        </FieldGroup>
      );
    }
    case "link": {
      const lv = asRecord(v);
      const target = (lv.target as LinkTarget | undefined) ?? { type: "url", url: "" };
      const setLink = (patch: Obj) => {
        const next: Obj = { ...lv, target, ...patch };
        const tg = next.target as LinkTarget;
        const empty = tg.type === "url" ? !tg.url : "id" in tg ? !tg.id : false;
        setV(empty && !Object.keys(asRecord(next.label)).length ? null : Object.fromEntries(Object.entries(next).filter(([, x]) => x !== undefined)));
      };
      return (
        <FieldGroup label={label} description={description} error={error} required={required} badge={badge}>
          <LinkTargetField value={target} disabled={disabled} showErrors={Boolean(issueAt(`${vPath}.target`))} onChange={(tg) => setLink({ target: tg })} />
          <Field label={t("content.link.label")} optional labelAside={<LocaleBadge locale={locale} />}>
            <Input value={str(asRecord(lv.label)[locale])} maxLength={120} disabled={disabled} onChange={(e) => setLink({ label: withLocale(lv.label, locale, e.target.value) ?? undefined })} />
          </Field>
          <Checkbox checked={lv.openInNewTab === true} disabled={disabled} onCheckedChange={(c) => setLink({ openInNewTab: c || undefined })} label={t("richText.linkNewTab")} />
        </FieldGroup>
      );
    }
    case "reference":
      return (
        <Field {...fieldProps}>
          <RecordPicker to={vl.to ?? "entry"} typeKeys={vl.typeKeys} value={str(v) || null} disabled={disabled} onChange={(x) => setV(x)} />
        </Field>
      );
    case "multiReference":
      return (
        <Field {...fieldProps} description={[description, vl.maxItems ? t("content.fields.maxItems", { max: vl.maxItems }) : ""].filter(Boolean).join(" ") || undefined}>
          <MultiRecordPicker to={vl.to ?? "entry"} typeKeys={vl.typeKeys} maxItems={vl.maxItems} value={arr(v) as string[]} disabled={disabled} onChange={(ids) => setV(ids.length ? ids : null)} />
        </Field>
      );
    case "phone": {
      const p = asRecord(v);
      return (
        <FieldGroup label={label} description={description} error={error} required={required} badge={badge}>
          <Input
            type="tel"
            inputMode="tel"
            aria-label={label}
            placeholder="+90 5xx xxx xx xx"
            value={str(p.number)}
            disabled={disabled}
            onChange={(e) => {
              const compact = e.target.value.replace(/[\s().\-/]/g, "");
              const number = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
              setV(number ? { ...p, number } : null);
            }}
          />
          <Checkbox checked={p.whatsapp === true} disabled={disabled || !str(p.number)} onCheckedChange={(c) => setV({ ...p, whatsapp: c || undefined })} label={t("content.fields.whatsapp")} />
        </FieldGroup>
      );
    }
    case "address": {
      const a = v && typeof v === "object" ? ({ ...emptyAddress(), ...(v as SiteAddress) } as SiteAddress) : null;
      return (
        <FieldGroup label={label} description={description} error={a ? undefined : error} required={required} badge={badge}>
          {a ? (
            <>
              <AddressFields
                value={a}
                idPrefix={`${id}-addr`}
                disabled={disabled}
                showLocalErrors={false}
                errorAt={(k) => issueAt(`${vPath}.${k}`)}
                onChange={(next) => setV({ ...next, mahalle: next.mahalle || null, ilce: next.ilce || null, postalCode: next.postalCode || null })}
              />
              <Button size="sm" variant="ghost" className="self-start" disabled={disabled} onClick={() => setV(null)}>
                {t("content.fields.clearAddress")}
              </Button>
            </>
          ) : (
            <Button size="sm" className="self-start" disabled={disabled} onClick={() => setV({ ...emptyAddress(store.countryCode || "TR") })}>
              <Plus aria-hidden="true" />
              {t("content.fields.addAddress")}
            </Button>
          )}
        </FieldGroup>
      );
    }
    case "geo": {
      const g = asRecord(v);
      const setG = (patch: Obj) => {
        const next = { ...g, ...patch };
        setV(num(next.lat) === null && num(next.lng) === null ? null : { lat: num(next.lat), lng: num(next.lng), approximate: next.approximate === true });
      };
      return (
        <FieldGroup label={label} description={description || t("content.fields.geoHint")} error={error} required={required}>
          <div className="flex flex-wrap gap-3">
            <Field label={t("content.fields.lat")} className="w-40" error={issueAt(`${vPath}.lat`) ?? null}>
              <Input type="number" step="any" min={-90} max={90} value={num(g.lat) === null ? "" : String(g.lat)} disabled={disabled} onChange={(e) => setG({ lat: e.target.value === "" ? null : Number(e.target.value) })} />
            </Field>
            <Field label={t("content.fields.lng")} className="w-40" error={issueAt(`${vPath}.lng`) ?? null}>
              <Input type="number" step="any" min={-180} max={180} value={num(g.lng) === null ? "" : String(g.lng)} disabled={disabled} onChange={(e) => setG({ lng: e.target.value === "" ? null : Number(e.target.value) })} />
            </Field>
          </div>
          <Checkbox checked={g.approximate === true} disabled={disabled} onCheckedChange={(c) => setG({ approximate: c })} label={t("content.fields.approximate")} description={t("content.fields.approximateHint")} />
        </FieldGroup>
      );
    }
    case "openingHours":
      return (
        <FieldGroup label={label} description={description} error={error} required={required}>
          <OpeningHoursEditor
            idPrefix={`${id}-oh`}
            value={v && typeof v === "object" ? ({ ...emptyOpeningHours(), ...(v as OpeningHours) } as OpeningHours) : emptyOpeningHours()}
            onChange={(h) => setV(h.weekly.length || h.specialDays.length || h.byAppointment || Object.keys(h.note ?? {}).length ? h : null)}
            locales={store.supportedLocales}
            defaultLocale={store.defaultLocale}
            errorAt={(p) => issueAt(`${vPath}.${p}`)}
            disabled={disabled}
          />
        </FieldGroup>
      );
    case "keyFacts":
      return (
        <FieldGroup label={label} description={description} error={error && !issueAt(`${vPath}.0`) ? error : undefined} required={required} badge={badge}>
          <KeyFactsInput value={v} onChange={setV} path={vPath} issueAt={issueAt} disabled={disabled} maxItems={vl.maxItems ?? 12} />
        </FieldGroup>
      );
    case "sources":
      return (
        <FieldGroup label={label} description={description} error={error && !issueAt(`${vPath}.0`) ? error : undefined} required={required} badge={badge}>
          <SourcesInput value={v} onChange={setV} path={vPath} issueAt={issueAt} disabled={disabled} maxItems={vl.maxItems ?? 20} />
        </FieldGroup>
      );
    case "credentials":
      return (
        <FieldGroup label={label} description={description} error={error && !issueAt(`${vPath}.0`) ? error : undefined} required={required}>
          <CredentialsInput value={v} onChange={setV} locale={locale} path={vPath} issueAt={issueAt} disabled={disabled} maxItems={vl.maxItems ?? 20} />
        </FieldGroup>
      );
    case "group":
      return (
        <FieldGroup label={label} description={description} required={required} error={issueAt(path) && !Object.keys(asRecord(value)).some((k) => issueAt(`${path}.${k}`)) ? issueAt(path) : undefined}>
          <div className="rounded-md border border-border p-3">
            <NestedFields fields={vl.fields ?? []} value={asRecord(value)} onChange={(o) => onChange(nonEmpty(o))} locale={locale} path={path} issueAt={issueAt} disabled={disabled} resetKey={resetKey} />
          </div>
        </FieldGroup>
      );
    case "repeater": {
      const items = arr(value) as Obj[];
      const set = (next: Obj[]) => onChange(next.length ? next : null);
      const children = vl.fields ?? [];
      const titleChild = children.find((c) => c.type === "text");
      const itemName = (item: Obj, i: number) => {
        const tv = titleChild ? (titleChild.localized ? str(asRecord(item[titleChild.key])[locale]) : str(item[titleChild.key])) : "";
        return tv || t("content.fields.itemN", { n: i + 1 });
      };
      return (
        <FieldGroup label={label} description={[description, vl.maxItems ? t("content.fields.maxItems", { max: vl.maxItems }) : ""].filter(Boolean).join(" ")} required={required} error={issueAt(path) && !items.some((_, i) => issueAt(`${path}.${i}`)) ? issueAt(path) : undefined}>
          {items.length ? (
            <ol className="flex flex-col gap-3">
              {items.map((item, i) => (
                <li key={i} className="flex flex-col gap-3 rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-fg">{itemName(item, i)}</span>
                    <ItemControls index={i} count={items.length} disabled={disabled} name={itemName(item, i)} onMove={(to) => set(moved(items, i, to))} onRemove={() => set(items.filter((_, j) => j !== i))} />
                  </div>
                  <NestedFields fields={children} value={item} onChange={(o) => set(items.map((x, j) => (j === i ? o : x)))} locale={locale} path={`${path}.${i}`} issueAt={issueAt} disabled={disabled} resetKey={`${resetKey}:${i}`} />
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-fg-muted">{t("content.fields.repeaterEmpty")}</p>
          )}
          <Button size="sm" className="self-start" disabled={disabled || items.length >= (vl.maxItems ?? 20)} onClick={() => set([...items, {}])}>
            <Plus aria-hidden="true" />
            {t("content.fields.addItem")}
          </Button>
        </FieldGroup>
      );
    }
    default:
      return (
        <Field {...fieldProps}>
          <Input value={typeof v === "string" ? v : JSON.stringify(v ?? "")} disabled />
        </Field>
      );
  }
}
