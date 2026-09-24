const MINOR: Record<string, number> = { JPY: 0, KWD: 3, BHD: 3 };

/** Converts integer minor units (string) to a decimal string without floating point. */
export function minorToDecimal(amount: string, currency: string): string {
  const units = MINOR[currency] ?? 2;
  const negative = amount.startsWith("-");
  const digits = (negative ? amount.slice(1) : amount).padStart(units + 1, "0");
  const body = units ? `${digits.slice(0, -units)}.${digits.slice(-units)}` : digits;
  return negative ? `-${body}` : body;
}

const formatters = new Map<string, Intl.NumberFormat>();

/** Localized money display; Intl formats the exact decimal string (no float rounding). */
export function formatMoney(amount: string | null | undefined, currency: string, locale: string): string {
  if (amount == null) return "";
  const key = `${locale}:${currency}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale === "tr" ? "tr-TR" : locale, { style: "currency", currency });
    formatters.set(key, f);
  }
  return f.format(minorToDecimal(amount, currency) as unknown as number);
}

export function formatDate(iso: string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : locale, { dateStyle: "long", timeZone }).format(new Date(iso));
}

export function localized(map: unknown, locale: string, fallback: string): string {
  if (!map || typeof map !== "object") return typeof map === "string" ? map : "";
  const m = map as Record<string, string>;
  return m[locale] || m[fallback] || Object.values(m).find(Boolean) || "";
}

export function localizedPath(locale: string, defaultLocale: string, path: string): string {
  return locale === defaultLocale ? path : `/${locale}${path === "/" ? "" : path}`;
}
