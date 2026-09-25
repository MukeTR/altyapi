"use client";

import { useId } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { cn } from "@/lib/cn";
import { localeDir, localeHtmlLang, localeLabel } from "@/lib/locales";
import { controlClasses } from "./input-styles";

export type LocalizedValue = Record<string, string>;

export interface LocalizedTextFieldProps {
  label: string;
  description?: string;
  /** Store content languages (store.supportedLocales). */
  locales: readonly string[];
  defaultLocale: string;
  value: LocalizedValue;
  onChange: (value: LocalizedValue) => void;
  maxLength?: number;
  multiline?: boolean;
  /** The default-language value is required. */
  required?: boolean;
  /** Errors per locale code (from API issue paths like "title.en"). */
  errors?: Partial<Record<string, string>>;
  disabled?: boolean;
}

/**
 * One input per store language, default language first. Non-default languages may stay empty:
 * the storefront then falls back to the default-language text.
 */
export function LocalizedTextField({ label, description, locales, defaultLocale, value, onChange, maxLength, multiline, required, errors, disabled }: LocalizedTextFieldProps) {
  const { t, locale: ui } = useI18n();
  const baseId = useId();
  const ordered = [defaultLocale, ...locales.filter((l) => l !== defaultLocale)];
  const done = ordered.filter((l) => (value[l] ?? "").trim() !== "").length;
  const descriptionId = description ? `${baseId}-description` : undefined;

  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={descriptionId}>
      <legend className="flex w-full items-baseline justify-between gap-2 text-base font-medium text-fg">
        <span>
          {label}
          {required ? <span className="ms-1 text-sm font-normal text-fg-subtle">({t("common.required")})</span> : null}
        </span>
        {ordered.length > 1 ? <span className="text-xs font-normal text-fg-subtle tabular">{t("ui.field.localeCompletion", { done, total: ordered.length })}</span> : null}
      </legend>
      {description ? (
        <p id={descriptionId} className="-mt-1 text-sm text-fg-muted">
          {description}
        </p>
      ) : null}
      {ordered.map((code) => {
        const id = `${baseId}-${code}`;
        const error = errors?.[code];
        const isDefault = code === defaultLocale;
        const text = value[code] ?? "";
        const hintId = !isDefault && !text ? `${id}-hint` : undefined;
        const errorId = error ? `${id}-error` : undefined;
        const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
        const common = {
          id,
          lang: localeHtmlLang(code),
          dir: localeDir(code),
          value: text,
          disabled: disabled ?? false,
          maxLength,
          "aria-describedby": describedBy,
          "aria-invalid": error ? (true as const) : undefined,
          "aria-required": isDefault && required ? (true as const) : undefined,
          onChange: (e: { target: { value: string } }) => onChange({ ...value, [code]: e.target.value }),
        };
        return (
          <div key={code} className="grid gap-1 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-start sm:gap-3">
            <label htmlFor={id} className="pt-1.5 text-sm text-fg-muted">
              {localeLabel(code, ui)}
              {isDefault ? <span className="ms-1 text-xs text-fg-subtle">({t("common.default")})</span> : null}
            </label>
            <div className="flex min-w-0 flex-col gap-1">
              {multiline ? (
                <textarea
                  {...common}
                  rows={3}
                  className={cn(
                    "w-full min-w-0 resize-y rounded-md border bg-surface px-2.5 py-1.5 text-base text-fg shadow-xs placeholder:text-fg-subtle",
                    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
                    error ? "border-danger" : "border-border-control",
                  )}
                />
              ) : (
                <input {...common} type="text" className={controlClasses({ invalid: Boolean(error) })} />
              )}
              {hintId ? (
                <p id={hintId} className="text-xs text-fg-subtle">
                  {t("ui.field.localeEmptyHint", { locale: localeLabel(defaultLocale, ui) })}
                </p>
              ) : null}
              {error ? (
                <p id={errorId} className="text-sm text-danger">
                  {error}
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}
