import type { ComboboxOption } from "@/components/ui/combobox";
import { intlLocale, type UiLocale } from "@/lib/i18n/config";
import { timeZoneOffsetLabel } from "@/lib/format";

/**
 * Option lists built from the browser's Intl data. They are computed on the client after mount
 * (engines ship different CLDR versions, so server and browser labels could differ).
 */

export function timeZoneOptions(): ComboboxOption[] {
  const now = new Date();
  return Intl.supportedValuesOf("timeZone").map((tz) => ({ value: tz, label: tz.replace(/_/g, " "), description: timeZoneOffsetLabel(tz, now), keywords: [tz] }));
}

export function currencyOptions(locale: UiLocale): ComboboxOption[] {
  const names = new Intl.DisplayNames([intlLocale(locale)], { type: "currency" });
  return Intl.supportedValuesOf("currency").map((code) => ({ value: code, label: names.of(code) ?? code, description: code, keywords: [code] }));
}

/** Codes that Intl names but that are not countries (EU, UN, pseudo-regions). */
const NOT_COUNTRIES = new Set(["EU", "EZ", "UN", "QO", "XA", "XB", "ZZ"]);

export function countryOptions(locale: UiLocale): ComboboxOption[] {
  const names = new Intl.DisplayNames([intlLocale(locale)], { type: "region", fallback: "none" });
  const out: ComboboxOption[] = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      if (NOT_COUNTRIES.has(code)) continue;
      const name = names.of(code);
      if (name && name !== code) out.push({ value: code, label: name, description: code, keywords: [code] });
    }
  }
  return out.sort((x, y) => x.label.localeCompare(y.label, intlLocale(locale)));
}
