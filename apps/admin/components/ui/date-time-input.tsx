"use client";

import { useId, useMemo } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useOptionalStore } from "@/components/providers/store-provider";
import { timeZoneOffsetLabel, utcToZonedInput, zonedToUtc } from "@/lib/format";
import { useFieldControl } from "./field";
import { controlClasses } from "./input-styles";

export interface DateTimeInputProps {
  /** ISO UTC instant or null. */
  value: string | null;
  onChange: (iso: string | null) => void;
  /** Wall-clock zone of the input; defaults to the store's time zone. */
  timeZone?: string;
  /** Hidden input with the ISO value for form submissions. */
  name?: string;
  min?: string;
  disabled?: boolean;
  id?: string;
}

/** Date and time entered in the store's time zone (shown next to the field) and sent as UTC. */
export function DateTimeInput({ value, onChange, timeZone, name, disabled, id }: DateTimeInputProps) {
  const { t } = useI18n();
  const store = useOptionalStore();
  const field = useFieldControl(id);
  const tzId = useId();
  const zone = timeZone ?? store?.store.timezone ?? "UTC";
  const local = value ? utcToZonedInput(value, zone) : "";
  const offset = useMemo(() => timeZoneOffsetLabel(zone, value ? new Date(value) : new Date()), [zone, value]);
  const describedBy = [field?.["aria-describedby"], tzId].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-1">
      <input
        type="datetime-local"
        id={field?.id ?? id}
        value={local}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value ? zonedToUtc(e.target.value, zone) : null)}
        aria-describedby={describedBy}
        aria-invalid={field?.["aria-invalid"]}
        aria-required={field?.["aria-required"]}
        className={controlClasses({ invalid: field?.["aria-invalid"] === true, className: "tabular" })}
      />
      <p id={tzId} className="text-xs text-fg-subtle">
        {t("ui.datetime.timezone", { timezone: zone, offset })}
      </p>
      {name ? <input type="hidden" name={name} value={value ?? ""} /> : null}
    </div>
  );
}
