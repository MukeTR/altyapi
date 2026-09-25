import type { Metadata } from "next";
import { Suggestions } from "@/components/karmatik/suggestions";
import { load } from "@/lib/api/load";
import type { OffsetPage } from "@/lib/api/types";
import { oneOf, param } from "@/lib/commerce/query";
import type { Suggestion } from "@/lib/ekosistem/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("karmatik.suggestions.title") };
}

/** Kârmatik › Price suggestions (karmatik:read; deciding needs pricing:write). */
export default async function SuggestionsPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const ctx = await requireStoreContext(params);
  const sp = await searchParams;
  // "any" in the URL is the API's "all".
  const picked = oneOf(param(sp, "status"), ["applied", "dismissed", "any"] as const);
  const status = picked === "any" ? "all" : picked;
  const offset = Math.max(0, Number.parseInt(param(sp, "offset"), 10) || 0);
  const result = await load<OffsetPage<Suggestion>>(`${ctx.apiBase}/ekosistem/karmatik/suggestions`, { query: { status: status ?? "new", limit: 50, offset } });
  return <Suggestions result={result} filtered={false} />;
}
