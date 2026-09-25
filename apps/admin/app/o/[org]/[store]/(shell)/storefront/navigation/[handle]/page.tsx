import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MenuEditor } from "@/components/storefront/navigation/menu-editor";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import { getI18n } from "@/lib/i18n/server";
import type { NavigationMenu, StorefrontPage, StorefrontTheme } from "@/lib/storefront/types";
import { requireStoreContext } from "@/lib/store-context";
import { menuUsage } from "@/lib/storefront/menu-usage";

type Params = Promise<{ org: string; store: string; handle: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { t } = await getI18n();
  const { org, store, handle } = await params;
  const ctx = await requireStoreContext(Promise.resolve({ org, store }));
  const menus = await load<ItemList<NavigationMenu>>(`${ctx.apiBase}/storefront/navigations`);
  const menu = menus.ok ? menus.data.items.find((m) => m.handle === decodeURIComponent(handle)) : undefined;
  return { title: `${menu?.name ?? decodeURIComponent(handle)} · ${t("storefront.menus.title")}` };
}

/** Storefront › Menus › one menu. */
export default async function MenuPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const { handle } = await params;
  const { t } = await getI18n();
  const [menus, pages, theme] = await Promise.all([
    load<ItemList<NavigationMenu>>(`${ctx.apiBase}/storefront/navigations`),
    load<ItemList<StorefrontPage>>(`${ctx.apiBase}/storefront/pages`),
    load<StorefrontTheme>(`${ctx.apiBase}/storefront/theme`),
  ]);
  const failed = !menus.ok ? menus.error : !pages.ok ? pages.error : null;
  if (failed) {
    return (
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
        <PageHeader title={t("storefront.menus.title")} />
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={failed} />
        </div>
      </div>
    );
  }
  if (!menus.ok || !pages.ok) return null;
  const menu = menus.data.items.find((m) => m.handle === decodeURIComponent(handle));
  if (!menu) notFound();
  const usage = theme.ok ? menuUsage(theme.data.globalSections.sections, { header: t("storefront.menus.usage.header"), footer: t("storefront.menus.usage.footer") }) : {};
  return <MenuEditor key={menu.id} menu={menu} pages={pages.data.items} usage={usage[menu.handle] ?? []} />;
}
