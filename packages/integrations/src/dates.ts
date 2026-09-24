/**
 * Date helpers for Turkish providers whose APIs use local (Europe/Istanbul, UTC+3, no DST)
 * wall-clock times without an offset.
 */
const TR_OFFSET_MS = 3 * 60 * 60 * 1000;

/** "2026-09-24T13:05:00" in Istanbul time. */
export function toIstanbulLocal(date: Date): string {
  return new Date(date.getTime() + TR_OFFSET_MS).toISOString().slice(0, 19);
}

/** Parses ISO (with or without offset; no offset = Istanbul) or dd.MM.yyyy[ HH:mm[:ss]]. */
export function parseProviderDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? new Date(value) : null;
  if (typeof value !== "string") return null;
  const s = value.trim();
  const tr = /^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (tr) {
    const [, d, m, y, hh = "00", mm = "00", ss = "00"] = tr;
    return new Date(Date.parse(`${y}-${m}-${d}T${hh}:${mm}:${ss}+03:00`));
  }
  const ms = /\/Date\((-?\d+)(?:[+-]\d{4})?\)\//.exec(s);
  if (ms) return new Date(Number(ms[1]));
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(s);
  const parsed = Date.parse(hasZone || !/T|\d{2}:\d{2}/.test(s) ? s : `${s.replace(" ", "T")}+03:00`);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}
