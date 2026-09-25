"use client";

import { Label } from "radix-ui";
import { CircleAlert } from "lucide-react";
import { createContext, useContext, useId, type ReactNode } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { cn } from "@/lib/cn";

export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
}

const FieldContext = createContext<FieldControlProps | null>(null);

/** Props a control inside <Field> should spread (id, described-by, invalid, required). */
export function useFieldControl(explicitId?: string): FieldControlProps | null {
  const ctx = useContext(FieldContext);
  if (!ctx) return null;
  return explicitId ? { ...ctx, id: explicitId } : ctx;
}

export interface FieldProps {
  label: ReactNode;
  description?: ReactNode;
  /** Error message; marks the control invalid and is announced with it. */
  error?: string | null;
  required?: boolean;
  /** Shows "(optional)" next to the label. */
  optional?: boolean;
  /** Visually hides the label (it is still announced). */
  hideLabel?: boolean;
  /** Use a fixed id for the control (e.g. to link from an error summary). */
  id?: string;
  className?: string;
  /** Rendered after the label on the same line (e.g. a counter or a link). */
  labelAside?: ReactNode;
  children: ReactNode;
}

/** Label + control + description + error, wired together for assistive technology. */
export function Field({ label, description, error, required, optional, hideLabel, id, className, labelAside, children }: FieldProps) {
  const { t } = useI18n();
  const autoId = useId();
  const controlId = id ?? `f${autoId}`;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
  const control: FieldControlProps = {
    id: controlId,
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
    ...(error ? { "aria-invalid": true as const } : {}),
    ...(required ? { "aria-required": true as const } : {}),
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className={cn("flex items-baseline justify-between gap-2", hideLabel && "sr-only")}>
        <Label.Root htmlFor={controlId} className="text-base font-medium text-fg">
          {label}
          {required ? <span className="ms-1 text-sm font-normal text-fg-subtle">({t("common.required")})</span> : null}
          {optional && !required ? <span className="ms-1 text-sm font-normal text-fg-subtle">({t("common.optional")})</span> : null}
        </Label.Root>
        {labelAside}
      </div>
      <FieldContext.Provider value={control}>{children}</FieldContext.Provider>
      {description ? (
        <p id={descriptionId} className="text-sm text-fg-muted">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="flex items-start gap-1.5 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
