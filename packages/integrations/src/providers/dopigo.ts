import { z } from "zod";
import { parseProviderDate } from "../dates";
import { ProviderAuthError, ProviderHttpError, type RateRule } from "../http";
import { toMinor } from "../money";
import type { Connector, ConnectorContext, ExternalListingInput, ExternalOrderInput, NormalizedOrderStatus, ProviderDefinition } from "../types";

/**
 * Dopigo REST API (Django REST Framework). Token from the panel login, sent as
 * `Authorization: Token <token>`; list endpoints use limit/offset pages with a `next` link.
 * Field names and status choices come from the API's own OPTIONS schema; the limit of
 * 2 requests per second per endpoint comes from Dopigo's documentation.
 */
const BASE = "https://panel.dopigo.com";
const PAGE_SIZE = 100;
const rate = (endpoint: string): RateRule => ({ key: endpoint, limit: 2, windowMs: 1000 });

const credentialsSchema = z.object({
  username: z.string().trim().min(3).max(254),
  password: z.string().min(4).max(200),
});
const settingsSchema = z.object({});

type Credentials = z.infer<typeof credentialsSchema>;
type Settings = z.infer<typeof settingsSchema>;

interface Page<T> {
  count?: number;
  next?: string | null;
  results?: T[];
}

interface DopigoAddress {
  city?: string | null;
  district?: string | null;
}

interface DopigoOrder {
  id: number;
  service_name?: string | null;
  sales_channel?: string | null;
  service_value?: string | null;
  service_order_id?: string | null;
  service_created?: string | null;
  status?: string | null;
  total?: string | number | null;
  customer?: { full_name?: string | null; address?: DopigoAddress | null } | null;
  shipping_address?: DopigoAddress | null;
  items?: {
    id?: number;
    service_item_id?: string | null;
    sku?: string | null;
    name?: string | null;
    amount?: number | null;
    unit_price?: string | number | null;
    status?: string | null;
    service_shipment_code?: string | null;
    shipment_provider?: unknown;
  }[];
}

interface DopigoProduct {
  name?: string | null;
  products?: {
    id: number;
    sku?: string | null;
    barcode?: string | null;
    stock?: number | null;
    available_stock?: number | null;
    price?: string | number | null;
    price_currency?: string | null;
    listing_price?: string | number | null;
    meta?: { active?: boolean | null } | null;
  }[];
}

/** Order status choices from the API schema. */
const ORDER_STATUS: Record<string, NormalizedOrderStatus> = {
  pending: "awaiting_approval",
  waiting_shipment: "ready_to_ship",
  shipped: "shipped",
  cancelled: "cancelled",
  undefined: "unknown",
};

class DopigoConnector implements Connector {
  constructor(private readonly ctx: ConnectorContext<Credentials, Settings>) {}

  private async login(): Promise<string> {
    let token: string | undefined;
    try {
      const res = await this.ctx.http.request<{ token?: string }>({
        method: "POST",
        url: `${BASE}/users/get_auth_token/`,
        form: { username: this.ctx.credentials.username, password: this.ctx.credentials.password },
        rate: rate("auth"),
      });
      token = res.data?.token;
    } catch (err) {
      if (err instanceof ProviderHttpError && (err.status === 400 || err.status === 401)) throw new ProviderAuthError("Dopigo login failed: username or password rejected");
      throw err;
    }
    if (!token) throw new ProviderAuthError("Dopigo login returned no token");
    this.ctx.session.set({ token });
    return token;
  }

  private async get<T>(path: string, endpoint: string): Promise<T> {
    let token = this.ctx.session.get<{ token?: string }>()?.token ?? (await this.login());
    try {
      return (await this.ctx.http.request<T>({ method: "GET", url: `${BASE}${path}`, headers: { authorization: `Token ${token}` }, rate: rate(endpoint) })).data;
    } catch (err) {
      if (!(err instanceof ProviderHttpError) || err.status !== 401) throw err;
      token = await this.login();
      return (await this.ctx.http.request<T>({ method: "GET", url: `${BASE}${path}`, headers: { authorization: `Token ${token}` }, rate: rate(endpoint) })).data;
    }
  }

  async verify() {
    try {
      await this.login();
      const page = await this.get<Page<unknown>>(`/api/v1/orders/?limit=1&offset=0`, "orders");
      return { ok: true as const, label: `Dopigo · ${page?.count ?? 0} sipariş` };
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : String(err) };
    }
  }

  private mapOrder(o: DopigoOrder): ExternalOrderInput {
    const currency = this.ctx.defaultCurrency;
    const lines = (o.items ?? []).map((i) => ({
      externalId: i.service_item_id ?? (i.id != null ? String(i.id) : null),
      sku: i.sku ?? null,
      barcode: null,
      name: i.name ?? "—",
      quantity: Number(i.amount ?? 0),
      unitPrice: toMinor(i.unit_price, currency)?.toString() ?? null,
      rawStatus: i.status ?? null,
    }));
    const tracking = (o.items ?? []).find((i) => i.service_shipment_code)?.service_shipment_code ?? null;
    const address = o.shipping_address ?? o.customer?.address ?? null;
    return {
      externalId: String(o.id),
      externalNumber: o.service_order_id ?? o.service_value ?? null,
      channel: o.service_name ?? o.sales_channel ?? null,
      rawStatus: o.status ?? null,
      status: ORDER_STATUS[o.status ?? "undefined"] ?? "unknown",
      currency,
      total: toMinor(o.total, currency),
      lines,
      shipping: tracking ? { carrier: null, trackingNumber: tracking } : null,
      customer: { name: o.customer?.full_name ?? null, city: address?.city ?? null, district: address?.district ?? null },
      orderedAt: parseProviderDate(o.service_created),
      externalUpdatedAt: null,
    };
  }

  /**
   * The published API has no modified-since filter, so each pass pages through the order
   * list; unchanged orders are recognised by their payload hash and not rewritten.
   */
  async pullOrders(cursor: Record<string, unknown>) {
    const offset = Number(cursor.offset ?? 0);
    const page = await this.get<Page<DopigoOrder>>(`/api/v1/orders/?limit=${PAGE_SIZE}&offset=${offset}`, "orders");
    const items = (page?.results ?? []).map((o) => this.mapOrder(o));
    const done = !page?.next || !items.length;
    return { items, cursor: { offset: done ? 0 : offset + PAGE_SIZE }, done };
  }

  async pullListings(cursor: Record<string, unknown>) {
    const offset = Number(cursor.offset ?? 0);
    const page = await this.get<Page<DopigoProduct>>(`/api/v1/products/all/?limit=${PAGE_SIZE}&offset=${offset}`, "products");
    const items: ExternalListingInput[] = [];
    for (const p of page?.results ?? []) {
      for (const sp of p.products ?? []) {
        const currency = (sp.price_currency ?? this.ctx.defaultCurrency).toUpperCase();
        items.push({
          externalId: String(sp.id),
          sku: sp.sku ?? null,
          barcode: sp.barcode ?? null,
          title: p.name ?? null,
          stock: sp.available_stock ?? sp.stock ?? null,
          price: toMinor(sp.price, currency),
          listPrice: toMinor(sp.listing_price, currency),
          currency,
          active: sp.meta?.active ?? null,
          externalUpdatedAt: null,
        });
      }
    }
    const done = !page?.next || !(page?.results ?? []).length;
    return { items, cursor: { offset: done ? 0 : offset + PAGE_SIZE }, done };
  }
}

export const dopigoProvider: ProviderDefinition<Credentials, Settings> = {
  id: "dopigo",
  name: "Dopigo",
  kind: "integrator",
  docs: {
    status: "verified",
    sources: [
      "https://dopigo.readme.io/reference (endpoint başına 2 istek/sn, panel girişiyle token)",
      "Dopigo API OPTIONS şeması (sipariş/ürün alanları ve durum seçenekleri)",
    ],
    notes: [
      "Okuma: siparişler ve ürünler. Yazma kapalı: stok/fiyatın ürün güncelleme alanlarıyla yapıldığı Dopigo tarafından teyit edilene kadar (dev@dopigo.com) değişiklikler Dopigo panelinden yapılmalı.",
      "Değişiklik tarihi filtresi yayımlanmadığı için her turda sipariş listesi sayfalanır; değişmeyen kayıtlar yeniden yazılmaz.",
    ],
  },
  capabilities: { readOrders: true, readListings: true, writeStock: false, writePrice: false },
  credentialsSchema,
  settingsSchema,
  credentialFields: ["username", "password"],
  defaultPollMinutes: 15,
  hosts: ["panel.dopigo.com"],
  create: (ctx) => new DopigoConnector(ctx),
};
