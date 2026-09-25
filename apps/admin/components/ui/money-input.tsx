"use client";

import { useEffect, useId, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { minorToInput, parseMoneyInput } from "@/lib/format";
import { useFieldControl } from "./field";
import { Input } from "./input";

export interface MoneyInputProps {
  currency: string;
  /** Integer minor units as a string ("70000" = 700,00 TRY), or null when empty. */
  value: string | null;
  onChange: (minor: string | null) => void;
  /** Hidden input with the minor-unit value for form submissions. */
  name?: string;
  allowNegative?: boolean;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
  /** Leave out the currency suffix, e.g. in a table whose column header already names it. */
  hideCurrency?: boolean;
}

/**
 * Amount typed in the interface language's format (tr 1.234,56 · en 1,234.56) and converted to
 * minor units with string arithmetic, using the currency's own number of decimals.
 */
export function MoneyInput({ currency, value, onChange, name, allowNegative, disabled, id, placeholder, hideCurrency }: MoneyInputProps) {
  const { t, locale } = useI18n();
  const field = useFieldControl(id);
  const errorId = useId();
  const [text, setText] = useState(() => (value ? minorToInput(value, currency, locale) : ""));
  const [invalid, setInvalid] = useState(false);

  // Follow external value changes (e.g. form reset) without clobbering what is being typed.
  useEffect(() => {
    const parsed = parseMoneyInput(text, currency, locale);
    if (parsed !== value) setText(value ? minorToInput(value, currency, locale) : "");
  }, [value, currency, locale]);

  const update = (next: string) => {
    setText(next);
    if (next.trim() === "") {
      setInvalid(false);
      onChange(null);
      return;
    }
    const minor = parseMoneyInput(next, currency, locale);
    const ok = minor !== null && (allowNegative || !minor.startsWith("-"));
    setInvalid(!ok);
    if (ok) onChange(minor);
  };

  const describedBy = [field?.["aria-describedby"], invalid ? errorId : undefined].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <Input
        id={field?.id ?? id}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => update(e.target.value)}
        suffix={hideCurrency ? undefined : <span className="text-sm font-medium">{currency}</span>}
        aria-describedby={describedBy}
        aria-invalid={invalid || field?.["aria-invalid"] ? true : undefined}
        className="tabular"
      />
      {name ? <input type="hidden" name={name} value={value ?? ""} /> : null}
      {invalid ? (
        <p id={errorId} className="text-sm text-danger">
          {t("ui.money.invalid")}
        </p>
      ) : null}
    </div>
  );
}
