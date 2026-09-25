import type { Metadata } from "next";
import { PagesManager } from "@/components/storefront/pages/pages-manager";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import { getI18n } from "@/lib/i18n/server";
import type { StorefrontPage, StorefrontTheme } from "@/lib/storefront/types";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("storefront.pages.title") };
}

/** Storefront › Pages: home, pages, landing pages and templates with publication state. */
export default async function StorefrontPagesPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const { t } = await getI18n();
  const [pages, theme] = await Promise.all([load<ItemList<StorefrontPage>>(`${ctx.apiBase}/storefront/pages`), load<StorefrontTheme>(`${ctx.apiBase}/storefront/theme`)]);
  if (!pages.ok) {
    return (
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
        <PageHeader title={t("storefront.pages.title")} />
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={pages.error} />
        </div>
      </div>
    );
  }
  return <PagesManager pages={pages.data.items} theme={theme.ok ? { name: theme.data.name, hasUnpublishedChanges: theme.data.hasUnpublishedChanges ?? false } : null} />;
}
