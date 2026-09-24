"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { ProductDetailDto } from "@altyapi/catalog";
import { formatMoney } from "@/lib/format";

export interface VariantSelection {
  variant: ProductDetailDto["variants"][number] | null;
}

/**
 * Variant picker. Unavailable combinations stay selectable but are marked, so shoppers can
 * see what exists; the selected variant id is reflected in the URL for sharing.
 */
export function ProductOptions({
  product,
  initialVariantId,
  picker,
  locale,
  labels,
  children,
  onVariantChangeEvent = "sf:variant",
}: {
  product: ProductDetailDto;
  initialVariantId: string | null;
  picker: "buttons" | "dropdown";
  locale: string;
  labels: { soldOut: string; lowStock: string };
  /** Purchase controls rendered below the picker; receives the resolved variant. */
  children?: (variant: ProductDetailDto["variants"][number] | null) => ReactNode;
  onVariantChangeEvent?: string;
}) {
  const initial = product.variants.find((v) => v.id === initialVariantId) ?? product.variants.find((v) => v.available) ?? product.variants[0] ?? null;
  const [selected, setSelected] = useState<string[]>(() =>
    product.options.map((o) => o.values.find((val) => initial?.optionValueIds.includes(val.id))?.id ?? o.values[0]?.id ?? ""),
  );
  const variant = useMemo(
    () => product.variants.find((v) => selected.every((id) => v.optionValueIds.includes(id))) ?? (product.options.length ? null : product.variants[0] ?? null),
    [selected, product],
  );

  function choose(optionIndex: number, valueId: string) {
    const next = [...selected];
    next[optionIndex] = valueId;
    setSelected(next);
    const v = product.variants.find((x) => next.every((id) => x.optionValueIds.includes(id)));
    if (v) {
      const url = new URL(window.location.href);
      url.searchParams.set("variant", v.id);
      window.history.replaceState(null, "", url);
      window.dispatchEvent(new CustomEvent(onVariantChangeEvent, { detail: { variantId: v.id } }));
    }
  }

  const availableWith = (optionIndex: number, valueId: string) =>
    product.variants.some((v) => v.available && v.optionValueIds.includes(valueId) && selected.every((id, i) => i === optionIndex || v.optionValueIds.includes(id)));

  return (
    <div className="flex flex-col gap-5">
      <div className="text-2xl">
        {variant?.price ? (
          <span className="inline-flex items-baseline gap-3">
            <span className={variant.price.compareAtAmount ? "text-sale font-semibold" : "font-semibold"}>
              {formatMoney(variant.price.amount, variant.price.currency, locale)}
            </span>
            {variant.price.compareAtAmount && <s className="text-base text-muted-fg">{formatMoney(variant.price.compareAtAmount, variant.price.currency, locale)}</s>}
          </span>
        ) : null}
      </div>
      {product.options.map((o, oi) => (
        <fieldset key={o.id} className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">
            {o.name}: <span className="text-muted-fg">{o.values.find((v) => v.id === selected[oi])?.value}</span>
          </legend>
          {picker === "dropdown" ? (
            <select className="rounded-theme border border-line bg-surface px-3 py-2" value={selected[oi]} onChange={(e) => choose(oi, e.target.value)}>
              {o.values.map((val) => (
                <option key={val.id} value={val.id}>
                  {val.value}
                  {availableWith(oi, val.id) ? "" : ` — ${labels.soldOut}`}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex flex-wrap gap-2">
              {o.values.map((val) => {
                const active = selected[oi] === val.id;
                const avail = availableWith(oi, val.id);
                return (
                  <button
                    key={val.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => choose(oi, val.id)}
                    className={`flex items-center gap-2 rounded-button border px-4 py-2 text-sm ${active ? "border-fg" : "border-line"} ${avail ? "" : "text-muted-fg line-through"}`}
                  >
                    {val.swatchColor && <span className="h-4 w-4 rounded-full border border-line" style={{ background: val.swatchColor }} aria-hidden />}
                    {val.value}
                  </button>
                );
              })}
            </div>
          )}
        </fieldset>
      ))}
      {variant && !variant.available && <p className="text-sm font-medium text-error">{labels.soldOut}</p>}
      {variant?.lowStockQuantity && <p className="text-sm text-sale">{labels.lowStock.replace("{n}", String(variant.lowStockQuantity))}</p>}
      {children?.(variant)}
    </div>
  );
}
