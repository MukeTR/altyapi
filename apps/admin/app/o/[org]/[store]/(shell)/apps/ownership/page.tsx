import type { Metadata } from "next";
import { Ownership } from "@/components/integrations/ownership";
import { PageError } from "@/components/integrations/shared";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import { getI18n } from "@/lib/i18n/server";
import type { IntegrationConnection, OwnerInfo } from "@/lib/integrations/types";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("integrations.ownership.title") };
}

/** Apps & Integrations › Data ownership (integrations:read; changes need integrations:manage). */
export default async function OwnershipPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const { t } = await getI18n();
  const [ownership, connections] = await Promise.all([
    load<ItemList<OwnerInfo>>(`${ctx.apiBase}/integrations/ownership`),
    load<ItemList<IntegrationConnection>>(`${ctx.apiBase}/integrations/connections`),
  ]);
  if (!ownership.ok) return <PageError title={t("integrations.ownership.title")} error={ownership.error} width="960px" />;
  if (!connections.ok) return <PageError title={t("integrations.ownership.title")} error={connections.error} width="960px" />;
  return <Ownership initial={ownership.data.items} connections={connections.data.items} />;
}
