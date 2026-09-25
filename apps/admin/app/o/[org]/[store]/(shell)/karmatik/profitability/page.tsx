import type { Metadata } from "next";
import { Profitability } from "@/components/karmatik/karmatik-lists";
import { load } from "@/lib/api/load";
import type { OffsetPage } from "@/lib/api/types";
import { oneOf, param } from "@/lib/commerce/query";
import type { KarmatikOverview, ProfitRow } from "@/lib/ekosistem/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("karmatik.profitability.title") };
}

/** Kârmatik › Profitability (karmatik:read, active link), worst margin first. */
export default async function ProfitabilityPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const ctx = await requireStoreContext(params);
  const sp = await searchParams;
  const filter = oneOf(param(sp, "filter"), ["loss_making", "thin_margin", "unmatched"] as const);
  const channel = param(sp, "channel");
  const offset = Math.max(0, Number.parseInt(param(sp, "offset"), 10) || 0);
  const [rows, overview] = await Promise.all([
    load<OffsetPage<ProfitRow>>(`${ctx.apiBase}/ekosistem/karmatik/variants`, { query: { filter, channel: /^[A-Za-z0-9_.-]{1,64}$/.test(channel) ? channel : undefined, limit: 50, offset } }),
    load<KarmatikOverview>(`${ctx.apiBase}/ekosistem/karmatik/overview`),
  ]);
  const channels = overview.ok ? (overview.data.profit?.byChannel ?? []).map((c) => c.channel) : [];
  return <Profitability result={rows} channels={channels} filtered={Boolean(filter || channel)} />;
}
