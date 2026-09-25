import type { Metadata } from "next";
import { YanitOverview } from "@/components/yanit/yanit-views";
import { load } from "@/lib/api/load";
import type { YanitOverview as Overview } from "@/lib/ekosistem/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("yanit.title") };
}

/** Yanıt › Visibility overview (yanit:read); works without a link (the data blocks are then null). */
export default async function YanitPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  return <YanitOverview result={await load<Overview>(`${ctx.apiBase}/ekosistem/yanit/overview`)} />;
}
