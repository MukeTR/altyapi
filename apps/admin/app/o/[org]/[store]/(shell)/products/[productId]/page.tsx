import type { Metadata } from "next";
import { ProductForm } from "@/components/products/product-form";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import { mediaConfig } from "@/lib/commerce/media-server";
import { loadProductEditorData, loadResolvedPrices } from "@/lib/commerce/product-editor-data";
import type { ProductDetail } from "@/lib/commerce/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string; productId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { org, store, productId } = await params;
  const { t } = await getI18n();
  const ctx = await requireStoreContext(Promise.resolve({ org, store }));
  const r = await load<ProductDetail>(`${ctx.apiBase}/products/${encodeURIComponent(productId)}`);
  return { title: r.ok ? (r.data.translations[ctx.store.defaultLocale]?.title ?? t("products.title")) : t("products.title") };
}

/** Product editor for an existing product (full aggregate save with optimistic concurrency). */
export default async function ProductPage({ params }: { params: Params }) {
  const { org, store, productId } = await params;
  const ctx = await requireStoreContext(Promise.resolve({ org, store }));
  const { t } = await getI18n();
  const [product, data] = await Promise.all([load<ProductDetail>(`${ctx.apiBase}/products/${encodeURIComponent(productId)}`, { notFoundOn404: true }), loadProductEditorData(ctx)]);
  if (!product.ok) {
    return (
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
        <PageHeader title={t("products.title")} breadcrumbs={[{ label: t("products.title"), href: `${ctx.basePath}/products` }]} />
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={product.error} />
        </div>
      </div>
    );
  }
  const resolvedPrices = await loadResolvedPrices(
    ctx,
    product.data.variants.map((v) => v.id),
  );
  // Remounts the editor with fresh data after every save (updatedAt changes).
  return <ProductForm key={product.data.updatedAt} product={product.data} data={data} resolvedPrices={resolvedPrices} media={mediaConfig()} />;
}
