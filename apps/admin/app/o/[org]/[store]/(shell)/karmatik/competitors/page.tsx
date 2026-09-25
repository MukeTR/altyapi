import type { Metadata } from "next";
import { Competitors } from "@/components/karmatik/karmatik-lists";
import { load } from "@/lib/api/load";
import type { OffsetPage } from "@/lib/api/types";
import { param } from "@/lib/commerce/query";
import type { CompetitorOffer } from "@/lib/ekosistem/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("karmatik.competitors.title") };
}

/** Kârmatik › Competitor prices (karmatik:read, active link). */
export default async function CompetitorsPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const ctx = await requireStoreContext(params);
  const sp = await searchParams;
  const offset = Math.max(0, Number.parseInt(param(sp, "offset"), 10) || 0);
  const result = await load<OffsetPage<CompetitorOffer>>(`${ctx.apiBase}/ekosistem/karmatik/competitors`, { query: { limit: 50, offset } });
  return <Competitors result={result} filtered={false} />;
}
