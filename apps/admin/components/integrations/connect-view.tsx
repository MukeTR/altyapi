"use client";

import { useRouter } from "next/navigation";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import type { IntegrationProvider } from "@/lib/integrations/types";
import { ConnectionForm } from "./connection-form";
import { CapabilityList, KindBadge, useProviderName } from "./shared";

/** Apps & Integrations › Connect <provider>: the connection form next to what the connector does. */
export function ConnectView({ provider }: { provider: IntegrationProvider }) {
  const { t } = useI18n();
  const { basePath, can } = useStore();
  const router = useRouter();
  const { toast } = useToast();
  const canManage = can("integrations:manage");
  const name = useProviderName()(provider.id, provider.name);
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
      <PageHeader
        title={t("integrations.connect.title", { name })}
        breadcrumbs={[{ label: t("integrations.title"), href: `${basePath}/apps` }, { label: name }]}
        status={<KindBadge kind={provider.kind} />}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card padding="form" title={t("integrations.connect.formTitle")} description={t("integrations.connect.formDescription")}>
          {canManage ? (
            <ConnectionForm
              provider={{ ...provider, name }}
              onCancel={() => router.push(`${basePath}/apps`)}
              onDone={(connection, account) => {
                toast({ tone: "success", title: t("integrations.connect.done", { name: connection.name }), ...(account ? { description: t("integrations.connect.account", { account }) } : {}) });
                router.push(`${basePath}/apps/connections/${connection.id}`);
              }}
            />
          ) : (
            <ErrorState
              compact
              error={{ status: 403, code: "forbidden", messageKey: "errors.forbidden", details: { permission: "integrations:manage" }, correlationId: null }}
            />
          )}
        </Card>
        <aside className="flex flex-col gap-4">
          <Card title={t("integrations.connect.what")}>
            <div className="flex flex-col gap-3">
              <CapabilityList capabilities={provider.capabilities} className="flex flex-col gap-1.5" />
              <p className="text-sm text-fg-muted">{t("integrations.connect.readFirst")}</p>
            </div>
          </Card>
          {provider.docs.notes.length ? (
            <InlineAlert tone="info" title={t("integrations.connect.notes")}>
              <ul lang="tr" className="flex list-disc flex-col gap-1 ps-4 text-sm">
                {provider.docs.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </InlineAlert>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
