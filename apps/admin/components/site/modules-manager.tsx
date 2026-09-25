"use client";

import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Badge } from "@/components/ui/badge";
import { AlertDialog } from "@/components/ui/dialog";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { labelText } from "@/lib/content/fields";
import type { SiteModule } from "@/lib/site/types";

/**
 * Site › modules: capability modules with their state. A module turns on only when the modules
 * it depends on are on, and off only when nothing that is on depends on it; always-on and
 * locked modules (packs, policy) cannot be switched here. Turning a module off keeps its data
 * and settings.
 */
export function ModulesManager({ initial }: { initial: SiteModule[] }) {
  const { t, locale, describeError } = useI18n();
  const { apiBase, can } = useStore();
  const router = useRouter();
  const { toast } = useToast();
  const [modules, setModules] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<SiteModule | null>(null);
  const [error, setError] = useState<{ key: string; info: ApiErrorInfo } | null>(null);
  const canManage = can("site:manage");
  const byKey = new Map(modules.map((m) => [m.key, m]));
  const name = (key: string) => labelText(byKey.get(key)?.label, locale, key);

  const change = async (m: SiteModule, on: boolean) => {
    setPending(m.key);
    setError(null);
    try {
      await bff<SiteModule>(`${apiBase}/site/modules/${m.key}/${on ? "enable" : "disable"}`, { method: "POST", ...(on ? { body: {} } : {}) });
      const fresh = await bff<{ items: SiteModule[] }>(`${apiBase}/site/modules`);
      setModules(fresh.items);
      toast({ tone: "success", title: on ? t("site.modules.enabled", { name: name(m.key) }) : t("site.modules.disabled", { name: name(m.key) }) });
      // The navigation and the store context (active modules) come from the layout.
      router.refresh();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError({ key: m.key, info: err.toInfo() });
    } finally {
      setPending(null);
    }
  };

  /** Why a module cannot be switched now, or null. */
  const blocked = (m: SiteModule): string | null => {
    if (m.alwaysOn) return t("site.modules.alwaysOn");
    if (m.status === "locked_on" || m.status === "locked_off") return t(`site.modules.locked.${m.status}`, { source: t(`site.modules.sources.${m.source ?? "policy"}`) });
    if (!m.active) {
      const missing = m.dependsOn.filter((d) => !byKey.get(d)?.active);
      if (missing.length) return t("site.modules.needs", { modules: missing.map(name).join(", ") });
    } else {
      const deps = m.dependents.filter((d) => byKey.get(d)?.active);
      if (deps.length) return t("site.modules.requiredBy", { modules: deps.map(name).join(", ") });
    }
    return null;
  };

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6">
      <PageHeader title={t("site.modules.title")} meta={t("site.modules.description")} />
      {!canManage ? <InlineAlert tone="info">{t("site.readOnly", { permission: "site:manage" })}</InlineAlert> : null}
      <ul className="flex flex-col gap-3">
        {modules.map((m) => {
          const reason = blocked(m);
          const on = m.active || m.status === "enabled" || m.status === "locked_on";
          const described = error?.key === m.key ? describeError(error.info) : null;
          return (
            <li key={m.key} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold text-fg">{labelText(m.label, locale, m.key)}</span>
                    <StatusPill domain="siteModule" value={m.status} />
                    {m.status === "enabled" && !m.active ? <Badge tone="warning">{t("site.modules.inactiveDeps")}</Badge> : null}
                    <span className="font-mono text-xs text-fg-subtle">v{m.version}</span>
                  </span>
                  <p className="text-sm text-fg-muted">{labelText(m.description, locale)}</p>
                  <p className="text-xs text-fg-subtle">
                    {m.dependsOn.length ? t("site.modules.dependsOn", { modules: m.dependsOn.map(name).join(", ") }) : t("site.modules.noDependencies")}
                    {m.dependents.length ? ` · ${t("site.modules.dependents", { modules: m.dependents.map(name).join(", ") })}` : ""}
                    {m.source ? ` · ${t("site.modules.sourceLabel", { source: t(`site.modules.sources.${m.source}`) })}` : ""}
                  </p>
                  {!m.settingsValid ? <p className="text-xs text-warning">{t("site.modules.settingsInvalid")}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {reason ? <Lock aria-hidden="true" className="size-4 text-fg-subtle" /> : null}
                  <Switch
                    checked={on}
                    disabled={!canManage || Boolean(reason) || pending !== null}
                    onCheckedChange={(c) => (c ? void change(m, true) : setConfirm(m))}
                    label={on ? t("site.modules.turnOff", { name: labelText(m.label, locale, m.key) }) : t("site.modules.turnOn", { name: labelText(m.label, locale, m.key) })}
                    hideLabel
                  />
                </div>
              </div>
              {reason ? <p className="text-sm text-fg-muted">{reason}</p> : null}
              {described ? (
                <InlineAlert tone="danger" live="alert">
                  {described.message}
                </InlineAlert>
              ) : null}
            </li>
          );
        })}
      </ul>
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t("site.modules.disableTitle", { name: confirm ? labelText(confirm.label, locale, confirm.key) : "" })}
        description={t("site.modules.disableBody")}
        confirmLabel={t("site.modules.disable")}
        pending={confirm !== null && pending === confirm.key}
        onConfirm={() => {
          const m = confirm;
          setConfirm(null);
          if (m) void change(m, false);
        }}
      />
    </div>
  );
}
