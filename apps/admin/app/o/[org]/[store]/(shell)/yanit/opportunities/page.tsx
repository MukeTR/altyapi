import type { Metadata } from "next";
import { YanitOpportunities } from "@/components/yanit/yanit-views";
import { load } from "@/lib/api/load";
import type { OffsetPage } from "@/lib/api/types";
import { oneOf, param } from "@/lib/commerce/query";
import type { YanitOpportunity } from "@/lib/ekosistem/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("yanit.opportunities.title") };
}

/** Yanıt › Content opportunities (yanit:read; drafting and dismissing need content:write). */
export default async function OpportunitiesPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const ctx = await requireStoreContext(params);
  const sp = await searchParams;
  // "any" in the URL is the API's "all".
  const picked = oneOf(param(sp, "status"), ["drafted", "dismissed", "any"] as const);
  const status = picked === "any" ? "all" : picked;
  const kind = oneOf(param(sp, "kind"), ["faq", "comparison_page", "structured_data", "product_content", "other"] as const);
  const impact = oneOf(param(sp, "impact"), ["high", "medium", "low"] as const);
  const offset = Math.max(0, Number.parseInt(param(sp, "offset"), 10) || 0);
  const result = await load<OffsetPage<YanitOpportunity>>(`${ctx.apiBase}/ekosistem/yanit/opportunities`, { query: { status: status ?? "new", kind, impact, limit: 50, offset } });
  return <YanitOpportunities result={result} filtered={Boolean(kind || impact)} />;
}
