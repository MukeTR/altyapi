import type { Metadata } from "next";
import { PageError } from "@/components/integrations/shared";
import { ProfitGuardSettings } from "@/components/karmatik/profit-guard-settings";
import { load } from "@/lib/api/load";
import type { EkosistemSettings } from "@/lib/ekosistem/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("karmatik.guard.title") };
}

/** Kârmatik › Profit guard (settings:read; saving needs settings:write) and the profit check tool. */
export default async function ProfitGuardPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const { t } = await getI18n();
  const res = await load<EkosistemSettings>(`${ctx.apiBase}/ekosistem/settings`);
  if (!res.ok) return <PageError title={t("karmatik.guard.title")} error={res.error} width="960px" />;
  return <ProfitGuardSettings initial={res.data} />;
}
