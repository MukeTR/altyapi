"use client";

import { useEffect } from "react";
import type { ProductDetailDto } from "@altyapi/catalog";
import { track } from "@/lib/client/track";
import { ProductOptions } from "./product-options";
import { AddToCart } from "./cart";

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
  useEffect(() => {
    const variant = product.variants.find((v) => v.id === initialVariantId) ?? product.variants.find((v) => v.available) ?? product.variants[0];
    if (!variant?.price) return;
    track("product_viewed", {
      productId: product.id,
      variantId: variant.id,
      value: variant.price.amount,
      currency: variant.price.currency,
      items: [{ itemId: variant.id, productId: product.id, title: product.title, unitPrice: variant.price.amount, quantity: 1 }],
    });
  }, [product, initialVariantId]);

  return (
    <ProductOptions product={product} initialVariantId={initialVariantId} picker={picker} locale={locale} labels={labels}>
      {(variant) => <AddToCart variantId={variant?.id ?? null} available={Boolean(variant?.available)} label={labels.addToCart} soldOutLabel={labels.soldOut} />}
    </ProductOptions>
  );
}
