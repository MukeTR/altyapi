import type { Metadata } from "next";
import { PublicationsTable } from "@/components/storefront/publications/publications-table";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import { getI18n } from "@/lib/i18n/server";
import type { Publication } from "@/lib/storefront/types";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("storefront.publications.title") };
}

/** Storefront › Publication history with rollback. */
export default async function PublicationsPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const { t } = await getI18n();
  const res = await load<ItemList<Publication>>(`${ctx.apiBase}/storefront/publications`);
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
      <PageHeader title={t("storefront.publications.title")} meta={t("storefront.publications.subtitle")} />
      {res.ok ? (
        <PublicationsTable publications={res.data.items} />
      ) : (
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={res.error} />
        </div>
      )}
    </div>
  );
}
