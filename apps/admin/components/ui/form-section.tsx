"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { cn } from "@/lib/cn";
import { Button } from "./button";
import { InlineAlert } from "./inline-alert";

export interface FormSectionProps {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Called with the submit event (default already prevented). */
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  pending?: boolean;
  /** Controlled dirty state; when omitted, any input or change event marks the section dirty. */
  dirty?: boolean;
  /** Called by Cancel; uncontrolled sections are reset to their initial values. */
  onCancel?: () => void;
  /** False hides Save/Cancel and disables the fields (user lacks write permission). */
  canEdit?: boolean;
  /** Error summary or form-level error, shown above the fields. */
  error?: ReactNode;
  saveLabel?: ReactNode;
  className?: string;
}

/**
 * One settings row: title and description on the left (from lg), fields in a card on the right.
 * Each section saves independently; ⌘S / Ctrl+S submits the section that has focus, and leaving
 * the page with unsaved changes asks for confirmation.
 */
export function FormSection({ title, description, children, onSubmit, pending, dirty, onCancel, canEdit = true, error, saveLabel, className }: FormSectionProps) {
  const { t } = useI18n();
  const titleId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [touched, setTouched] = useState(false);
  const isDirty = dirty ?? touched;

  useEffect(() => {
    if (!isDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  // Uncontrolled sections become clean again once a save finishes.
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && dirty === undefined && !error) setTouched(false);
    wasPending.current = Boolean(pending);
  }, [pending, dirty, error]);

  return (
    <section aria-labelledby={titleId} className={cn("grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-8", className)}>
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className="text-md font-semibold text-fg">
          {title}
        </h2>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
      </div>
      <form
        ref={formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!canEdit || pending) return;
          onSubmit(e);
        }}
        onInput={() => setTouched(true)}
        onChange={() => setTouched(true)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            if (canEdit && !pending) formRef.current?.requestSubmit();
          }
        }}
        className="min-w-0 rounded-lg border border-border bg-surface"
      >
        <fieldset disabled={!canEdit || pending} className="flex min-w-0 flex-col gap-4 p-5">
          {error}
          {children}
        </fieldset>
        {canEdit ? (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <Button
              disabled={!isDirty || pending}
              onClick={() => {
                if (onCancel) onCancel();
                else formRef.current?.reset();
                setTouched(false);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={pending ?? false} disabled={!isDirty}>
              {saveLabel ?? t("common.save")}
            </Button>
          </div>
        ) : null}
      </form>
    </section>
  );
}

export interface ErrorSummaryItem {
  /** id of the control to focus. */
  fieldId: string;
  message: string;
  label?: string;
}

/**
 * Shown at the top of a form after a failed submit. Focus moves here, and each item links to its
 * field, so keyboard and screen reader users find every problem.
 */
export function ErrorSummary({ message, items }: { message?: string; items: readonly ErrorSummaryItem[] }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const key = `${message ?? ""}|${items.map((i) => i.fieldId + i.message).join(",")}`;
  useEffect(() => {
    ref.current?.focus();
  }, [key]);
  if (!message && items.length === 0) return null;
  return (
    <div ref={ref} tabIndex={-1} className="outline-none focus-visible:outline-2 focus-visible:outline-focus">
      <InlineAlert tone="danger" live="alert" title={message ?? (items.length === 1 ? t("states.errorSummaryOne") : t("states.errorSummary", { count: items.length }))}>
        {items.length > 0 ? (
          <ul className="list-disc ps-4">
            {items.map((i) => (
              <li key={i.fieldId}>
                <a
                  href={`#${i.fieldId}`}
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(i.fieldId)?.focus();
                  }}
                >
                  {i.label ? `${i.label}: ` : ""}
                  {i.message}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </InlineAlert>
    </div>
  );
}
