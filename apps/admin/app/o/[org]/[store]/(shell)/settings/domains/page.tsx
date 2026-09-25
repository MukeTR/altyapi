import type { Metadata } from "next";
import { DomainsManager } from "@/components/domains/domains-manager";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import type { Domain } from "@/lib/domains/types";
import { serverEnv } from "@/lib/env";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("domains.title") };
}

/** Settings › Domains. */
export default async function DomainsPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const { t } = await getI18n();
  const res = await load<ItemList<Domain>>(`${ctx.apiBase}/domains`);
  if (!res.ok) {
    return (
      <div className="mx-auto flex max-w-[960px] flex-col gap-6">
        <PageHeader title={t("domains.title")} />
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={res.error} />
        </div>
      </div>
    );
  }
  return <DomainsManager initial={res.data.items} originTemplate={serverEnv.storefrontOriginTemplate()} />;
}
