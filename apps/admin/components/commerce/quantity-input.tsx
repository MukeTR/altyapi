"use client";

import { Minus, Plus } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "@/components/ui/button";
import { controlClasses } from "@/components/ui/input-styles";

/** Integer stepper bounded by min/max, with buttons and direct typing. */
export function QuantityInput({ value, onChange, min = 0, max, label, disabled, id }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label: string; disabled?: boolean; id?: string }) {
  const { t } = useI18n();
  const clamp = (n: number) => Math.max(min, max === undefined ? n : Math.min(max, n));
  return (
    <div className="inline-flex items-center gap-1">
      <Button size="icon-sm" variant="secondary" disabled={disabled || value <= min} onClick={() => onChange(clamp(value - 1))} aria-label={t("commerce.quantity.decrease", { name: label })}>
        <Minus aria-hidden="true" />
      </Button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => {
          const n = Number.parseInt(e.target.value, 10);
          onChange(Number.isNaN(n) ? min : clamp(n));
        }}
        className={controlClasses({ size: "sm", className: "w-16 text-center tabular" })}
      />
      <Button size="icon-sm" variant="secondary" disabled={disabled || (max !== undefined && value >= max)} onClick={() => onChange(clamp(value + 1))} aria-label={t("commerce.quantity.increase", { name: label })}>
        <Plus aria-hidden="true" />
      </Button>
    </div>
  );
}
