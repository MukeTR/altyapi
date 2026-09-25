import { intlLocale, type UiLocale } from "@/lib/i18n/config";

/**
 * Formatting helpers shared by server and client components. Money is always handled as a
 * string of integer minor units (the API's wire format) and never goes through floating point.
 */

const minorDigitsCache = new Map<string, number>();

/** ISO 4217 minor digits (TRY 2, JPY 0, KWD 3), taken from Intl. */
export function minorDigits(currency: string): number {
  let digits = minorDigitsCache.get(currency);
  if (digits === undefined) {
    try {
      digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
    } catch {
      digits = 2;
    }
    minorDigitsCache.set(currency, digits);
  }
  return digits;
}

/** "70000" (TRY) → "700.00"; exact decimal string arithmetic. */
export function minorToDecimal(amount: string, currency: string): string {
  const units = minorDigits(currency);
  const negative = amount.startsWith("-");
  const digits = (negative ? amount.slice(1) : amount).replace(/^0+(?=\d)/, "").padStart(units + 1, "0");
  const body = units ? `${digits.slice(0, -units)}.${digits.slice(-units)}` : digits;
  return negative ? `-${body}` : body;
}

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(key: string, locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  let f = numberFormats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, options);
    numberFormats.set(key, f);
  }
  return f;
}

/** Localized money from minor units. Intl formats the exact decimal string (no float rounding). */
export function formatMoney(amount: string, currency: string, locale: UiLocale): string {
  const f = numberFormat(`money:${locale}:${currency}`, intlLocale(locale), { style: "currency", currency });
  return f.format(minorToDecimal(amount, currency) as Intl.StringNumericLiteral);
}

export function formatNumber(value: number | string, locale: UiLocale, options: Intl.NumberFormatOptions = {}): string {
  const f = numberFormat(`num:${locale}:${JSON.stringify(options)}`, intlLocale(locale), options);
  return f.format(typeof value === "string" ? (value as Intl.StringNumericLiteral) : value);
}

/** Basis points → percent (1234 → "12,3 %"); `signed` adds + for positive deltas. */
export function formatBps(bps: number, locale: UiLocale, opts: { signed?: boolean } = {}): string {
  const f = numberFormat(`bps:${locale}:${opts.signed ? 1 : 0}`, intlLocale(locale), {
    style: "percent",
    maximumFractionDigits: 1,
    ...(opts.signed ? { signDisplay: "exceptZero" as const } : {}),
  });
  return f.format(bps / 10_000);
}

/** Separators the UI language uses for numbers. */
function separators(locale: UiLocale): { group: string; decimal: string } {
  const parts = numberFormat(`sep:${locale}`, intlLocale(locale), {}).formatToParts(12345.6);
  return {
    group: parts.find((p) => p.type === "group")?.value ?? ",",
    decimal: parts.find((p) => p.type === "decimal")?.value ?? ".",
  };
}

/**
 * Parses an amount typed in the UI language's format (tr "1.234,56", en "1,234.56") into minor
 * units. Returns null for anything that isn't a plain amount with at most the currency's digits.
 */
export function parseMoneyInput(text: string, currency: string, locale: UiLocale): string | null {
  const units = minorDigits(currency);
  const { group, decimal } = separators(locale);
  let s = text.trim().replace(/\s| | /g, "");
  if (!s) return null;
  const negative = s.startsWith("-");
  if (negative) s = s.slice(1);
  s = s.split(group).join("");
  const [whole = "", fraction = "", ...rest] = s.split(decimal);
  if (rest.length > 0 || !/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) return null;
  if (!whole && !fraction) return null;
  if (fraction.length > units) return null;
  const minor = `${whole || "0"}${fraction.padEnd(units, "0")}`.replace(/^0+(?=\d)/, "");
  return negative && minor !== "0" ? `-${minor}` : minor;
}

/** Minor units → the editable text for a MoneyInput (no grouping, UI-language decimal separator). */
export function minorToInput(amount: string, currency: string, locale: UiLocale): string {
  const { decimal } = separators(locale);
  return minorToDecimal(amount, currency).replace(".", decimal);
}

export type DateStyle = "date" | "datetime" | "time";

const dateFormats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(locale: UiLocale, timeZone: string, style: DateStyle | "full"): Intl.DateTimeFormat {
  const key = `${locale}:${timeZone}:${style}`;
  let f = dateFormats.get(key);
  if (!f) {
    const options: Intl.DateTimeFormatOptions =
      style === "date"
        ? { day: "numeric", month: "short", year: "numeric" }
        : style === "time"
          ? { hour: "2-digit", minute: "2-digit" }
          : style === "datetime"
            ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
            : { dateStyle: "full", timeStyle: "long" };
    f = new Intl.DateTimeFormat(intlLocale(locale), { ...options, timeZone });
    dateFormats.set(key, f);
  }
  return f;
}

/** Business timestamps are shown in the store's time zone, not the browser's. */
export function formatDateTime(value: string | Date, locale: UiLocale, timeZone: string, style: DateStyle | "full" = "datetime"): string {
  return dateFormat(locale, timeZone, style).format(typeof value === "string" ? new Date(value) : value);
}

/** "12 dk önce" for timestamps within a day of `now`, otherwise null. */
export function formatRelative(value: string | Date, locale: UiLocale, now: number = Date.now()): string | null {
  const diffSeconds = Math.round(((typeof value === "string" ? Date.parse(value) : value.getTime()) - now) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs >= 86_400) return null;
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto", style: "short" });
  if (abs < 60) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSeconds / 60), "minute");
  return rtf.format(Math.round(diffSeconds / 3600), "hour");
}

/** "GMT+3" style offset label of a time zone at a moment. */
export function timeZoneOffsetLabel(timeZone: string, at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? timeZone;
}

/** Offset of `timeZone` from UTC at the instant `utcMs`, in milliseconds. */
function zoneOffsetMs(timeZone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - utcMs;
}

/**
 * Converts a wall-clock time in `timeZone` ("2026-09-24T14:05", as produced by
 * <input type="datetime-local">) to an ISO UTC string. Two passes resolve the offset correctly
 * around daylight-saving transitions.
 */
export function zonedToUtc(local: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local);
  if (!m) return null;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  let utc = wall - zoneOffsetMs(timeZone, wall);
  utc = wall - zoneOffsetMs(timeZone, utc);
  return new Date(utc).toISOString();
}

/** ISO instant → "YYYY-MM-DDTHH:mm" wall-clock value in `timeZone` for a datetime-local input. */
export function utcToZonedInput(iso: string, timeZone: string): string {
  const utc = Date.parse(iso);
  if (Number.isNaN(utc)) return "";
  const shifted = new Date(utc + zoneOffsetMs(timeZone, utc));
  return shifted.toISOString().slice(0, 16);
}
