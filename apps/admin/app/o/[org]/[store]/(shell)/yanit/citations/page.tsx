import type { Metadata } from "next";
import { YanitCitations } from "@/components/yanit/yanit-views";
import { load } from "@/lib/api/load";
import type { OffsetPage } from "@/lib/api/types";
import { param } from "@/lib/commerce/query";
import type { YanitCitation } from "@/lib/ekosistem/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("yanit.citations.title") };
}

/** Yanıt › Citations (yanit:read, active link), last 30 days, most cited first. */
export default async function CitationsPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const ctx = await requireStoreContext(params);
  const sp = await searchParams;
  const offset = Math.max(0, Number.parseInt(param(sp, "offset"), 10) || 0);
  const result = await load<OffsetPage<YanitCitation>>(`${ctx.apiBase}/ekosistem/yanit/citations`, { query: { windowDays: 30, limit: 50, offset } });
  return <YanitCitations result={result} />;
}
