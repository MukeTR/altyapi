import { z } from "zod";
import type { OpeningHours, Weekday } from "@altyapi/database";
import { localizedText } from "./fields";

/**
 * Opening hours of a location (schema.org OpeningHoursSpecification). Times are HH:MM in the
 * store timezone. An interval whose closing time is not after its opening time runs past
 * midnight ("18:00"–"02:00"); "00:00"–"00:00" means open around the clock.
 */

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const satisfies readonly Weekday[];

const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;
const MAX_SPECIAL_DAYS = 200;
const MAX_SPECIAL_RANGE_DAYS = 366;

const clockTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, { error: "errors.site.hours.invalid_time" });

function minutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** Length of an interval in minutes, following the past-midnight and around-the-clock conventions. */
function span(opens: string, closes: string): number {
  const o = minutes(opens);
  const c = minutes(closes);
  if (c > o) return c - o;
  if (c === o) return o === 0 ? MINUTES_PER_DAY : 0;
  return MINUTES_PER_DAY - o + c;
}

interface Interval {
  start: number;
  end: number;
}

/** True when two intervals on a circular timeline of `period` minutes overlap. */
function overlaps(intervals: Interval[], period: number): boolean {
  const pieces: Interval[] = [];
  for (const i of intervals) {
    if (i.end <= period) pieces.push(i);
    else pieces.push({ start: i.start, end: period }, { start: 0, end: i.end - period });
  }
  pieces.sort((a, b) => a.start - b.start);
  for (let k = 1; k < pieces.length; k++) if (pieces[k]!.start < pieces[k - 1]!.end) return true;
  return false;
}

const interval = z
  .strictObject({ opens: clockTime, closes: clockTime })
  .refine((i) => span(i.opens, i.closes) > 0, { error: "errors.site.hours.empty_interval", path: ["closes"] });

const weeklyRow = z
  .strictObject({
    days: z
      .array(z.enum(WEEKDAYS))
      .min(1)
      .max(7)
      .refine((d) => new Set(d).size === d.length, { error: "errors.site.hours.duplicate_day" }),
    opens: clockTime,
    closes: clockTime,
  })
  .refine((r) => span(r.opens, r.closes) > 0, { error: "errors.site.hours.empty_interval", path: ["closes"] });

/** Calendar date YYYY-MM-DD, as a day number for range arithmetic. */
function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

const specialDay = z
  .strictObject({
    from: z.iso.date({ error: "errors.site.hours.invalid_date" }),
    to: z.iso.date({ error: "errors.site.hours.invalid_date" }),
    closed: z.boolean(),
    hours: z.array(interval).max(6).default([]),
    label: localizedText(80).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.to < d.from) ctx.addIssue({ code: "custom", path: ["to"], message: "errors.site.hours.range_reversed" });
    else if (dayNumber(d.to) - dayNumber(d.from) >= MAX_SPECIAL_RANGE_DAYS) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "errors.site.hours.range_too_long" });
    }
    if (d.closed && d.hours.length) ctx.addIssue({ code: "custom", path: ["hours"], message: "errors.site.hours.closed_with_hours" });
    if (!d.closed && !d.hours.length) ctx.addIssue({ code: "custom", path: ["hours"], message: "errors.site.hours.open_without_hours" });
    const day = d.hours.map((h) => ({ start: minutes(h.opens), end: minutes(h.opens) + span(h.opens, h.closes) }));
    // Intervals of one day may run past midnight but must not overlap each other.
    if (overlaps(day, MINUTES_PER_DAY * 2)) ctx.addIssue({ code: "custom", path: ["hours"], message: "errors.site.hours.overlap" });
  });

export const openingHoursSchema = z
  .strictObject({
    weekly: z.array(weeklyRow).max(28).default([]),
    specialDays: z.array(specialDay).max(MAX_SPECIAL_DAYS).default([]),
    /** Visits by appointment only ("randevu ile"), with or without regular hours. */
    byAppointment: z.boolean().default(false),
    note: localizedText(300).optional(),
  })
  .superRefine((h, ctx) => {
    const week = h.weekly.flatMap((row) =>
      row.days.map((day) => {
        const start = WEEKDAYS.indexOf(day) * MINUTES_PER_DAY + minutes(row.opens);
        return { start, end: start + span(row.opens, row.closes) };
      }),
    );
    // Sunday night intervals wrap into Monday morning.
    if (overlaps(week, MINUTES_PER_WEEK)) ctx.addIssue({ code: "custom", path: ["weekly"], message: "errors.site.hours.overlap" });
    const ranges = h.specialDays.map((d, index) => ({ index, from: d.from, to: d.to })).sort((a, b) => a.from.localeCompare(b.from));
    for (let k = 1; k < ranges.length; k++) {
      if (ranges[k]!.from <= ranges[k - 1]!.to) {
        ctx.addIssue({ code: "custom", path: ["specialDays", ranges[k]!.index, "from"], message: "errors.site.hours.special_days_overlap" });
      }
    }
  }) satisfies z.ZodType<OpeningHours>;

export type OpeningHoursInput = z.input<typeof openingHoursSchema>;

/** Stored value of a location without published hours. */
export const EMPTY_OPENING_HOURS: OpeningHours = { weekly: [], specialDays: [], byAppointment: false };
