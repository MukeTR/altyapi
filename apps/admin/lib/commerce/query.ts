import { zonedToUtc } from "@/lib/format";

/** A search parameter as a single trimmed string ("" when absent). */
export function param(sp: Record<string, string | string[] | undefined>, key: string): string {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

/** One of the allowed values, else undefined (unknown values in a shared URL are ignored). */
export function oneOf<T extends string>(value: string, allowed: readonly T[]): T | undefined {
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Converts a calendar day chosen in the store's time zone into the UTC instant of its start
 * (or of the next day's start for an inclusive end date).
 */
export function dayBoundary(day: string, timeZone: string, edge: "start" | "end"): string | undefined {
  if (!DAY.test(day)) return undefined;
  if (edge === "start") return zonedToUtc(`${day}T00:00`, timeZone) ?? undefined;
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return zonedToUtc(`${d.toISOString().slice(0, 10)}T00:00`, timeZone) ?? undefined;
}

/** Today's date (YYYY-MM-DD) in a time zone. */
export function todayIn(timeZone: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Adds days to a YYYY-MM-DD date. */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
