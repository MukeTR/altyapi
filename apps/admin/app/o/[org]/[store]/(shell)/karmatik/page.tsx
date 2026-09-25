import type { Metadata } from "next";
import { KarmatikOverview } from "@/components/karmatik/karmatik-overview";
import { load } from "@/lib/api/load";
import type { KarmatikOverview as Overview } from "@/lib/ekosistem/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("karmatik.title") };
}

/** Kârmatik › Overview (karmatik:read); works without a link (the data blocks are then null). */
export default async function KarmatikPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  return <KarmatikOverview result={await load<Overview>(`${ctx.apiBase}/ekosistem/karmatik/overview`)} />;
}
