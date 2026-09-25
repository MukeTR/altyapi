"use client";

import { CalendarPlus, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { LocalizedTextField } from "@/components/ui/localized-text-field";
import { cn } from "@/lib/cn";
import { WEEKDAYS, type OpeningHours, type Weekday } from "@/lib/site/types";

export function emptyOpeningHours(): OpeningHours {
  return { weekly: [], specialDays: [], byAppointment: false };
}

/** Drops blank label and note languages so the API only gets texts that were written. */
export function cleanOpeningHours(h: OpeningHours): OpeningHours {
  const text = (m: Record<string, string> | undefined) => {
    const out = Object.fromEntries(Object.entries(m ?? {}).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
    return Object.keys(out).length ? out : undefined;
  };
  const note = text(h.note);
  return {
    weekly: h.weekly,
    specialDays: h.specialDays.map((d) => {
      const label = text(d.label);
      return { from: d.from, to: d.to || d.from, closed: d.closed, hours: d.closed ? [] : d.hours, ...(label ? { label } : {}) };
    }),
    byAppointment: h.byAppointment,
    ...(note ? { note } : {}),
  };
}

function minutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** Local check of one interval: closing must differ from opening (00:00–00:00 is around the clock). */
function emptyInterval(opens: string, closes: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(opens) || !/^\d{2}:\d{2}$/.test(closes)) return false;
  return opens === closes && minutes(opens) !== 0;
}

/**
 * Opening hours: weekly rows (days + opening and closing time; a closing time before the opening
 * time runs past midnight), special days (holidays, closures, changed hours for a date range),
 * "by appointment" and a note. `errorAt` returns the API's message for a path below the value
 * ("weekly.0.closes", "specialDays.1.from").
 */
export function OpeningHoursEditor({
  value,
  onChange,
  locales,
  defaultLocale,
  errorAt,
  disabled,
  idPrefix,
}: {
  value: OpeningHours;
  onChange: (h: OpeningHours) => void;
  locales: readonly string[];
  defaultLocale: string;
  errorAt: (path: string) => string | undefined;
  disabled?: boolean;
  idPrefix: string;
}) {
  const { t } = useI18n();
  const setWeekly = (weekly: OpeningHours["weekly"]) => onChange({ ...value, weekly });
  const setSpecial = (specialDays: OpeningHours["specialDays"]) => onChange({ ...value, specialDays });
  const rowError = (i: number) => errorAt(`weekly.${i}.closes`) ?? errorAt(`weekly.${i}.opens`) ?? errorAt(`weekly.${i}.days`) ?? errorAt(`weekly.${i}`);
  const usedDays = new Set(value.weekly.flatMap((r) => r.days));

  return (
    <div className="flex flex-col gap-5">
      <Checkbox
        checked={value.byAppointment}
        disabled={disabled}
        onCheckedChange={(v) => onChange({ ...value, byAppointment: v })}
        label={t("site.hours.byAppointment")}
        description={t("site.hours.byAppointmentHint")}
      />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-base font-medium text-fg">{t("site.hours.weekly")}</legend>
        {value.weekly.length === 0 ? <p className="text-sm text-fg-muted">{t("site.hours.noWeekly")}</p> : null}
        <ul className="flex flex-col gap-3">
          {value.weekly.map((row, i) => {
            const localError = emptyInterval(row.opens, row.closes) ? t("site.hours.emptyInterval") : row.days.length === 0 ? t("site.hours.chooseDays") : null;
            const error = localError ?? rowError(i);
            return (
              <li key={i} className={cn("flex flex-col gap-2 rounded-md border p-3", error ? "border-danger" : "border-border")}>
                <div role="group" aria-label={t("site.hours.rowDays", { n: i + 1 })} className="flex flex-wrap gap-1">
                  {WEEKDAYS.map((d) => {
                    const on = row.days.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        disabled={disabled}
                        aria-pressed={on}
                        aria-label={t(`site.hours.days.${d}`)}
                        onClick={() => setWeekly(value.weekly.map((r, j) => (j === i ? { ...r, days: on ? r.days.filter((x) => x !== d) : WEEKDAYS.filter((x) => x === d || r.days.includes(x)) } : r)))}
                        className={cn(
                          "inline-flex h-8 min-w-11 items-center justify-center rounded-md border px-2 text-sm font-medium",
                          on ? "border-accent bg-accent-subtle text-accent-subtle-fg" : "border-border-control bg-surface text-fg-muted hover:bg-surface-muted",
                        )}
                      >
                        {t(`site.hours.daysShort.${d}`)}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <Field id={`${idPrefix}-w${i}-opens`} label={t("site.hours.opens")} className="w-32">
                    <Input type="time" value={row.opens} disabled={disabled} onChange={(e) => setWeekly(value.weekly.map((r, j) => (j === i ? { ...r, opens: e.target.value } : r)))} />
                  </Field>
                  <Field id={`${idPrefix}-w${i}-closes`} label={t("site.hours.closes")} className="w-32">
                    <Input type="time" value={row.closes} disabled={disabled} onChange={(e) => setWeekly(value.weekly.map((r, j) => (j === i ? { ...r, closes: e.target.value } : r)))} />
                  </Field>
                  {row.opens && row.closes && minutes(row.closes) < minutes(row.opens) ? <span className="pb-2 text-xs text-fg-muted">{t("site.hours.pastMidnight")}</span> : null}
                  {row.opens === "00:00" && row.closes === "00:00" ? <span className="pb-2 text-xs text-fg-muted">{t("site.hours.allDay")}</span> : null}
                  <Button size="icon-md" variant="ghost" className="ms-auto" disabled={disabled} aria-label={t("site.hours.removeRow", { n: i + 1 })} onClick={() => setWeekly(value.weekly.filter((_, j) => j !== i))}>
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
                {error ? (
                  <p role="alert" className="text-sm text-danger">
                    {error}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
        {errorAt("weekly") ? <p className="text-sm text-danger">{errorAt("weekly")}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={disabled || value.weekly.length >= 21}
            onClick={() => setWeekly([...value.weekly, { days: WEEKDAYS.filter((d) => !usedDays.has(d)).slice(0, 5) as Weekday[], opens: "09:00", closes: "18:00" }])}
          >
            <Plus aria-hidden="true" />
            {t("site.hours.addRow")}
          </Button>
          {value.weekly.length === 0 ? (
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setWeekly([{ days: ["mon", "tue", "wed", "thu", "fri"], opens: "09:00", closes: "18:00" }, { days: ["sat"], opens: "10:00", closes: "14:00" }])}>
              {t("site.hours.preset")}
            </Button>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-base font-medium text-fg">{t("site.hours.special")}</legend>
        <p className="-mt-1 text-sm text-fg-muted">{t("site.hours.specialHint")}</p>
        <ul className="flex flex-col gap-3">
          {value.specialDays.map((d, i) => {
            const set = (patch: Partial<OpeningHours["specialDays"][number]>) => setSpecial(value.specialDays.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            const error = (d.to && d.from && d.to < d.from ? t("site.hours.rangeReversed") : null) ?? errorAt(`specialDays.${i}.from`) ?? errorAt(`specialDays.${i}.to`) ?? errorAt(`specialDays.${i}.hours`) ?? errorAt(`specialDays.${i}`);
            return (
              <li key={i} className={cn("flex flex-col gap-3 rounded-md border p-3", error ? "border-danger" : "border-border")}>
                <div className="flex flex-wrap items-end gap-3">
                  <Field id={`${idPrefix}-s${i}-from`} label={t("site.hours.from")} className="w-40">
                    <Input type="date" value={d.from} disabled={disabled} onChange={(e) => set({ from: e.target.value, ...(d.to && d.to >= e.target.value ? {} : { to: e.target.value }) })} />
                  </Field>
                  <Field id={`${idPrefix}-s${i}-to`} label={t("site.hours.to")} className="w-40">
                    <Input type="date" value={d.to} min={d.from || undefined} disabled={disabled} onChange={(e) => set({ to: e.target.value })} />
                  </Field>
                  <Checkbox checked={d.closed} disabled={disabled} onCheckedChange={(v) => set({ closed: v, hours: v ? [] : d.hours.length ? d.hours : [{ opens: "10:00", closes: "16:00" }] })} label={t("site.hours.closed")} className="pb-1.5" />
                  <Button size="icon-md" variant="ghost" className="ms-auto" disabled={disabled} aria-label={t("site.hours.removeSpecial", { n: i + 1 })} onClick={() => setSpecial(value.specialDays.filter((_, j) => j !== i))}>
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
                {!d.closed ? (
                  <div className="flex flex-col gap-2">
                    {d.hours.map((h, k) => (
                      <div key={k} className="flex flex-wrap items-end gap-3">
                        <Field id={`${idPrefix}-s${i}-h${k}-opens`} label={t("site.hours.opens")} className="w-32">
                          <Input type="time" value={h.opens} disabled={disabled} onChange={(e) => set({ hours: d.hours.map((x, m) => (m === k ? { ...x, opens: e.target.value } : x)) })} />
                        </Field>
                        <Field id={`${idPrefix}-s${i}-h${k}-closes`} label={t("site.hours.closes")} className="w-32">
                          <Input type="time" value={h.closes} disabled={disabled} onChange={(e) => set({ hours: d.hours.map((x, m) => (m === k ? { ...x, closes: e.target.value } : x)) })} />
                        </Field>
                        {d.hours.length > 1 ? (
                          <Button size="icon-md" variant="ghost" disabled={disabled} aria-label={t("site.hours.removeInterval", { n: k + 1 })} onClick={() => set({ hours: d.hours.filter((_, m) => m !== k) })}>
                            <Trash2 aria-hidden="true" />
                          </Button>
                        ) : null}
                      </div>
                    ))}
                    {d.hours.length < 4 ? (
                      <Button size="sm" variant="ghost" className="self-start" disabled={disabled} onClick={() => set({ hours: [...d.hours, { opens: "14:00", closes: "18:00" }] })}>
                        <Plus aria-hidden="true" />
                        {t("site.hours.addInterval")}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                <LocalizedTextField
                  label={t("site.hours.label")}
                  description={t("site.hours.labelHint")}
                  locales={locales}
                  defaultLocale={defaultLocale}
                  value={(d.label ?? {}) as Record<string, string>}
                  maxLength={80}
                  disabled={disabled}
                  onChange={(label) => set({ label })}
                />
                {error ? (
                  <p role="alert" className="text-sm text-danger">
                    {error}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
        <Button
          size="sm"
          className="self-start"
          disabled={disabled || value.specialDays.length >= 120}
          onClick={() => {
            const today = new Date().toISOString().slice(0, 10);
            setSpecial([...value.specialDays, { from: today, to: today, closed: true, hours: [] }]);
          }}
        >
          <CalendarPlus aria-hidden="true" />
          {t("site.hours.addSpecial")}
        </Button>
      </fieldset>

      <LocalizedTextField
        label={t("site.hours.note")}
        description={t("site.hours.noteHint")}
        locales={locales}
        defaultLocale={defaultLocale}
        value={(value.note ?? {}) as Record<string, string>}
        maxLength={300}
        multiline
        disabled={disabled}
        onChange={(note) => onChange({ ...value, note })}
      />
    </div>
  );
}
