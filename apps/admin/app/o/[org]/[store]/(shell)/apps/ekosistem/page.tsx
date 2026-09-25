import type { Metadata } from "next";
import { LinksManager } from "@/components/ekosistem/links-manager";
import { PageError } from "@/components/integrations/shared";
import { load } from "@/lib/api/load";
import type { LinksResponse } from "@/lib/ekosistem/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("ekosistem.title") };
}

/** Apps & Integrations › Ecosystem: Kârmatik and Yanıt links (karmatik:read or yanit:read). */
export default async function EkosistemPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const { t } = await getI18n();
  const res = await load<LinksResponse>(`${ctx.apiBase}/ekosistem/links`);
  if (!res.ok) return <PageError title={t("ekosistem.title")} error={res.error} width="1200px" />;
  return <LinksManager initial={res.data} />;
}
