import type { Metadata } from "next";
import { RedirectsManager } from "@/components/storefront/redirects/redirects-manager";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import { getI18n } from "@/lib/i18n/server";
import type { Redirect } from "@/lib/storefront/types";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("storefront.redirects.title") };
}

/** Storefront › Redirects. */
export default async function RedirectsPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const { t } = await getI18n();
  const res = await load<ItemList<Redirect>>(`${ctx.apiBase}/storefront/redirects`);
  if (!res.ok) {
    return (
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
        <PageHeader title={t("storefront.redirects.title")} />
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={res.error} />
        </div>
      </div>
    );
  }
  return <RedirectsManager redirects={res.data.items} />;
}
