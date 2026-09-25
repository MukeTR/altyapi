import type { Metadata } from "next";
import { YanitGaps } from "@/components/yanit/yanit-views";
import { load } from "@/lib/api/load";
import type { OffsetPage } from "@/lib/api/types";
import { oneOf, param } from "@/lib/commerce/query";
import type { YanitGap } from "@/lib/ekosistem/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("yanit.gaps.title") };
}

/** Yanıt › Visibility gaps (yanit:read, active link), highest priority first. */
export default async function GapsPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const ctx = await requireStoreContext(params);
  const sp = await searchParams;
  const intent = oneOf(param(sp, "intent"), ["discovery", "comparison", "review", "how_to"] as const);
  const offset = Math.max(0, Number.parseInt(param(sp, "offset"), 10) || 0);
  const result = await load<OffsetPage<YanitGap>>(`${ctx.apiBase}/ekosistem/yanit/gaps`, { query: { intent, limit: 50, offset } });
  return <YanitGaps result={result} filtered={Boolean(intent)} />;
}
