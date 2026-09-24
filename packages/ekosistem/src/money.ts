import { z } from "zod";

/**
 * Money on the wire (§6.1): `{ "amount": "24990", "currency": "TRY" }`, minor units as an
 * integer string, may be negative, never "-0". Conversion from decimals rounds half away
 * from zero on the decimal text itself; floating-point multiplication is never used.
 */

const MINOR_RE = /^-?(0|[1-9]\d*)$/;
const DECIMAL_RE = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d{1,4}))?$/;

export function isMinorAmountString(value: string): boolean {
  return MINOR_RE.test(value) && value !== "-0";
}

export const minorAmountSchema = z.string().max(40).refine(isMinorAmountString, { message: "minor-unit integer string expected" });

/** ISO 4217 code; the common "TL" spelling is accepted and normalised to TRY. */
export function normalizeCurrencyCode(value: string): string {
  const upper = value.trim().toUpperCase();
  return upper === "TL" ? "TRY" : upper;
}

export const currencyCodeSchema = z
  .string()
  .max(8)
  .transform(normalizeCurrencyCode)
  .pipe(z.string().regex(/^[A-Z]{3}$/, "ISO 4217 currency code expected"));

export const wireMoneySchema = z.object({ amount: minorAmountSchema, currency: currencyCodeSchema });
export type WireMoney = z.infer<typeof wireMoneySchema>;

/** Minor units → wire string. bigint has no negative zero, so "-0" cannot be produced. */
export function toMinorString(amount: bigint): string {
  return amount.toString();
}

export function parseMinorString(value: string): bigint {
  if (!isMinorAmountString(value)) throw new Error(`invalid minor-unit amount: ${JSON.stringify(value)}`);
  return BigInt(value);
}

export function wireMoney(amount: bigint, currency: string): WireMoney {
  return { amount: toMinorString(amount), currency: normalizeCurrencyCode(currency) };
}

export function wireMoneyOrNull(amount: bigint | null | undefined, currency: string): WireMoney | null {
  return amount === null || amount === undefined ? null : wireMoney(amount, currency);
}

/**
 * Decimal (major units) → minor-unit string with `fractionDigits` decimals, rounding half
 * away from zero on the digits. Accepts decimal strings (and JS numbers via their shortest
 * decimal representation, never by multiplying the float). Throws on anything else.
 *
 *   1.005 → "101", -12.345 → "-1235", 249.9 → "24990", -0.004 → "0", 0.005 → "1"
 */
export function decimalToMinor(value: string | number, fractionDigits = 2): string {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("decimal must be finite");
    text = String(value);
  } else {
    text = value.trim();
  }
  const m = DECIMAL_RE.exec(text);
  if (!m || (!m[2] && !m[3])) throw new Error(`invalid decimal: ${JSON.stringify(value)}`);
  const negative = m[1] === "-";
  const intDigits = m[2] ?? "";
  const fracDigits = m[3] ?? "";
  const exponent = m[4] ? Number(m[4]) : 0;
  const digits = `${intDigits}${fracDigits}`;
  // Position of the decimal point within `digits` after applying the exponent and scaling.
  const point = intDigits.length + exponent + fractionDigits;
  let whole: string;
  let rest: string;
  if (point <= 0) {
    whole = "0";
    rest = "0".repeat(-point) + digits;
  } else if (point >= digits.length) {
    whole = digits + "0".repeat(point - digits.length);
    rest = "";
  } else {
    whole = digits.slice(0, point);
    rest = digits.slice(point);
  }
  let magnitude = BigInt(whole === "" ? "0" : whole);
  if (rest !== "" && rest.charCodeAt(0) >= 53 /* "5" */) magnitude += 1n;
  if (magnitude === 0n) return "0";
  return negative ? `-${magnitude}` : magnitude.toString();
}

export function decimalToMinorBigInt(value: string | number, fractionDigits = 2): bigint {
  return BigInt(decimalToMinor(value, fractionDigits));
}

/** A ratio (0.8) → basis points (8000), rounded half away from zero on the decimal text. */
export function ratioToBps(value: string | number): number {
  return Number(decimalToMinor(value, 4));
}

/** §6.1 conversion vectors. */
export const MONEY_VECTORS: ReadonlyArray<readonly [string, string]> = [
  ["1.005", "101"],
  ["-12.345", "-1235"],
  ["249.9", "24990"],
  ["-0.004", "0"],
  ["0.005", "1"],
];

/** Throws when decimal → minor conversion disagrees with the §6.1 vectors. */
export function assertMoneyVectors(): void {
  for (const [input, expected] of MONEY_VECTORS) {
    const got = decimalToMinor(input);
    if (got !== expected) throw new Error(`ekosistem money vector failed: ${input} → ${got}, expected ${expected}`);
    // Number inputs go through their decimal text, so they must agree with the string form.
    const fromNumber = decimalToMinor(Number(input));
    if (fromNumber !== expected) throw new Error(`ekosistem money vector failed for number ${input} → ${fromNumber}, expected ${expected}`);
  }
  if (toMinorString(-0n) !== "0") throw new Error("ekosistem money vector failed: negative zero must serialise as \"0\"");
  if (isMinorAmountString("-0")) throw new Error("ekosistem money vector failed: \"-0\" must be rejected");
}
