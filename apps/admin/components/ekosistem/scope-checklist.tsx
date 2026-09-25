"use client";

import { ShieldAlert } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { isExplicitConsentScope } from "@/lib/ekosistem/types";
import { cn } from "@/lib/cn";

export function useScopeText() {
  const { t } = useI18n();
  return {
    title: (scope: string) => t.maybe(`ekosistem.scopes.${scope}.title`) ?? scope,
    meaning: (scope: string) => t.maybe(`ekosistem.scopes.${scope}.meaning`),
  };
}

export interface ScopeChecklistProps {
  /** Every scope the user may grant, in display order. */
  scopes: readonly string[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** Accessible name of the group. */
  legend: string;
  description?: string;
}

/**
 * Scopes this store grants a peer. Explicit-consent scopes (costs:read, orders:read) start
 * unticked, carry a warning tone and a "needs explicit consent" badge, and are only granted when
 * the user ticks each one (docs/ekosistem/v1.md §3).
 */
export function ScopeChecklist({ scopes, value, onChange, disabled, legend, description }: ScopeChecklistProps) {
  const { t } = useI18n();
  const text = useScopeText();
  const toggle = (scope: string, on: boolean) => onChange(on ? scopes.filter((s) => s === scope || value.includes(s)) : value.filter((s) => s !== scope));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-base font-medium text-fg">{legend}</legend>
      {description ? <p className="-mt-1 mb-1 text-sm text-fg-muted">{description}</p> : null}
      <ul className="flex flex-col gap-2">
        {scopes.map((scope) => {
          const explicit = isExplicitConsentScope(scope);
          return (
            <li key={scope} className={cn("rounded-md border px-3 py-2", explicit ? "border-warning/40 bg-warning-bg/40" : "border-border")}>
              <Checkbox
                checked={value.includes(scope)}
                disabled={disabled ?? false}
                onCheckedChange={(on) => toggle(scope, on)}
                label={
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{text.title(scope)}</span>
                    <code className="font-mono text-xs text-fg-subtle">{scope}</code>
                    {explicit ? (
                      <Badge tone="warning">
                        <ShieldAlert aria-hidden="true" className="size-3" />
                        {t("ekosistem.explicitConsent")}
                      </Badge>
                    ) : null}
                  </span>
                }
                description={text.meaning(scope) ?? undefined}
              />
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

/** Read-only list of scopes (what either side may read). */
export function ScopeList({ scopes, empty }: { scopes: readonly string[]; empty?: string }) {
  const { t } = useI18n();
  const text = useScopeText();
  if (!scopes.length) return <p className="text-sm text-fg-muted">{empty ?? t("common.none")}</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {scopes.map((scope) => (
        <li key={scope} className="flex flex-col">
          <span className="inline-flex flex-wrap items-center gap-1.5 text-sm text-fg">
            {text.title(scope)}
            <code className="font-mono text-xs text-fg-subtle">{scope}</code>
            {isExplicitConsentScope(scope) ? <Badge tone="warning">{t("ekosistem.explicitConsent")}</Badge> : null}
          </span>
          {text.meaning(scope) ? <span className="text-xs text-fg-muted">{text.meaning(scope)}</span> : null}
        </li>
      ))}
    </ul>
  );
}
