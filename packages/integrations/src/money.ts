import { minorUnits } from "@altyapi/commerce-core";

/**
 * Converts a provider amount (JSON number or decimal string, major units) to minor units,
 * rounding half-up on the decimal digits so float noise such as 8.899999 never leaks in.
 */
export function toMinor(value: unknown, currency: string): bigint | null {
  if (value === null || value === undefined || value === "") return null;
  const units = minorUnits(currency);
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    text = value.toFixed(units + 2);
  } else if (typeof value === "string") {
    text = value.trim().replace(",", ".");
  } else {
    return null;
  }
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return null;
  const frac = (m[3] ?? "").padEnd(units + 1, "0");
  let amount = BigInt(`${m[2]}${frac.slice(0, units)}`);
  if (Number(frac[units]) >= 5) amount += 1n;
  return m[1] ? -amount : amount;
}
