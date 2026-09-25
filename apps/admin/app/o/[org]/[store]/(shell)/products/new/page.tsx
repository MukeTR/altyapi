import type { Metadata } from "next";
import { ProductForm } from "@/components/products/product-form";
import { mediaConfig } from "@/lib/commerce/media-server";
import { loadProductEditorData } from "@/lib/commerce/product-editor-data";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("products.new.title") };
}

export default async function NewProductPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const data = await loadProductEditorData(ctx);
  return <ProductForm product={null} data={data} resolvedPrices={null} media={mediaConfig()} />;
}
