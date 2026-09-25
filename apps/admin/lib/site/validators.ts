/**
 * The registry number checks of packages/site/src/identity.ts and fields.ts, run in the browser
 * while the merchant types (that package cannot be bundled for the browser: it sits on the
 * database schema). The API runs the same checks on save and stays the authority.
 */

/** Removes the spaces, dots and dashes people type in registry numbers. */
export const stripSeparators = (value: string) => value.replace(/[\s.\-]/g, "");

/** Vergi Kimlik Numarası: 10 digits with the Revenue Administration check digit. */
export function isValidVkn(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const t = (Number(value[i]) + 9 - i) % 10;
    let v = (t * 2 ** (9 - i)) % 9;
    if (t !== 0 && v === 0) v = 9;
    sum += v;
  }
  return (10 - (sum % 10)) % 10 === Number(value[9]);
}

/** T.C. Kimlik Numarası: 11 digits, first non-zero, two check digits. */
export function isValidTckn(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) return false;
  const d = [...value].map(Number);
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const even = d[1]! + d[3]! + d[5]! + d[7]!;
  const tenth = (((odd * 7 - even) % 10) + 10) % 10;
  const eleventh = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return d[9] === tenth && d[10] === eleventh;
}

export function taxNumberKind(value: string): "vkn" | "tckn" | null {
  if (isValidVkn(value)) return "vkn";
  if (isValidTckn(value)) return "tckn";
  return null;
}

export function isValidMersisNo(value: string): boolean {
  return /^\d{16}$/.test(value);
}

/** KEP address: an e-mail address on a kep.tr provider domain. */
export function isValidKepAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && /@(?:[a-z0-9-]+\.)*kep\.tr$/i.test(value);
}

export function normalizePhone(value: string): string {
  const compact = value.trim().replace(/[\s().\-/]/g, "");
  return compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
}

/** E.164 (8–15 digits); Turkish numbers carry a 10-digit national number. */
export function isE164(value: string): boolean {
  if (!/^\+[1-9]\d{7,14}$/.test(value)) return false;
  if (value.startsWith("+90")) return value.length === 13;
  return true;
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname.includes(".");
  } catch {
    return false;
  }
}

/** Turkish postal code: five digits starting with a province plate code (01–81). */
export function isValidTrPostalCode(value: string): boolean {
  return /^(0[1-9]|[1-7]\d|8[01])\d{3}$/.test(value);
}
