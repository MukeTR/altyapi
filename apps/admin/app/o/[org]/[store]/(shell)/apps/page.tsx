import type { Metadata } from "next";
import { AppsOverview } from "@/components/integrations/apps-overview";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import { getI18n } from "@/lib/i18n/server";
import type { IntegrationConnection, IntegrationProvider } from "@/lib/integrations/types";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("integrations.title") };
}

/** Apps & Integrations › Connections (integrations:read) and the public connector catalog. */
export default async function AppsPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const [connections, providers] = await Promise.all([
    load<ItemList<IntegrationConnection>>(`${ctx.apiBase}/integrations/connections`),
    load<ItemList<IntegrationProvider>>("/v1/integrations/providers"),
  ]);
  return <AppsOverview connections={connections} providers={providers} />;
}
