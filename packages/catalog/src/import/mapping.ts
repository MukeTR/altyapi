import { fromDecimalString } from "@altyapi/commerce-core";
import { slugify } from "@altyapi/commerce-core";
import { searchNormalize } from "../text";

/** Import target fields. Keys are stored in mappings; values list header synonyms for auto-mapping. */
export const IMPORT_FIELDS = {
  handle: ["handle", "slug", "url", "seo url", "urun url"],
  title: ["title", "name", "product name", "urun adi", "urun ismi", "ad", "baslik", "isim", "urunadi"],
  description: ["description", "body", "body html", "aciklama", "urun aciklamasi", "detay", "aciklama html"],
  vendor: ["vendor", "brand", "marka", "uretici", "tedarikci"],
  product_type: ["type", "product type", "urun tipi", "tur"],
  category: ["category", "kategori", "kategori kodu"],
  tags: ["tags", "etiketler", "etiket"],
  status: ["status", "durum", "aktif", "published", "yayinda"],
  external_ref: ["external id", "id", "urun id", "urunid", "product id"],
  variant_external_ref: ["variant id", "varyant id", "varyantid"],
  sku: ["sku", "stok kodu", "stokkodu", "urun kodu", "model kodu", "variant sku", "kod"],
  barcode: ["barcode", "barkod", "gtin", "ean"],
  price: ["price", "fiyat", "satis fiyati", "satisfiyati", "variant price", "indirimli fiyat"],
  compare_at_price: ["compare at price", "piyasa fiyati", "liste fiyati", "eski fiyat", "variant compare at price"],
  cost: ["cost", "maliyet", "alis fiyati", "alisfiyati", "cost per item"],
  inventory_quantity: ["inventory", "quantity", "stok", "stok adedi", "stokadedi", "miktar", "variant inventory qty"],
  weight_grams: ["weight", "agirlik", "desi", "weight grams", "variant grams"],
  option1_name: ["option1 name", "secenek1 adi", "varyant1 adi"],
  option1_value: ["option1 value", "secenek1", "varyant1", "renk"],
  option2_name: ["option2 name", "secenek2 adi", "varyant2 adi"],
  option2_value: ["option2 value", "secenek2", "varyant2", "beden"],
  option3_name: ["option3 name", "secenek3 adi"],
  option3_value: ["option3 value", "secenek3"],
  image_urls: ["image src", "images", "image", "resim", "resimler", "gorsel", "gorseller", "resim url"],
  seo_title: ["seo title", "meta title", "seo baslik"],
  seo_description: ["seo description", "meta description", "seo aciklama"],
} as const;

export type ImportField = keyof typeof IMPORT_FIELDS;
export const IMPORT_FIELD_KEYS = Object.keys(IMPORT_FIELDS) as ImportField[];

/** Suggests field → column mapping from header names (TR/EN synonyms, diacritic-insensitive). */
export function autoMap(columns: string[]): Partial<Record<ImportField, string>> {
  const norm = new Map(columns.map((c) => [searchNormalize(c.replace(/[._-]/g, " ")), c]));
  const out: Partial<Record<ImportField, string>> = {};
  const used = new Set<string>();
  for (const field of IMPORT_FIELD_KEYS) {
    for (const syn of IMPORT_FIELDS[field]) {
      const col = norm.get(searchNormalize(syn));
      if (col && !used.has(col)) {
        out[field] = col;
        used.add(col);
        break;
      }
    }
  }
  // "renk"/"beden" columns imply option names when no explicit name column exists.
  return out;
}

/**
 * Parses merchant-formatted decimals into minor units without floats:
 * "1.299,90" (TR), "1,299.90" (EN), "129,9", "129.90", "₺129,90".
 */
export function parseMoney(raw: string, currency: string): bigint {
  let v = raw.replace(/[^\d.,-]/g, "");
  if (!v) throw new Error("empty");
  const lastComma = v.lastIndexOf(",");
  const lastDot = v.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandSep = decimalSep === "," ? "." : ",";
    v = v.split(thousandSep).join("").replace(decimalSep, ".");
  } else if (lastComma >= 0) {
    v = /^\d{1,3}(,\d{3})+$/.test(v) ? v.replace(/,/g, "") : v.replace(",", ".");
  } else if (lastDot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(v) && v.split(".").length > 2) {
    v = v.replace(/\./g, "");
  }
  const m = /^(-?\d+)(?:\.(\d+))?$/.exec(v);
  if (!m) throw new Error("invalid");
  // Round half-up to the currency's minor unit.
  const units = currency === "JPY" ? 0 : 2;
  const frac = m[2] ?? "";
  const kept = frac.slice(0, units).padEnd(units, "0");
  let amount = fromDecimalString(`${m[1]}${units ? `.${kept}` : ""}`, currency).amount;
  if (frac.length > units && Number(frac[units]) >= 5) amount += 1n;
  if (amount < 0n) throw new Error("negative");
  return amount;
}

export function parseInteger(raw: string): number {
  const v = raw.replace(/[^\d-]/g, "");
  if (!/^-?\d+$/.test(v)) throw new Error("invalid");
  return Number(v);
}

export function parseBoolStatus(raw: string): "active" | "draft" | "archived" {
  const v = searchNormalize(raw);
  if (["1", "true", "evet", "aktif", "active", "yayinda", "published", "e"].includes(v)) return "active";
  if (["archived", "arsiv", "arsivlendi"].includes(v)) return "archived";
  return "draft";
}

export function groupKeyFor(data: Record<string, string>, mapping: Record<string, string>, groupBy: "handle" | "external_ref" | "none", rowNumber: number): string {
  const get = (f: ImportField) => (mapping[f] ? (data[mapping[f]!] ?? "").trim() : "");
  if (groupBy === "external_ref" && get("external_ref")) return `ext:${get("external_ref")}`;
  if (groupBy === "handle") {
    const h = get("handle") || slugify(get("title"));
    if (h) return `h:${h}`;
  }
  return `row:${String(rowNumber).padStart(9, "0")}`;
}
