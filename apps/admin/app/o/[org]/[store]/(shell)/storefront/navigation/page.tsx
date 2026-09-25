import type { Metadata } from "next";
import { MenusList } from "@/components/storefront/navigation/menus-list";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import { getI18n } from "@/lib/i18n/server";
import type { NavigationMenu, StorefrontTheme } from "@/lib/storefront/types";
import { requireStoreContext } from "@/lib/store-context";
import { menuUsage } from "@/lib/storefront/menu-usage";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("storefront.menus.title") };
}

/** Storefront › Menus. */
export default async function MenusPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const { t } = await getI18n();
  const [menus, theme] = await Promise.all([load<ItemList<NavigationMenu>>(`${ctx.apiBase}/storefront/navigations`), load<StorefrontTheme>(`${ctx.apiBase}/storefront/theme`)]);
  if (!menus.ok) {
    return (
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
        <PageHeader title={t("storefront.menus.title")} />
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={menus.error} />
        </div>
      </div>
    );
  }
  const usage = theme.ok ? menuUsage(theme.data.globalSections.sections, { header: t("storefront.menus.usage.header"), footer: t("storefront.menus.usage.footer") }) : {};
  return <MenusList menus={menus.data.items} usage={usage} />;
}
