import { Readable } from "node:stream";
import { z } from "zod";
import { readRows } from "@altyapi/catalog";
import { fetchRemoteDocument } from "@altyapi/storage";
import { ProviderHttpError } from "../http";
import { toMinor } from "../money";
import type { Connector, ConnectorContext, ExternalListingInput, ProviderDefinition } from "../types";

/**
 * Periodic read of an integrator's XML/CSV/XLSX export, for systems without an API. Uses the
 * product import parsers; the URL (which usually embeds an access token) is stored encrypted.
 */
const credentialsSchema = z.object({
  url: z.url().refine((u) => u.startsWith("https://"), "https_required"),
  username: z.string().max(200).optional(),
  password: z.string().max(200).optional(),
});

const column = z.string().trim().min(1).max(200);
const settingsSchema = z.object({
  format: z.enum(["csv", "xlsx", "xml"]),
  /** XML: path of the repeated product element, e.g. "Urunler.Urun". */
  xmlItemPath: z.string().max(200).optional(),
  /** XML: path of repeated variant elements inside an item. */
  xmlVariantPath: z.string().max(200).optional(),
  csvDelimiter: z.enum([",", ";", "\t", "|"]).optional(),
  mapping: z.object({
    sku: column,
    barcode: column.optional(),
    title: column.optional(),
    stock: column.optional(),
    price: column.optional(),
    listPrice: column.optional(),
  }),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
});

type Credentials = z.infer<typeof credentialsSchema>;
type Settings = z.infer<typeof settingsSchema>;

/** "1.234,56" / "1,234.56" / "1234,5" → "1234.56"-style decimal strings. */
export function normalizeDecimal(value: string | undefined): string | null {
  if (!value) return null;
  let v = value.replace(/[^\d.,-]/g, "");
  if (!v) return null;
  const lastComma = v.lastIndexOf(",");
  const lastDot = v.lastIndexOf(".");
  if (lastComma > lastDot) v = v.replace(/\./g, "").replace(",", ".");
  else v = v.replace(/,/g, "");
  return /^-?\d+(\.\d+)?$/.test(v) ? v : null;
}

class FeedConnector implements Connector {
  constructor(private readonly ctx: ConnectorContext<Credentials, Settings>) {}

  private async rows(limit?: number) {
    const { url, username, password } = this.ctx.credentials;
    let doc: { bytes: Buffer };
    try {
      doc = await fetchRemoteDocument(url, { basicAuth: username && password ? { username, password } : null });
    } catch (err) {
      throw new ProviderHttpError(0, `feed download failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const out: Record<string, string>[] = [];
    const s = this.ctx.settings;
    for await (const row of readRows(Readable.from(doc.bytes), s.format, {
      ...(s.csvDelimiter ? { csvDelimiter: s.csvDelimiter } : {}),
      ...(s.xmlItemPath ? { xmlItemPath: s.xmlItemPath } : {}),
      ...(s.xmlVariantPath ? { xmlVariantPath: s.xmlVariantPath } : {}),
    })) {
      out.push(row.data);
      if (limit && out.length >= limit) break;
    }
    return out;
  }

  async verify() {
    try {
      const sample = await this.rows(5);
      if (!sample.length) return { ok: false as const, message: "feed_empty" };
      if (!(this.ctx.settings.mapping.sku in sample[0]!)) return { ok: false as const, message: `column_not_found: ${this.ctx.settings.mapping.sku} (available: ${Object.keys(sample[0]!).slice(0, 30).join(", ")})` };
      return { ok: true as const, label: `${new URL(this.ctx.credentials.url).hostname} · ${this.ctx.settings.format.toUpperCase()}` };
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /** The whole export is one pass; unchanged rows are recognised by hash and skipped. */
  async pullListings() {
    const m = this.ctx.settings.mapping;
    const currency = this.ctx.settings.currency ?? this.ctx.defaultCurrency;
    const items: ExternalListingInput[] = [];
    const seen = new Set<string>();
    for (const r of await this.rows()) {
      const sku = r[m.sku]?.trim();
      if (!sku || seen.has(sku)) continue;
      seen.add(sku);
      const stock = m.stock ? normalizeDecimal(r[m.stock]) : null;
      items.push({
        externalId: sku,
        sku,
        barcode: m.barcode ? r[m.barcode]?.trim() || null : null,
        title: m.title ? r[m.title]?.trim() || null : null,
        stock: stock === null ? null : Math.max(0, Math.floor(Number(stock))),
        price: m.price ? toMinor(normalizeDecimal(r[m.price]), currency) : null,
        listPrice: m.listPrice ? toMinor(normalizeDecimal(r[m.listPrice]), currency) : null,
        currency,
        active: null,
        externalUpdatedAt: null,
      });
    }
    return { items, cursor: {}, done: true };
  }
}

export const feedProvider: ProviderDefinition<Credentials, Settings> = {
  id: "feed",
  name: "XML / CSV / Excel dışa aktarımı",
  kind: "feed",
  docs: {
    status: "verified",
    sources: ["Entegratörün kendi dışa aktarım dosyası (URL)"],
    notes: ["API'si olmayan entegratörler için: stok ve fiyat dosyası periyodik okunur. Yalnızca okuma."],
  },
  capabilities: { readOrders: false, readListings: true, writeStock: false, writePrice: false },
  credentialsSchema,
  settingsSchema,
  credentialFields: ["url", "username", "password"],
  defaultPollMinutes: 30,
  hosts: [],
  create: (ctx) => new FeedConnector(ctx),
};
