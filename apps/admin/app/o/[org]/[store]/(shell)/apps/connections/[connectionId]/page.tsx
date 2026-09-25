import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConnectionDetailView } from "@/components/integrations/connection-detail";
import { PageError } from "@/components/integrations/shared";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import { getI18n } from "@/lib/i18n/server";
import type { ConnectionDetail, IntegrationProvider } from "@/lib/integrations/types";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string; connectionId: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("integrations.detail.metaTitle") };
}

/** Apps & Integrations › Connection detail (integrations:read; actions need integrations:manage). */
export default async function ConnectionPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const { connectionId } = await params;
  const { t } = await getI18n();
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) notFound();
  const [detail, providers] = await Promise.all([
    load<ConnectionDetail>(`${ctx.apiBase}/integrations/connections/${connectionId}`, { notFoundOn404: true }),
    load<ItemList<IntegrationProvider>>("/v1/integrations/providers"),
  ]);
  if (!detail.ok) return <PageError title={t("integrations.detail.metaTitle")} error={detail.error} width="1200px" />;
  const provider = providers.ok ? (providers.data.items.find((p) => p.id === detail.data.provider) ?? null) : null;
  return <ConnectionDetailView initial={detail.data} provider={provider} />;
}
