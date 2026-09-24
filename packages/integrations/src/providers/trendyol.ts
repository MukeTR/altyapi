import { z } from "zod";
import type { RateRule } from "../http";
import { toMinor } from "../money";
import type { Connector, ConnectorContext, ExternalListingInput, ExternalOrderInput, NormalizedOrderStatus, ProviderDefinition } from "../types";

/**
 * Trendyol Marketplace (read only). The merchant's own API key/secret, Basic auth and the
 * mandatory `"<sellerId> - <integrator>"` User-Agent. Orders come from the shipment-package
 * stream, filtered by last modification date; stock and price from the approved-product
 * inventory-and-price filter. Writes stay with the merchant's integrator, whose next sync
 * would otherwise overwrite them.
 */
const BASES = { prod: "https://apigw.trendyol.com", stage: "https://stageapigw.trendyol.com" } as const;
const ORDERS_RATE: RateRule = { key: "orders", limit: 900, windowMs: 60_000 };
const PRODUCTS_RATE: RateRule = { key: "products", limit: 1800, windowMs: 60_000 };
const WINDOW_MS = 14 * 86_400_000;
const OVERLAP_MS = 10 * 60_000;

const credentialsSchema = z.object({
  apiKey: z.string().trim().min(8).max(200),
  apiSecret: z.string().trim().min(8).max(200),
});
const settingsSchema = z.object({
  sellerId: z.number().int().positive(),
  /** "SelfIntegration" for the merchant's own integration, or the integrator company name. */
  integratorName: z.string().trim().regex(/^[A-Za-z0-9 ]{1,30}$/).default("SelfIntegration"),
  environment: z.enum(["prod", "stage"]).default("prod"),
  /** The order stream only exposes the last three months. */
  initialDays: z.number().int().min(1).max(90).default(30),
});

type Credentials = z.infer<typeof credentialsSchema>;
type Settings = z.infer<typeof settingsSchema>;

interface TyLine {
  id?: number;
  merchantSku?: string | null;
  sku?: string | null;
  barcode?: string | null;
  productName?: string | null;
  quantity?: number;
  price?: number | null;
  orderLineItemStatusName?: string | null;
}

interface TyPackage {
  id: number;
  orderNumber?: string;
  status?: string;
  shipmentPackageStatus?: string;
  totalPrice?: number;
  currencyCode?: string;
  customerFirstName?: string | null;
  customerLastName?: string | null;
  shipmentAddress?: { city?: string | null; district?: string | null } | null;
  cargoProviderName?: string | null;
  cargoTrackingNumber?: number | string | null;
  lines?: TyLine[];
  orderDate?: number;
  lastModifiedDate?: number;
}

/** Shipment package statuses published by Trendyol. */
const STATUS: Record<string, NormalizedOrderStatus> = {
  Awaiting: "awaiting_approval",
  Created: "processing",
  Verified: "processing",
  Picking: "processing",
  UnPacked: "processing",
  Repack: "processing",
  Invoiced: "ready_to_ship",
  Shipped: "shipped",
  AtCollectionPoint: "shipped",
  UnDelivered: "undelivered",
  Delivered: "delivered",
  Cancelled: "cancelled",
  UnSupplied: "cancelled",
  Returned: "returned",
};

class TrendyolConnector implements Connector {
  private readonly base: string;
  private readonly headers: Record<string, string>;

  constructor(private readonly ctx: ConnectorContext<Credentials, Settings>) {
    this.base = BASES[ctx.settings.environment];
    this.headers = {
      authorization: `Basic ${Buffer.from(`${ctx.credentials.apiKey}:${ctx.credentials.apiSecret}`, "utf8").toString("base64")}`,
      "user-agent": `${ctx.settings.sellerId} - ${ctx.settings.integratorName}`,
    };
  }

  private get<T>(path: string, query: Record<string, string | number | undefined>, rate: RateRule) {
    const url = new URL(`${this.base}${path}`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    return this.ctx.http.request<T>({ method: "GET", url: url.toString(), headers: this.headers, rate }).then((r) => r.data);
  }

  async verify() {
    try {
      await this.get(`/integration/order/sellers/${this.ctx.settings.sellerId}/orders`, { page: 0, size: 1 }, ORDERS_RATE);
      return { ok: true as const, label: `Trendyol satıcı ${this.ctx.settings.sellerId}` };
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : String(err) };
    }
  }

  private mapPackage(p: TyPackage): ExternalOrderInput {
    const currency = (p.currencyCode ?? this.ctx.defaultCurrency).toUpperCase();
    const raw = p.shipmentPackageStatus ?? p.status ?? null;
    return {
      externalId: String(p.id),
      externalNumber: p.orderNumber ?? null,
      channel: "Trendyol",
      rawStatus: raw,
      status: raw ? STATUS[raw] ?? "unknown" : "unknown",
      currency,
      total: toMinor(p.totalPrice, currency),
      lines: (p.lines ?? []).map((l) => ({
        externalId: l.id != null ? String(l.id) : null,
        sku: l.merchantSku ?? l.sku ?? null,
        barcode: l.barcode ?? null,
        name: l.productName ?? "—",
        quantity: Number(l.quantity ?? 0),
        unitPrice: toMinor(l.price, currency)?.toString() ?? null,
        rawStatus: l.orderLineItemStatusName ?? null,
      })),
      shipping: p.cargoProviderName || p.cargoTrackingNumber ? { carrier: p.cargoProviderName ?? null, trackingNumber: p.cargoTrackingNumber != null ? String(p.cargoTrackingNumber) : null } : null,
      customer: {
        name: [p.customerFirstName, p.customerLastName].filter(Boolean).join(" ") || null,
        city: p.shipmentAddress?.city ?? null,
        district: p.shipmentAddress?.district ?? null,
      },
      orderedAt: p.orderDate ? new Date(p.orderDate) : null,
      externalUpdatedAt: p.lastModifiedDate ? new Date(p.lastModifiedDate) : null,
    };
  }

  /** Walks the modification-date stream in windows of at most 14 days. */
  async pullOrders(cursor: Record<string, unknown>) {
    const now = Date.now();
    const since = Number(cursor.since ?? now - this.ctx.settings.initialDays * 86_400_000);
    const until = Number(cursor.until ?? Math.min(now, since + WINDOW_MS));
    const data = await this.get<{ content?: TyPackage[]; hasMore?: boolean; nextCursor?: string }>(
      `/integration/order/sellers/${this.ctx.settings.sellerId}/orders/stream`,
      {
        size: 200,
        lastModifiedStartDate: since,
        lastModifiedEndDate: until,
        ...(cursor.next ? { nextCursor: String(cursor.next) } : {}),
      },
      ORDERS_RATE,
    );
    const items = (data?.content ?? []).map((p) => this.mapPackage(p));
    if (data?.hasMore && data.nextCursor) return { items, cursor: { since, until, next: data.nextCursor }, done: false };
    // Window finished: continue with the next window, or finish the pass with an overlap.
    if (until < now - OVERLAP_MS) return { items, cursor: { since: until }, done: false };
    return { items, cursor: { since: until - OVERLAP_MS }, done: true };
  }

  async pullListings(cursor: Record<string, unknown>) {
    const page = Number(cursor.page ?? 0);
    const data = await this.get<{
      content?: { contentId?: number | string; productMainId?: string; variants?: { variantId?: number | string; barcode?: string; salePrice?: number; listPrice?: number; quantity?: number; stockCode?: string; stockLastModifiedDate?: number | null }[] }[];
      nextPageToken?: string;
      totalPages?: number;
    }>(
      `/integration/product/sellers/${this.ctx.settings.sellerId}/products/approved/inventory-and-price`,
      { size: 100, ...(cursor.token ? { nextPageToken: String(cursor.token) } : { page }) },
      PRODUCTS_RATE,
    );
    const currency = this.ctx.defaultCurrency;
    const items: ExternalListingInput[] = [];
    for (const c of data?.content ?? []) {
      for (const v of c.variants ?? []) {
        items.push({
          externalId: String(v.variantId ?? v.barcode),
          sku: v.stockCode ?? null,
          barcode: v.barcode ?? null,
          title: null,
          stock: v.quantity ?? null,
          price: toMinor(v.salePrice, currency),
          listPrice: toMinor(v.listPrice, currency),
          currency,
          active: null,
          externalUpdatedAt: v.stockLastModifiedDate ? new Date(v.stockLastModifiedDate) : null,
        });
      }
    }
    if (!(data?.content ?? []).length) return { items, cursor: {}, done: true };
    if (data?.nextPageToken) return { items, cursor: { token: data.nextPageToken }, done: false };
    if (data?.totalPages !== undefined && page + 1 < data.totalPages) return { items, cursor: { page: page + 1 }, done: false };
    return { items, cursor: {}, done: true };
  }
}

export const trendyolProvider: ProviderDefinition<Credentials, Settings> = {
  id: "trendyol",
  name: "Trendyol",
  kind: "marketplace",
  docs: {
    status: "verified",
    sources: ["https://developers.trendyol.com (Sipariş ve Ürün Entegrasyonu)", "github.com/loncadev/lonca @lonca/trendyol (2026-08)"],
    notes: [
      "Yalnızca okuma: stok/fiyat yazımı entegratörünüzün senkronuyla çakışacağı için entegratörde yapılmalı.",
      "Siparişler orders/stream uç noktasından son değişiklik tarihine göre çekilir (son 3 ay).",
    ],
  },
  capabilities: { readOrders: true, readListings: true, writeStock: false, writePrice: false },
  credentialsSchema,
  settingsSchema,
  credentialFields: ["apiKey", "apiSecret"],
  defaultPollMinutes: 10,
  hosts: ["apigw.trendyol.com", "stageapigw.trendyol.com"],
  create: (ctx) => new TrendyolConnector(ctx),
};
