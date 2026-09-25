import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConnectView } from "@/components/integrations/connect-view";
import { PageError } from "@/components/integrations/shared";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import { getI18n } from "@/lib/i18n/server";
import type { IntegrationProvider } from "@/lib/integrations/types";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string; provider: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("integrations.connect.metaTitle") };
}

/** Apps & Integrations › Connect: only connectors the API reports as available can be connected. */
export default async function ConnectPage({ params }: { params: Params }) {
  await requireStoreContext(params);
  const { provider: providerId } = await params;
  const { t } = await getI18n();
  const res = await load<ItemList<IntegrationProvider>>("/v1/integrations/providers");
  if (!res.ok) return <PageError title={t("integrations.connect.metaTitle")} error={res.error} width="1200px" />;
  const provider = res.data.items.find((p) => p.id === providerId);
  if (!provider || !provider.available) notFound();
  return <ConnectView provider={provider} />;
}
