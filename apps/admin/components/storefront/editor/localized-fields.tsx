"use client";

import { useId, useMemo } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { InlineAlert } from "@/components/ui/inline-alert";
import { controlClasses } from "@/components/ui/input-styles";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { cn } from "@/lib/cn";
import { localeDir, localeHtmlLang, localeLabel } from "@/lib/locales";
import { editorToRichDoc, isEditableRichDoc, isEmptyDoc, isEmptyHtml, richDocToEditor, type DocNode } from "@/lib/storefront/rich-doc";
import { useEditorContext } from "./editor-context";

type LocalizedMap = Record<string, unknown>;

function asMap(value: unknown): LocalizedMap {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as LocalizedMap) : {};
}

/** Returns the map with the edit language set, or removed when empty (so the default-language fallback applies). */
function withLocale(map: LocalizedMap, locale: string, next: unknown | undefined): LocalizedMap {
  const copy = { ...map };
  if (next === undefined) delete copy[locale];
  else copy[locale] = next;
  return copy;
}

interface LabelProps {
  id: string;
  label: string;
  required?: boolean;
}

/** Field label with the language being edited ("Başlık · TR"). */
function LocalizedLabel({ id, label, required }: LabelProps) {
  const { t, locale: ui } = useI18n();
  const { editLocale } = useEditorContext();
  return (
    <span className="flex items-baseline justify-between gap-2">
      <label htmlFor={id} id={`${id}-label`} className="text-base font-medium text-fg">
        {label}
        {required ? <span className="ms-1 text-sm font-normal text-fg-subtle">({t("common.required")})</span> : null}
      </label>
      <span className="rounded-sm border border-border px-1 text-xs font-medium uppercase text-fg-muted" title={localeLabel(editLocale, ui)}>
        <span aria-hidden="true">{editLocale}</span>
        <span className="sr-only">{localeLabel(editLocale, ui)}</span>
      </span>
    </span>
  );
}

function FallbackHint({ id, text }: { id: string; text: string | null }) {
  const { t, locale: ui } = useI18n();
  const { editLocale, defaultLocale } = useEditorContext();
  if (editLocale === defaultLocale) return null;
  return (
    <p id={id} className="text-xs text-fg-subtle">
      {text ? t("editor.fields.fallbackWithText", { locale: localeLabel(defaultLocale, ui), text: text.length > 80 ? `${text.slice(0, 80)}…` : text }) : t("ui.field.localeEmptyHint", { locale: localeLabel(defaultLocale, ui) })}
    </p>
  );
}

export interface LocalizedFieldProps {
  label: string;
  value: unknown;
  onChange: (next: LocalizedMap) => void;
  error?: string | undefined;
  description?: string | null;
  required?: boolean;
}

/** Short localized text (one input for the language being edited). */
export function LocalizedTextField({ label, value, onChange, error, description, required, maxLength, multiline }: LocalizedFieldProps & { maxLength: number; multiline: boolean }) {
  const { t } = useI18n();
  const { editLocale, defaultLocale, canEdit } = useEditorContext();
  const id = useId();
  const map = asMap(value);
  const text = typeof map[editLocale] === "string" ? (map[editLocale] as string) : "";
  const fallback = typeof map[defaultLocale] === "string" ? (map[defaultLocale] as string) : null;
  const describedBy = [description ? `${id}-desc` : null, editLocale !== defaultLocale ? `${id}-fallback` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  const common = {
    id,
    value: text,
    maxLength,
    lang: localeHtmlLang(editLocale),
    dir: localeDir(editLocale),
    disabled: !canEdit,
    placeholder: editLocale !== defaultLocale && fallback ? fallback : undefined,
    "aria-describedby": describedBy,
    "aria-invalid": error ? (true as const) : undefined,
    "aria-required": required ? (true as const) : undefined,
    onChange: (e: { target: { value: string } }) => onChange(withLocale(map, editLocale, e.target.value === "" ? undefined : e.target.value)),
  };
  const near = text.length >= maxLength * 0.9;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <LocalizedLabel id={id} label={label} {...(required ? { required } : {})} />
      {multiline ? (
        <textarea
          {...common}
          rows={3}
          className={cn(
            "w-full min-w-0 resize-y rounded-md border bg-surface px-2.5 py-1.5 text-base text-fg shadow-xs placeholder:text-fg-subtle disabled:bg-surface-muted",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
            error ? "border-danger" : "border-border-control",
          )}
        />
      ) : (
        <input {...common} type="text" className={controlClasses({ invalid: Boolean(error) })} />
      )}
      <div className="flex items-start justify-between gap-2">
        <FallbackHint id={`${id}-fallback`} text={fallback} />
        <span className={cn("ms-auto text-xs tabular", near ? "text-warning" : "text-fg-subtle")} aria-hidden="true">
          {text.length}/{maxLength}
        </span>
      </div>
      {near ? (
        <span className="sr-only" aria-live="polite">
          {t("ui.field.characterLimitNear", { remaining: maxLength - text.length })}
        </span>
      ) : null}
      {description ? (
        <p id={`${id}-desc`} className="text-sm text-fg-muted">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Localized rich text stored as sanitized HTML (rich-text@1 bodies, footer text, consent text). */
export function LocalizedRichHtmlField({ label, value, onChange, error, description, required }: LocalizedFieldProps) {
  const { editLocale, defaultLocale, canEdit, resetNonce } = useEditorContext();
  const id = useId();
  const map = asMap(value);
  const html = typeof map[editLocale] === "string" ? (map[editLocale] as string) : "";
  const fallback = typeof map[defaultLocale] === "string" ? (map[defaultLocale] as string).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : null;
  const describedBy = [description ? `${id}-desc` : null, `${id}-fallback`, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <LocalizedLabel id={id} label={label} {...(required ? { required } : {})} />
      <RichTextEditor
        id={id}
        aria-labelledby={`${id}-label`}
        aria-describedby={describedBy}
        initialContent={html}
        resetKey={`${editLocale}:${resetNonce}`}
        invalid={Boolean(error)}
        disabled={!canEdit}
        lang={localeHtmlLang(editLocale)}
        dir={localeDir(editLocale)}
        onChange={(c) => onChange(withLocale(map, editLocale, c.isEmpty || isEmptyHtml(c.html) ? undefined : c.html))}
      />
      <FallbackHint id={`${id}-fallback`} text={fallback || null} />
      {description ? (
        <p id={`${id}-desc`} className="text-sm text-fg-muted">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Localized structured rich text (rich-text@2, faq@2 answers). Unsupported documents are kept read-only. */
export function LocalizedRichDocField({ label, value, onChange, error, description, required }: LocalizedFieldProps) {
  const { t } = useI18n();
  const { editLocale, canEdit, resetNonce } = useEditorContext();
  const id = useId();
  const map = asMap(value);
  const doc = map[editLocale];
  const editable = isEditableRichDoc(doc);
  const initial = useMemo(() => richDocToEditor(doc), [doc]);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <LocalizedLabel id={id} label={label} {...(required ? { required } : {})} />
      {editable ? (
        <RichTextEditor
          id={id}
          aria-labelledby={`${id}-label`}
          {...(description || error ? { "aria-describedby": [description ? `${id}-desc` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") } : {})}
          initialContent={initial}
          resetKey={`${editLocale}:${resetNonce}`}
          invalid={Boolean(error)}
          disabled={!canEdit}
          lang={localeHtmlLang(editLocale)}
          dir={localeDir(editLocale)}
          onChange={(c) => {
            const next = editorToRichDoc(c.json as DocNode);
            onChange(withLocale(map, editLocale, c.isEmpty || isEmptyDoc(next) ? undefined : next));
          }}
        />
      ) : (
        <InlineAlert tone="info" title={t("richText.readOnlyTitle")}>
          {t("richText.readOnlyBody")}
        </InlineAlert>
      )}
      {description ? (
        <p id={`${id}-desc`} className="text-sm text-fg-muted">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
