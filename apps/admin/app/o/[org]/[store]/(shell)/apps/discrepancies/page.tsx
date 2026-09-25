import type { Metadata } from "next";
import { Discrepancies } from "@/components/integrations/discrepancies";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import { oneOf, param } from "@/lib/commerce/query";
import { getI18n } from "@/lib/i18n/server";
import { DISCREPANCIES_PAGE, type Discrepancy } from "@/lib/integrations/types";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("integrations.discrepancies.title") };
}

/** Apps & Integrations › Discrepancies (integrations:read; acknowledging needs integrations:manage). */
export default async function DiscrepanciesPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const ctx = await requireStoreContext(params);
  const sp = await searchParams;
  const status = oneOf(param(sp, "status"), ["acknowledged", "resolved"] as const) ?? "open";
  const field = oneOf(param(sp, "field"), ["stock", "price"] as const) ?? null;
  const result = await load<ItemList<Discrepancy>>(`${ctx.apiBase}/integrations/discrepancies`, { query: { status, field: field ?? undefined, limit: DISCREPANCIES_PAGE } });
  return <Discrepancies key={`${status}-${field ?? "all"}`} result={result} status={status} field={field} />;
}
