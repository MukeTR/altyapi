/**
 * Exact minor-unit arithmetic for price, VAT and margin hints (BigInt, never floats). Rounding
 * is half-up to the minor unit, like the checkout's tax calculation.
 */

function divRound(n: bigint, d: bigint): bigint {
  if (d === 0n) return 0n;
  const q = n / d;
  const r = n % d;
  return r * 2n >= d ? q + 1n : q;
}

/** VAT contained in (or added to) a price for a rate in basis points. */
export function vatBreakdown(price: string, rateBps: number, pricesIncludeTax: boolean): { net: string; vat: string; gross: string } {
  const p = BigInt(price);
  const rate = BigInt(rateBps);
  if (pricesIncludeTax) {
    const net = divRound(p * 10_000n, 10_000n + rate);
    return { net: net.toString(), vat: (p - net).toString(), gross: p.toString() };
  }
  const vat = divRound(p * rate, 10_000n);
  return { net: p.toString(), vat: vat.toString(), gross: (p + vat).toString() };
}

/** Margin of a selling price over a cost in basis points (as the API reports it); null when unknown. */
export function marginBps(price: string | null, cost: string | null): number | null {
  if (price === null || cost === null) return null;
  const p = BigInt(price);
  if (p <= 0n) return null;
  return Number(((p - BigInt(cost)) * 10_000n) / p);
}

/** price − cost, as a minor-unit string. */
export function profit(price: string | null, cost: string | null): string | null {
  if (price === null || cost === null) return null;
  return (BigInt(price) - BigInt(cost)).toString();
}
