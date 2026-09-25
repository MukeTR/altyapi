import type { LocalizedText, ProductDetail, ProductVariant } from "@/lib/commerce/types";

/**
 * Client-side editing model of a product and its conversion to the API's write body. The API
 * replaces the whole aggregate on save (PUT), so the draft always carries every field; variants
 * refer to option values by stable client keys so renaming a value never loses its variant.
 */

export interface TranslationDraft {
  title: string;
  handle: string;
  descriptionHtml: string;
  seoTitle: string;
  seoDescription: string;
}

export interface OptionValueDraft {
  key: string;
  id?: string;
  value: LocalizedText;
  swatchColor: string | null;
  swatchAssetId: string | null;
}

export interface OptionDraft {
  key: string;
  id?: string;
  name: LocalizedText;
  values: OptionValueDraft[];
}

export interface VariantDraft {
  key: string;
  id?: string;
  /** Option value keys, one per option, in option order. */
  valueKeys: string[];
  sku: string;
  barcode: string;
  price: string | null;
  compareAtPrice: string | null;
  cost: string | null;
  weightGrams: string;
  requiresShipping: boolean;
  trackInventory: boolean;
  allowBackorder: boolean;
  taxClassId: string | null;
  digitalAssetId: string | null;
  externalRef: string | null;
  /** Units put into the default location when a new variant is created. */
  initialStock: string;
  inventory: ProductVariant["inventory"];
}

export interface MediaDraft {
  key: string;
  assetId: string;
  /** Preview URL (existing media: from the object key; new uploads: the asset URL). */
  preview: string | null;
  alt: LocalizedText;
  /** Variant keys this image belongs to (empty: all variants). */
  variantKeys: string[];
}

export interface ProductDraft {
  status: "draft" | "active" | "archived";
  kind: "physical" | "digital";
  translations: Record<string, TranslationDraft>;
  vendorName: string;
  productType: string;
  categoryId: string | null;
  taxClassId: string | null;
  tags: string[];
  collectionIds: string[];
  options: OptionDraft[];
  variants: VariantDraft[];
  media: MediaDraft[];
  weightGrams: string;
  dimensions: { length: string; width: string; height: string };
  publishAt: string | null;
  attributes: ProductDetail["attributes"];
  externalRef: string | null;
}

export const MAX_OPTIONS = 3;
export const MAX_VARIANTS = 250;

let seq = 0;
export function newKey(prefix: string): string {
  seq += 1;
  return `${prefix}${seq}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyTranslation(): TranslationDraft {
  return { title: "", handle: "", descriptionHtml: "", seoTitle: "", seoDescription: "" };
}

export function emptyVariant(valueKeys: string[] = [], from?: VariantDraft): VariantDraft {
  return {
    key: newKey("v"),
    valueKeys,
    sku: "",
    barcode: "",
    price: from?.price ?? null,
    compareAtPrice: from?.compareAtPrice ?? null,
    cost: from?.cost ?? null,
    weightGrams: from?.weightGrams ?? "",
    requiresShipping: from?.requiresShipping ?? true,
    trackInventory: from?.trackInventory ?? true,
    allowBackorder: from?.allowBackorder ?? false,
    taxClassId: from?.taxClassId ?? null,
    digitalAssetId: null,
    externalRef: null,
    initialStock: "",
    inventory: null,
  };
}

export function newProductDraft(locales: readonly string[]): ProductDraft {
  return {
    status: "draft",
    kind: "physical",
    translations: Object.fromEntries(locales.map((l) => [l, emptyTranslation()])),
    vendorName: "",
    productType: "",
    categoryId: null,
    taxClassId: null,
    tags: [],
    collectionIds: [],
    options: [],
    variants: [emptyVariant()],
    media: [],
    weightGrams: "",
    dimensions: { length: "", width: "", height: "" },
    publishAt: null,
    attributes: [],
    externalRef: null,
  };
}

/** Draft of an existing product. `manualCollectionIds` filters out automated memberships (the API rejects them on write). */
export function draftFromDetail(p: ProductDetail, locales: readonly string[], manualCollectionIds: ReadonlySet<string>, previewFor: (objectKey: string) => string | null): ProductDraft {
  const valueKeyById = new Map<string, string>();
  const options: OptionDraft[] = p.options.map((o) => ({
    key: newKey("o"),
    id: o.id,
    name: { ...o.name },
    values: o.values.map((v) => {
      const key = newKey("ov");
      valueKeyById.set(v.id, key);
      return { key, id: v.id, value: { ...v.value }, swatchColor: v.swatchColor, swatchAssetId: v.swatchAssetId };
    }),
  }));
  // optionValueIds are stored sorted; order them by option position.
  const optionOfValue = new Map<string, number>();
  p.options.forEach((o, oi) => o.values.forEach((v) => optionOfValue.set(v.id, oi)));
  const variants: VariantDraft[] = p.variants.map((v) => {
    const keys: string[] = new Array(p.options.length).fill("");
    for (const id of v.optionValueIds) {
      const oi = optionOfValue.get(id);
      const key = valueKeyById.get(id);
      if (oi !== undefined && key) keys[oi] = key;
    }
    return {
      key: newKey("v"),
      id: v.id,
      valueKeys: keys,
      sku: v.sku ?? "",
      barcode: v.barcode ?? "",
      price: v.price?.amount ?? null,
      compareAtPrice: v.price?.compareAtAmount ?? null,
      cost: v.cost,
      weightGrams: v.weightGrams !== null ? String(v.weightGrams) : "",
      requiresShipping: v.requiresShipping,
      trackInventory: v.trackInventory,
      allowBackorder: v.allowBackorder,
      taxClassId: v.taxClassId,
      digitalAssetId: v.digitalAssetId,
      externalRef: v.externalRef,
      initialStock: "",
      inventory: v.inventory,
    };
  });
  const variantKeyById = new Map(p.variants.map((v, i) => [v.id, variants[i]!.key]));
  const translations: Record<string, TranslationDraft> = {};
  for (const l of new Set([...locales, ...Object.keys(p.translations)])) {
    const tr = p.translations[l];
    translations[l] = tr
      ? { title: tr.title, handle: tr.handle, descriptionHtml: tr.descriptionHtml ?? "", seoTitle: tr.seoTitle ?? "", seoDescription: tr.seoDescription ?? "" }
      : emptyTranslation();
  }
  return {
    status: p.status,
    kind: p.kind,
    translations,
    vendorName: p.vendor?.name ?? "",
    productType: p.productType ?? "",
    categoryId: p.categoryId,
    taxClassId: p.taxClassId,
    tags: [...p.tags],
    collectionIds: p.collectionIds.filter((id) => manualCollectionIds.has(id)),
    options,
    variants,
    media: p.media.map((m) => ({
      key: newKey("m"),
      assetId: m.assetId,
      preview: previewFor(m.objectKey),
      alt: { ...m.alt },
      variantKeys: m.variantIds.map((id) => variantKeyById.get(id)).filter((k): k is string => Boolean(k)),
    })),
    weightGrams: p.weightGrams !== null ? String(p.weightGrams) : "",
    dimensions: p.dimensionsMm
      ? { length: String(p.dimensionsMm.length), width: String(p.dimensionsMm.width), height: String(p.dimensionsMm.height) }
      : { length: "", width: "", height: "" },
    publishAt: p.publishAt,
    attributes: p.attributes,
    externalRef: p.externalRef,
  };
}

/** Text of a localized value in the default language (falls back to any language). */
export function labelIn(map: LocalizedText, locale: string): string {
  return (map[locale] ?? "").trim() || Object.values(map).find((v) => v.trim())?.trim() || "";
}

/** Variant title from its option values, e.g. "Kırmızı / M". */
export function variantTitle(draft: Pick<ProductDraft, "options">, variant: Pick<VariantDraft, "valueKeys">, locale: string): string {
  const usable = draft.options.filter((o) => o.values.length > 0);
  return variant.valueKeys
    .map((k, oi) => usable[oi]?.values.find((v) => v.key === k))
    .map((v) => (v ? labelIn(v.value, locale) : "?"))
    .join(" / ");
}

/**
 * Rebuilds the variant list as every combination of the option values. Existing variants keep
 * their data when their combination still exists; new combinations copy prices from the first
 * variant so the merchant only adjusts differences.
 */
export function regenerateVariants(options: OptionDraft[], current: VariantDraft[]): VariantDraft[] {
  const usable = options.filter((o) => o.values.length > 0);
  if (usable.length === 0) {
    const keep = current.find((v) => v.valueKeys.length === 0) ?? current[0];
    return [keep ? { ...keep, valueKeys: [] } : emptyVariant()];
  }
  let combos: string[][] = [[]];
  for (const o of usable) combos = combos.flatMap((c) => o.values.map((v) => [...c, v.key]));
  const template = current[0];
  const byTuple = new Map<string, VariantDraft>();
  for (const v of current) {
    const tuple = v.valueKeys.filter(Boolean).join("|");
    if (!byTuple.has(tuple)) byTuple.set(tuple, v);
  }
  return combos.slice(0, MAX_VARIANTS).map((keys) => {
    const tuple = keys.join("|");
    const existing = byTuple.get(tuple) ?? findSubset(current, keys);
    return existing ? { ...existing, valueKeys: keys } : emptyVariant(keys, template);
  });
}

/** A variant whose keys are all contained in the new combination (after adding an option). */
function findSubset(current: VariantDraft[], keys: string[]): VariantDraft | undefined {
  return current.find((v) => {
    const own = v.valueKeys.filter(Boolean);
    return own.length > 0 && own.every((k) => keys.includes(k)) && own.length === keys.length - 1;
  });
}

export function combinationCount(options: OptionDraft[]): number {
  return options.filter((o) => o.values.length > 0).reduce((n, o) => n * o.values.length, 1);
}

function nonEmpty(map: LocalizedText): LocalizedText {
  return Object.fromEntries(Object.entries(map).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, v.trim()]));
}

function intOrNull(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** API write body (POST create / PUT update). */
export function draftToInput(draft: ProductDraft, opts: { defaultLocale: string; isNew: boolean; expectedUpdatedAt?: string }) {
  const { defaultLocale } = opts;
  const usableOptions = draft.options.filter((o) => o.values.length > 0);
  const translations: Record<string, Record<string, unknown>> = {};
  for (const [locale, tr] of Object.entries(draft.translations)) {
    if (!tr.title.trim() && locale !== defaultLocale) continue;
    translations[locale] = {
      title: tr.title.trim(),
      ...(tr.handle.trim() ? { handle: tr.handle.trim() } : {}),
      descriptionHtml: tr.descriptionHtml,
      seoTitle: tr.seoTitle.trim() || null,
      seoDescription: tr.seoDescription.trim() || null,
    };
  }
  const variantIndexByKey = new Map(draft.variants.map((v, i) => [v.key, i]));
  const dims = [draft.dimensions.length, draft.dimensions.width, draft.dimensions.height].map(intOrNull);
  return {
    status: draft.status,
    kind: draft.kind,
    translations,
    vendorName: draft.vendorName.trim() || null,
    productType: draft.productType.trim() || null,
    categoryId: draft.categoryId,
    taxClassId: draft.taxClassId,
    tags: draft.tags,
    collectionIds: draft.collectionIds,
    options: usableOptions.map((o) => ({
      ...(o.id ? { id: o.id } : {}),
      name: nonEmpty(o.name),
      values: o.values.map((v) => ({ ...(v.id ? { id: v.id } : {}), value: nonEmpty(v.value), swatchColor: v.swatchColor, swatchAssetId: v.swatchAssetId })),
    })),
    variants: draft.variants.map((v) => {
      const optionValues = v.valueKeys.map((k, oi) => {
        const value = usableOptions[oi]?.values.find((x) => x.key === k);
        return value ? labelIn(value.value, defaultLocale) : "";
      });
      const stock = intOrNull(v.initialStock);
      return {
        ...(v.id ? { id: v.id } : {}),
        optionValues,
        sku: v.sku.trim() || null,
        barcode: v.barcode.trim() || null,
        price: v.price ?? "",
        compareAtPrice: v.compareAtPrice,
        cost: v.cost,
        weightGrams: intOrNull(v.weightGrams),
        requiresShipping: v.requiresShipping,
        trackInventory: v.trackInventory,
        allowBackorder: v.allowBackorder,
        taxClassId: v.taxClassId,
        digitalAssetId: v.digitalAssetId,
        externalRef: v.externalRef,
        ...(!v.id && v.trackInventory && stock ? { initialStock: [{ quantity: stock }] } : {}),
      };
    }),
    media: draft.media.map((m) => ({
      assetId: m.assetId,
      alt: nonEmpty(m.alt),
      variantIndexes: m.variantKeys.map((k) => variantIndexByKey.get(k)).filter((i): i is number => i !== undefined),
    })),
    attributes: draft.attributes,
    weightGrams: intOrNull(draft.weightGrams),
    dimensionsMm: dims.every((d) => d !== null) ? { length: dims[0]!, width: dims[1]!, height: dims[2]! } : null,
    publishAt: draft.status === "active" ? draft.publishAt : null,
    externalRef: draft.externalRef,
    ...(opts.expectedUpdatedAt ? { expectedUpdatedAt: opts.expectedUpdatedAt } : {}),
  };
}

/**
 * Client checks before sending (the API validates everything again). Returns field paths in the
 * API's own format ("translations.tr.title", "variants.0.price") so both sources render alike.
 */
export function validateDraft(draft: ProductDraft, defaultLocale: string): Record<string, "required" | "compareAt" | "optionName" | "optionValue"> {
  const out: Record<string, "required" | "compareAt" | "optionName" | "optionValue"> = {};
  if (!draft.translations[defaultLocale]?.title.trim()) out[`translations.${defaultLocale}.title`] = "required";
  draft.options.forEach((o, oi) => {
    if (!o.name[defaultLocale]?.trim()) out[`options.${oi}.name`] = "optionName";
    o.values.forEach((v, vi) => {
      if (!v.value[defaultLocale]?.trim()) out[`options.${oi}.values.${vi}`] = "optionValue";
    });
  });
  draft.variants.forEach((v, i) => {
    if (v.price === null) out[`variants.${i}.price`] = "required";
    else if (v.compareAtPrice !== null && BigInt(v.compareAtPrice) <= BigInt(v.price)) out[`variants.${i}.compareAtPrice`] = "compareAt";
  });
  return out;
}
