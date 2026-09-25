"use client";

import { Check, Minus } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { ProviderCapabilities } from "@/lib/integrations/types";

const CAPABILITY_KEYS = ["readOrders", "readListings", "writeStock", "writePrice"] as const;

/** What a connector can do, as a compact list (never color alone: every item has text). */
export function CapabilityList({ capabilities, className }: { capabilities: ProviderCapabilities | null; className?: string }) {
  const { t } = useI18n();
  if (!capabilities) return null;
  return (
    <ul className={className ?? "flex flex-wrap gap-x-4 gap-y-1"}>
      {CAPABILITY_KEYS.map((k) => {
        const on = capabilities[k];
        return (
          <li key={k} className="flex items-center gap-1 text-sm">
            {on ? <Check aria-hidden="true" className="size-3.5 text-success" /> : <Minus aria-hidden="true" className="size-3.5 text-fg-subtle" />}
            <span className={on ? "text-fg" : "text-fg-muted"}>{t(`integrations.capabilities.${k}`)}</span>
            <span className="sr-only">: {on ? t("common.yes") : t("common.no")}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function KindBadge({ kind }: { kind: string }) {
  const { t } = useI18n();
  return <Badge>{t.maybe(`integrations.kinds.${kind}`) ?? kind}</Badge>;
}

/** Display name of a connector: brand names as given, generic connectors in the interface language. */
export function useProviderName() {
  const { t } = useI18n();
  return (id: string, fallback: string) => t.maybe(`integrations.providerNames.${id}`) ?? fallback;
}

/** Credential keys that hold secrets are typed into password fields. */
export function isSecretCredential(key: string): boolean {
  return /password|secret|apikey|token/i.test(key);
}

/** A page that failed to load its main data: header plus a bordered ErrorState. */
export function PageError({ title, error, width = "1440px" }: { title: string; error: ApiErrorInfo; width?: "960px" | "1200px" | "1440px" }) {
  return (
    <div className="mx-auto flex flex-col gap-6" style={{ maxWidth: width }}>
      <PageHeader title={title} />
      <div className="rounded-lg border border-border bg-surface">
        <ErrorState error={error} />
      </div>
    </div>
  );
}
