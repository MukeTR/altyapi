"use client";

import type { ProductDetailDto } from "@altyapi/catalog";
import { ProductOptions } from "./product-options";

/** Variant selection and purchase controls for the product page. */
export function ProductPurchase({
  product,
  initialVariantId,
  picker,
  locale,
  labels,
}: {
  product: ProductDetailDto;
  initialVariantId: string | null;
  picker: "buttons" | "dropdown";
  locale: string;
  currency: string;
  labels: { soldOut: string; lowStock: string; addToCart: string };
}) {
  return <ProductOptions product={product} initialVariantId={initialVariantId} picker={picker} locale={locale} labels={labels} />;
}
