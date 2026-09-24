import { z } from "zod";

/**
 * Money is always an integer amount in the currency's minor unit plus an ISO 4217 code.
 * Floats are never used for monetary values anywhere in the platform.
 */
export interface Money {
  amount: bigint;
  currency: string;
}

const MINOR_UNITS: Record<string, number> = {
  TRY: 2, USD: 2, EUR: 2, GBP: 2, JPY: 0, KWD: 3, BHD: 3,
};

export function minorUnits(currency: string): number {
  return MINOR_UNITS[currency] ?? 2;
}

export const currencySchema = z.string().regex(/^[A-Z]{3}$/, "ISO 4217 currency code expected");

/** Wire format: amounts serialized as integer strings to survive JSON without precision loss. */
export const moneySchema = z.object({
  amount: z.union([z.string().regex(/^-?\d+$/), z.number().int()]).transform((v) => BigInt(v)),
  currency: currencySchema,
});

export function money(amount: bigint | number, currency: string): Money {
  if (typeof amount === "number" && !Number.isInteger(amount)) {
    throw new Error("Money amounts must be integers in minor units");
  }
  return { amount: BigInt(amount), currency };
}

function assertSameCurrency(a: Money, b: Money) {
  if (a.currency !== b.currency) throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount - b.amount, currency: a.currency };
}

export function multiply(a: Money, quantity: number | bigint): Money {
  return { amount: a.amount * BigInt(quantity), currency: a.currency };
}

export function isZero(a: Money): boolean {
  return a.amount === 0n;
}

export function max(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return a.amount >= b.amount ? a : b;
}

export function min(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return a.amount <= b.amount ? a : b;
}

/**
 * Percentage of an amount using basis points (1% = 100 bps) with half-up rounding,
 * so discounts are deterministic and never touch floating point.
 */
export function percentageOf(a: Money, basisPoints: number): Money {
  if (!Number.isInteger(basisPoints)) throw new Error("basisPoints must be an integer");
  const numerator = a.amount * BigInt(basisPoints);
  const q = numerator / 10000n;
  const r = numerator % 10000n;
  const rounded = r * 2n >= 10000n ? q + 1n : r * 2n <= -10000n ? q - 1n : q;
  return { amount: rounded, currency: a.currency };
}

/**
 * Splits an amount across weights using largest-remainder so the parts always sum
 * exactly to the original amount (used for allocating order-level discounts to lines).
 */
export function allocate(total: Money, weights: bigint[]): Money[] {
  const sum = weights.reduce((s, w) => s + w, 0n);
  if (sum === 0n) return weights.map(() => ({ amount: 0n, currency: total.currency }));
  const raw = weights.map((w) => (total.amount * w) / sum);
  let remainder = total.amount - raw.reduce((s, v) => s + v, 0n);
  const order = weights
    .map((w, i) => ({ i, frac: (total.amount * w) % sum }))
    .sort((a, b) => (b.frac > a.frac ? 1 : b.frac < a.frac ? -1 : a.i - b.i));
  for (const { i } of order) {
    if (remainder === 0n) break;
    raw[i] = raw[i]! + (remainder > 0n ? 1n : -1n);
    remainder += remainder > 0n ? -1n : 1n;
  }
  return raw.map((amount) => ({ amount, currency: total.currency }));
}

export function toWire(m: Money): { amount: string; currency: string } {
  return { amount: m.amount.toString(), currency: m.currency };
}

/** Converts to a decimal string ("129.90") for provider APIs that expect major units. */
export function toDecimalString(m: Money): string {
  const units = minorUnits(m.currency);
  const negative = m.amount < 0n;
  const abs = negative ? -m.amount : m.amount;
  if (units === 0) return `${negative ? "-" : ""}${abs}`;
  const s = abs.toString().padStart(units + 1, "0");
  return `${negative ? "-" : ""}${s.slice(0, -units)}.${s.slice(-units)}`;
}

/** Parses a provider decimal string back into minor units without floating point. */
export function fromDecimalString(value: string, currency: string): Money {
  const units = minorUnits(currency);
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new Error(`Invalid decimal amount: ${value}`);
  const frac = (m[3] ?? "").padEnd(units, "0");
  if (frac.length > units && /[^0]/.test(frac.slice(units))) {
    throw new Error(`Amount ${value} has more precision than ${currency} allows`);
  }
  const amount = BigInt(`${m[2]}${frac.slice(0, units)}`);
  return { amount: m[1] ? -amount : amount, currency };
}
