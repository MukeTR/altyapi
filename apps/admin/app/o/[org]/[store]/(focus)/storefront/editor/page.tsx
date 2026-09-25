import type { Metadata } from "next";
import { Store } from "lucide-react";
import { FocusFrame } from "@/components/storefront/editor/focus-frame";
import { StorefrontEditor } from "@/components/storefront/editor/storefront-editor";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { load } from "@/lib/api/load";
import type { CursorPage, ItemList } from "@/lib/api/types";
import { getI18n } from "@/lib/i18n/server";
import { hasPermission } from "@/lib/permissions";
import type { PreviewSamples } from "@/lib/storefront/preview";
import type { CollectionSummary, Device, NavigationMenu, ProductSummary, SectionDefinition, StorefrontPage, StorefrontTheme } from "@/lib/storefront/types";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

const DEVICES: readonly Device[] = ["desktop", "tablet", "mobile"];

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("editor.title") };
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Records used to preview the product and collection templates (the newest active product, the first published collection). */
async function previewSamples(apiBase: string, permissions: readonly string[]): Promise<PreviewSamples> {
  if (!hasPermission(permissions, "catalog:read")) return { productHandle: null, collectionHandle: null };
  const [products, collections] = await Promise.all([
    load<CursorPage<ProductSummary>>(`${apiBase}/products`, { query: { status: "active", limit: 1 } }),
    load<ItemList<CollectionSummary>>(`${apiBase}/collections`),
  ]);
  return {
    productHandle: products.ok ? (products.data.items[0]?.handle ?? null) : null,
    collectionHandle: collections.ok ? (collections.data.items.find((c) => c.isPublished)?.handle ?? null) : null,
  };
}

/** Full-screen storefront editor (?page=<id>&locale=&device=&panel=theme). */
export default async function StorefrontEditorPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const ctx = await requireStoreContext(params);
  const sp = await searchParams;
  const { t } = await getI18n();
  const [pages, theme, definitions, menus, samples] = await Promise.all([
    load<ItemList<StorefrontPage>>(`${ctx.apiBase}/storefront/pages`),
    load<StorefrontTheme>(`${ctx.apiBase}/storefront/theme`),
    load<ItemList<SectionDefinition>>("/v1/section-definitions"),
    load<ItemList<NavigationMenu>>(`${ctx.apiBase}/storefront/navigations`),
    previewSamples(ctx.apiBase, ctx.permissions),
  ]);

  const failed = [pages, theme, definitions, menus].find((r) => !r.ok);
  if (failed && !failed.ok) {
    const notInitialized = failed.error.messageKey === "errors.storefront.not_initialized";
    return (
      <FocusFrame>
        {notInitialized ? (
          <EmptyState icon={Store} headingLevel={1} title={t("editor.notInitializedTitle")} description={t("editor.notInitializedBody")} />
        ) : (
          <ErrorState error={failed.error} headingLevel={1} />
        )}
      </FocusFrame>
    );
  }
  if (!pages.ok || !theme.ok || !definitions.ok || !menus.ok) return null;

  const requested = one(sp.page);
  const initialPage = pages.data.items.find((p) => p.id === requested) ?? pages.data.items.find((p) => p.type === "home") ?? pages.data.items[0];
  if (!initialPage) {
    return (
      <FocusFrame>
        <EmptyState icon={Store} headingLevel={1} title={t("editor.notInitializedTitle")} description={t("editor.notInitializedBody")} />
      </FocusFrame>
    );
  }
  const locale = one(sp.locale);
  const device = one(sp.device);

  return (
    <StorefrontEditor
      key={ctx.store.id}
      pages={pages.data.items}
      initialPage={initialPage}
      theme={theme.data}
      definitions={definitions.data.items}
      menus={menus.data.items}
      samples={samples}
      initialLocale={locale && ctx.store.supportedLocales.includes(locale) ? locale : ctx.store.defaultLocale}
      initialDevice={DEVICES.includes(device as Device) ? (device as Device) : "desktop"}
      initialPanel={one(sp.panel) === "theme" ? "theme" : null}
    />
  );
}
