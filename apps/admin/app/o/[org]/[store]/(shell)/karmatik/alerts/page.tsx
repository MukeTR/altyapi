import type { Metadata } from "next";
import { Alerts } from "@/components/karmatik/karmatik-lists";
import { load } from "@/lib/api/load";
import type { OffsetPage } from "@/lib/api/types";
import { oneOf, param } from "@/lib/commerce/query";
import type { KarmatikAlert } from "@/lib/ekosistem/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("karmatik.alerts.title") };
}

/** Kârmatik › Alerts (karmatik:read, active link), most severe first. */
export default async function AlertsPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const ctx = await requireStoreContext(params);
  const sp = await searchParams;
  // "any" in the URL is the API's "all".
  const picked = oneOf(param(sp, "status"), ["resolved", "any"] as const);
  const status = picked === "any" ? "all" : picked;
  const severity = oneOf(param(sp, "severity"), ["info", "warning", "critical"] as const);
  const type = oneOf(param(sp, "type"), ["loss_making", "thin_margin", "missing_cost", "buybox_lost", "competitor_price_drop", "high_return", "other"] as const);
  const offset = Math.max(0, Number.parseInt(param(sp, "offset"), 10) || 0);
  const result = await load<OffsetPage<KarmatikAlert>>(`${ctx.apiBase}/ekosistem/karmatik/alerts`, { query: { status: status ?? "open", severity, type, limit: 50, offset } });
  return <Alerts result={result} filtered={Boolean(severity || type)} />;
}
