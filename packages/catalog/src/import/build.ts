import { slugify } from "@altyapi/commerce-core";
import type { ImportOptions } from "@altyapi/database";
import type { ProductInput } from "../products";
import { parseBoolStatus, parseInteger, parseMoney, type ImportField } from "./mapping";

export interface RowError {
  rowNumber: number;
  field: string;
  message: string;
}

export interface BuiltProduct {
  input: ProductInput;
  imageUrls: string[];
  categoryHandle: string | null;
  /** Row → variant index, so errors and matches can be tied back to rows. */
  rowNumbers: number[];
  externalRef: string | null;
  handle: string;
}

/**
 * Turns the rows of one group into a ProductInput. Product-level fields come from the first
 * row that has them; each row is one variant. Returns row-level errors instead of throwing.
 */
export function buildProductFromRows(
  rows: { rowNumber: number; data: Record<string, string> }[],
  mapping: Partial<Record<ImportField, string>>,
  options: ImportOptions & { locale: string; currency: string },
): { product: BuiltProduct | null; errors: RowError[] } {
  const errors: RowError[] = [];
  const val = (row: { data: Record<string, string> }, f: ImportField) => (mapping[f] ? (row.data[mapping[f]!] ?? "").trim() : "");
  const first = (f: ImportField) => rows.map((r) => val(r, f)).find((v) => v !== "") ?? "";

  const title = first("title");
  if (!title) {
    errors.push({ rowNumber: rows[0]!.rowNumber, field: "title", message: "errors.import.title_required" });
    return { product: null, errors };
  }

  const optionNames: string[] = [];
  for (const n of [1, 2, 3] as const) {
    const hasValues = rows.some((r) => val(r, `option${n}_value` as ImportField));
    if (!hasValues) break;
    const name = first(`option${n}_name` as ImportField) || (mapping[`option${n}_value` as ImportField] ?? `Seçenek ${n}`);
    optionNames.push(name);
  }

  const optionValues: string[][] = optionNames.map(() => []);
  const variants: ProductInput["variants"] = [];
  const rowNumbers: number[] = [];
  for (const row of rows) {
    const rowErrors: RowError[] = [];
    const values = optionNames.map((_, i) => val(row, `option${i + 1}_value` as ImportField));
    values.forEach((v, i) => {
      if (!v) rowErrors.push({ rowNumber: row.rowNumber, field: `option${i + 1}_value`, message: "errors.import.option_value_required" });
      else if (!optionValues[i]!.some((x) => x.toLocaleLowerCase("tr") === v.toLocaleLowerCase("tr"))) optionValues[i]!.push(v);
    });
    const money = (f: ImportField, required: boolean): bigint | null => {
      const raw = val(row, f);
      if (!raw) {
        if (required) rowErrors.push({ rowNumber: row.rowNumber, field: f, message: "errors.import.value_required" });
        return null;
      }
      try {
        return parseMoney(raw, options.currency);
      } catch {
        rowErrors.push({ rowNumber: row.rowNumber, field: f, message: "errors.import.invalid_amount" });
        return null;
      }
    };
    const int = (f: ImportField): number | null => {
      const raw = val(row, f);
      if (!raw) return null;
      try {
        return parseInteger(raw);
      } catch {
        rowErrors.push({ rowNumber: row.rowNumber, field: f, message: "errors.import.invalid_integer" });
        return null;
      }
    };
    const price = money("price", true);
    const compareAt = money("compare_at_price", false);
    const cost = money("cost", false);
    const qty = int("inventory_quantity");
    const weight = int("weight_grams");
    if (qty !== null && qty < 0) rowErrors.push({ rowNumber: row.rowNumber, field: "inventory_quantity", message: "errors.import.negative_quantity" });
    if (price !== null && compareAt !== null && compareAt <= price) {
      rowErrors.push({ rowNumber: row.rowNumber, field: "compare_at_price", message: "errors.pricing.compare_at_not_higher" });
    }
    if (rowErrors.length) {
      errors.push(...rowErrors);
      continue;
    }
    variants.push({
      optionValues: values,
      sku: val(row, "sku") || null,
      barcode: val(row, "barcode") || null,
      price: price!,
      compareAtPrice: compareAt,
      cost,
      weightGrams: weight,
      trackInventory: true,
      allowBackorder: false,
      externalRef: val(row, "variant_external_ref") || null,
      ...(qty !== null ? { initialStock: [{ quantity: qty }] } : {}),
    });
    rowNumbers.push(row.rowNumber);
  }
  if (!variants.length) return { product: null, errors };

  const handle = first("handle") || slugify(title);
  const statusRaw = first("status");
  const tags = first("tags")
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 100);
  const imageUrls = [...new Set(rows.flatMap((r) => val(r, "image_urls").split(/[,;|\s]+/).filter((u) => /^https?:\/\//.test(u))))].slice(0, 20);

  const input: ProductInput = {
    status: statusRaw ? parseBoolStatus(statusRaw) : options.publishImported ? "active" : "draft",
    kind: "physical",
    translations: {
      [options.locale]: {
        title,
        handle,
        descriptionHtml: first("description"),
        seoTitle: first("seo_title").slice(0, 70) || null,
        seoDescription: first("seo_description").slice(0, 320) || null,
      },
    },
    vendorName: first("vendor") || null,
    productType: first("product_type") || null,
    tags,
    collectionIds: [],
    options: optionNames.map((name, i) => ({ name: { [options.locale]: name }, values: optionValues[i]!.map((v) => ({ value: { [options.locale]: v } })) })),
    variants,
    media: [],
    attributes: [],
    currency: options.currency,
    externalRef: first("external_ref") || null,
  };
  return {
    product: { input, imageUrls, categoryHandle: first("category") || null, rowNumbers, externalRef: input.externalRef ?? null, handle },
    errors,
  };
}
