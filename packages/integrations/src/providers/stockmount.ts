import { z } from "zod";
import { money, toDecimalString } from "@altyapi/commerce-core";
import { parseProviderDate, toIstanbulLocal } from "../dates";
import { ProviderApiError, ProviderAuthError, type RateRule } from "../http";
import { toMinor } from "../money";
import type { Connector, ConnectorContext, ExternalListingInput, ExternalOrderInput, NormalizedOrderStatus, ProviderDefinition, WriteResult } from "../types";

/**
 * StockMount API (Uygulama Kılavuzu v1.6, 10.09.2018). All calls are POST with a JSON body
 * carrying the ApiCode obtained from DoLogin; an expired session answers error 00006.
 * Source: github.com/StockMount/SmIntegration-dotnet, Doc/tr-TR/StockMount Entegrasyon Servisi.pdf
 */
const BASE = "https://out.stockmount.com";
/** The guide does not publish a limit; stay well below anything abusive. */
const RATE: RateRule = { key: "api", limit: 5, windowMs: 1000 };
const PAGE_SIZE = 100;
const OVERLAP_MS = 10 * 60_000;

const credentialsSchema = z.object({
  apiKey: z.string().trim().min(4).max(200),
  apiPassword: z.string().trim().min(4).max(200),
});

const settingsSchema = z.object({
  /** Limit order polling to these StockMount stores (default: all stores). */
  storeIds: z.array(z.number().int().positive()).max(100).optional(),
  /** Product source used for product listing and code-based stock/price writes. */
  productSourceId: z.number().int().positive().optional(),
  /** First sync looks back this many days. */
  initialDays: z.number().int().min(1).max(90).default(30),
});

type Credentials = z.infer<typeof credentialsSchema>;
type Settings = z.infer<typeof settingsSchema>;

interface ResultInfo<T> {
  Result: boolean;
  Message?: string | null;
  ErrorCode?: string | null;
  ErrorMessage?: string | null;
  Response: T;
}

interface SmStore {
  StoreId: number;
  StoreName: string;
  IntegrationId: number;
  IntegrationName: string;
}

interface SmOrderDetail {
  OrderDetailId?: number;
  ProductCode?: string | null;
  VariantProductCode?: string | null;
  Barcode?: string | null;
  VariantProductBarcode?: string | null;
  ProductName?: string | null;
  VariantPhrase?: string | null;
  Price?: number | string | null;
  Quantity?: number | null;
  CargoCompany?: string | null;
  CargoLabelCode?: string | null;
  OrderStatus?: string | null;
  LastModificationTime?: string | null;
}

interface SmOrder {
  OrderId: number;
  IntegrationOrderCode?: string | null;
  OrderDate?: string | null;
  OrderStatus?: string | null;
  Name?: string | null;
  Surname?: string | null;
  Fullname?: string | null;
  City?: string | null;
  District?: string | null;
  OrderDetails?: SmOrderDetail[] | null;
}

interface SmProduct {
  ProductId?: number;
  Code?: string | null;
  Barcode?: string | null;
  Name?: string | null;
  Price?: number | string | null;
  MarketPrice?: number | string | null;
  Quantity?: number | null;
  CurrencyId?: number | null;
  Status?: number | null;
  Variants?: { Code?: string | null; Barcode?: string | null; Price?: number | string | null; Quantity?: number | null; CurrencyId?: number | null }[] | null;
}

/** Order listing status codes from the guide (section 7.2.3), merged across channels. */
const STATUS: Record<string, NormalizedOrderStatus> = {
  // GittiGidiyor
  P: "pending_payment",
  S: "ready_to_ship",
  C: "awaiting_approval",
  T: "delivered",
  R: "returned",
  O: "delivered",
  // N11 and StockMount's own stores
  New: "awaiting_approval",
  Approved: "processing",
  Shipped: "shipped",
  Rejected: "returned",
  Delivered: "delivered",
  Completed: "delivered",
  Unknown: "cancelled",
  // SanalPazar
  ODEME_ONAYI_BEKLENIYOR: "pending_payment",
  KARGO_GONDERIMI_BEKLENIYOR: "ready_to_ship",
  KARGO_ALICIYA_ULASMADI: "undelivered",
  KARGO_TESLIMATI_BEKLENIYOR: "shipped",
  ALICI_URUNU_ONAYLADI: "delivered",
  ALICI_URUNU_IADE_ETTI: "returned",
  PARA_TRANSFERI_YAPILDI: "delivered",
  ALICIYA_PARA_IADESI_YAPILDI: "returned",
  SIPARIS_ASKIYA_ALINDI: "processing",
  SATICI_IPTAL_ETTI: "cancelled",
  ALICI_IPTAL_ETTI: "cancelled",
  SANALPAZAR_IPTAL_ETTI: "cancelled",
  // Hepsiburada
  Open: "processing",
  UnPacked: "cancelled",
  // ePttAVM
  Preparing: "processing",
  kargo_yapilmasi_bekleniyor: "ready_to_ship",
  havale_onayi_bekleniyor: "pending_payment",
  gondericisine_teslim_edildi: "returned",
  iade: "returned",
  Gonderilmis: "shipped",
  "İptal": "cancelled",
  odeme_gecersiz: "cancelled",
  tamamlandi: "delivered",
  // Akakçe
  WAITING_FOR_CONFIRMATION: "awaiting_approval",
  WAITING_FOR_SHIPMENT: "ready_to_ship",
  REJECTED_BY_SELLER: "cancelled",
  CANCELLED_BY_CUSTOMER: "cancelled",
  SHIPPED_WITHOUT_TRACKINGNO: "shipped",
  COMPLETED: "delivered",
  // Trendyol
  Created: "processing",
  Picking: "processing",
  Invoiced: "ready_to_ship",
  ReadyToShip: "ready_to_ship",
  UnDelivered: "undelivered",
  Cancelled: "cancelled",
  Returned: "returned",
  Repack: "processing",
  UnSupplied: "cancelled",
  // BiteneKadar
  "0": "awaiting_approval",
  "1": "ready_to_ship",
  "4": "returned",
  "5": "delivered",
  // Amazon
  Canceled: "cancelled",
  PartailShipped: "shipped",
  Unshipped: "processing",
};

export const normalizeStockMountStatus = (code: string | null | undefined): NormalizedOrderStatus => (code ? STATUS[code] ?? "unknown" : "unknown");

interface OrdersCursor {
  since?: string;
  passStart?: string;
  queue?: { storeId: number; channel: string; status: string }[];
  page?: number;
  pageBase?: 0 | 1;
}

interface ListingsCursor {
  page?: number;
  pageBase?: 0 | 1;
}

class StockMountConnector implements Connector {
  constructor(private readonly ctx: ConnectorContext<Credentials, Settings>) {}

  private async post<T>(path: string, body: Record<string, unknown>): Promise<ResultInfo<T>> {
    const res = await this.ctx.http.request<ResultInfo<T>>({ method: "POST", url: `${BASE}${path}`, json: body, rate: RATE });
    if (!res.data || typeof res.data !== "object") throw new ProviderApiError(null, "empty response");
    return res.data;
  }

  private async login(): Promise<string> {
    const res = await this.post<{ ApiCode?: string; Username?: string }>("/api/user/dologin", {
      ApiKey: this.ctx.credentials.apiKey,
      ApiPassword: this.ctx.credentials.apiPassword,
    });
    if (!res.Result || !res.Response?.ApiCode) {
      throw new ProviderAuthError(`StockMount login failed (${res.ErrorCode ?? "?"}): ${res.ErrorMessage ?? res.Message ?? ""}`.trim());
    }
    const session = this.ctx.session.get<Record<string, unknown>>() ?? {};
    this.ctx.session.set({ ...session, apiCode: res.Response.ApiCode, username: res.Response.Username ?? null });
    return res.Response.ApiCode;
  }

  /** Calls a service with the session ApiCode, logging in again once when it expired (00006). */
  private async call<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
    let apiCode = this.ctx.session.get<{ apiCode?: string }>()?.apiCode ?? (await this.login());
    let res = await this.post<T>(path, { ...body, ApiCode: apiCode });
    if (!res.Result && res.ErrorCode === "00006") {
      apiCode = await this.login();
      res = await this.post<T>(path, { ...body, ApiCode: apiCode });
    }
    if (!res.Result) {
      const message = `${res.ErrorCode ?? ""} ${res.ErrorMessage ?? res.Message ?? ""}`.trim();
      if (res.ErrorCode === "00001" || res.ErrorCode === "00002") throw new ProviderAuthError(`StockMount: ${message}`);
      throw new ProviderApiError(res.ErrorCode ?? null, `StockMount ${path}: ${message}`);
    }
    return res.Response;
  }

  async verify() {
    try {
      await this.login();
      const stores = await this.call<SmStore[]>("/api/Integration/GetStore");
      const username = this.ctx.session.get<{ username?: string }>()?.username;
      return { ok: true as const, label: `${username ?? "StockMount"} · ${stores?.length ?? 0} mağaza` };
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : String(err) };
    }
  }

  private async currencyCodes(): Promise<Record<string, string>> {
    const cached = this.ctx.session.get<{ currencies?: Record<string, string> }>()?.currencies;
    if (cached) return cached;
    const list = await this.call<{ CurrencyId: number; Code: string }[]>("/api/General/GetCurrencies");
    const map = Object.fromEntries((list ?? []).map((c) => [String(c.CurrencyId), c.Code.toUpperCase()]));
    this.ctx.session.set({ ...(this.ctx.session.get<Record<string, unknown>>() ?? {}), currencies: map });
    return map;
  }

  private async productSourceId(): Promise<number> {
    if (this.ctx.settings.productSourceId) return this.ctx.settings.productSourceId;
    const sources = await this.call<{ ProductSourceId: number; Name: string }[]>("/api/Product/GetProductSources");
    if (sources?.length === 1) return sources[0]!.ProductSourceId;
    throw new ProviderApiError("settings", `productSourceId is required (available: ${(sources ?? []).map((s) => `${s.ProductSourceId}=${s.Name}`).join(", ")})`);
  }

  private mapOrder(o: SmOrder, channel: string): ExternalOrderInput {
    const currency = this.ctx.defaultCurrency;
    const details = o.OrderDetails ?? [];
    const lines = details.map((d) => ({
      externalId: d.OrderDetailId != null ? String(d.OrderDetailId) : null,
      sku: d.VariantProductCode || d.ProductCode || null,
      barcode: d.VariantProductBarcode || d.Barcode || null,
      name: [d.ProductName, d.VariantPhrase].filter(Boolean).join(" ") || "—",
      quantity: Number(d.Quantity ?? 0),
      unitPrice: toMinor(d.Price, currency)?.toString() ?? null,
      rawStatus: d.OrderStatus ?? null,
    }));
    const total = lines.reduce<bigint | null>((sum, l) => (l.unitPrice === null || sum === null ? null : sum + BigInt(l.unitPrice) * BigInt(l.quantity)), 0n);
    const updated = details.map((d) => parseProviderDate(d.LastModificationTime)).filter((d): d is Date => d !== null);
    const shipped = details.find((d) => d.CargoLabelCode || d.CargoCompany);
    return {
      externalId: String(o.OrderId),
      externalNumber: o.IntegrationOrderCode ?? null,
      channel,
      rawStatus: o.OrderStatus ?? null,
      status: normalizeStockMountStatus(o.OrderStatus),
      currency,
      total: details.length ? total : null,
      lines,
      shipping: shipped ? { carrier: shipped.CargoCompany ?? null, trackingNumber: shipped.CargoLabelCode ?? null } : null,
      customer: { name: o.Fullname || [o.Name, o.Surname].filter(Boolean).join(" ") || null, city: o.City ?? null, district: o.District ?? null },
      orderedAt: parseProviderDate(o.OrderDate),
      externalUpdatedAt: updated.length ? new Date(Math.max(...updated.map((d) => d.getTime()))) : null,
    };
  }

  /**
   * One page per call. A pass walks every store × listing status (GetSales requires both)
   * for orders modified since the previous pass, then advances `since` with an overlap.
   */
  async pullOrders(raw: Record<string, unknown>) {
    const cursor = raw as OrdersCursor;
    if (!cursor.queue?.length) {
      const passStart = new Date();
      const since = cursor.since ?? new Date(passStart.getTime() - this.ctx.settings.initialDays * 86_400_000).toISOString();
      const stores = (await this.call<SmStore[]>("/api/Integration/GetStore")) ?? [];
      const wanted = this.ctx.settings.storeIds;
      const queue: NonNullable<OrdersCursor["queue"]> = [];
      for (const store of stores.filter((s) => !wanted || wanted.includes(s.StoreId))) {
        const statuses = await this.call<{ ListingStatuses?: { Code: string }[] }[]>("/api/Integration/GetIntegrationOrderListingStatus", {
          IntegrationId: store.IntegrationId,
          StoreId: store.StoreId,
        });
        for (const s of statuses?.flatMap((x) => x.ListingStatuses ?? []) ?? []) {
          queue.push({ storeId: store.StoreId, channel: store.IntegrationName || store.StoreName, status: s.Code });
        }
      }
      if (!queue.length) return { items: [], cursor: { since: passStart.toISOString() }, done: true };
      cursor.queue = queue;
      cursor.since = since;
      cursor.passStart = passStart.toISOString();
      cursor.page = 0;
    }

    const head = cursor.queue[0]!;
    const pageBase = cursor.pageBase ?? 0;
    const page = cursor.page ?? 0;
    const res = await this.call<{ TotalOrderCount?: number; Orders?: SmOrder[] }>("/api/Integration/GetSales", {
      StoreId: head.storeId,
      OrderStatus: head.status,
      LastModificationTimeFrom: toIstanbulLocal(new Date(cursor.since!)),
      LastModificationTimeTo: toIstanbulLocal(new Date(cursor.passStart!)),
      PageIndex: pageBase + page,
      RowsByPage: PAGE_SIZE,
    });
    const orders = res?.Orders ?? [];
    // The guide does not say whether PageIndex starts at 0 or 1: an empty first page while
    // TotalOrderCount is positive means it is 1-based.
    if (!orders.length && page === 0 && pageBase === 0 && (res?.TotalOrderCount ?? 0) > 0) {
      return { items: [], cursor: { ...cursor, pageBase: 1 }, done: false };
    }
    const items = orders.map((o) => this.mapOrder(o, head.channel));
    const total = res?.TotalOrderCount ?? 0;
    const lastPage = orders.length < PAGE_SIZE || (page + 1) * PAGE_SIZE >= total;
    if (lastPage) {
      cursor.queue = cursor.queue.slice(1);
      cursor.page = 0;
    } else {
      cursor.page = page + 1;
    }
    if (!cursor.queue.length) {
      const next = new Date(new Date(cursor.passStart!).getTime() - OVERLAP_MS).toISOString();
      return { items, cursor: { since: next, pageBase: cursor.pageBase }, done: true };
    }
    return { items, cursor: { ...cursor }, done: false };
  }

  async pullListings(raw: Record<string, unknown>) {
    const cursor = raw as ListingsCursor;
    const sourceId = await this.productSourceId();
    const currencies = await this.currencyCodes();
    const pageBase = cursor.pageBase ?? 0;
    const page = cursor.page ?? 0;
    const products = (await this.call<SmProduct[]>("/api/Product/GetProducts", { ProductSourceId: sourceId, RowsByPage: PAGE_SIZE, PageIndex: pageBase + page })) ?? [];
    if (!products.length && page === 0 && pageBase === 0) {
      const probe = (await this.call<SmProduct[]>("/api/Product/GetProducts", { ProductSourceId: sourceId, RowsByPage: 1, PageIndex: 1 })) ?? [];
      if (probe.length) return { items: [], cursor: { page: 0, pageBase: 1 }, done: false };
    }
    const items: ExternalListingInput[] = [];
    for (const p of products) {
      const currency = (p.CurrencyId != null && currencies[String(p.CurrencyId)]) || this.ctx.defaultCurrency;
      const active = p.Status === 3 ? false : null;
      if (p.Variants?.length) {
        for (const v of p.Variants) {
          const vc = (v.CurrencyId != null && currencies[String(v.CurrencyId)]) || currency;
          items.push({
            externalId: `${p.Code ?? p.ProductId}::${v.Code ?? v.Barcode}`,
            sku: v.Code ?? null,
            barcode: v.Barcode ?? null,
            title: p.Name ?? null,
            stock: v.Quantity ?? null,
            price: toMinor(v.Price ?? p.Price, vc),
            listPrice: toMinor(p.MarketPrice, vc),
            currency: vc,
            active,
            externalUpdatedAt: null,
          });
        }
      } else {
        items.push({
          externalId: String(p.Code ?? p.ProductId),
          sku: p.Code ?? null,
          barcode: p.Barcode ?? null,
          title: p.Name ?? null,
          stock: p.Quantity ?? null,
          price: toMinor(p.Price, currency),
          listPrice: toMinor(p.MarketPrice, currency),
          currency,
          active,
          externalUpdatedAt: null,
        });
      }
    }
    const done = products.length < PAGE_SIZE;
    return { items, cursor: done ? { page: 0, pageBase } : { page: page + 1, pageBase }, done };
  }

  /** Groups writes by product code: variants are addressed as `productCode::variantCode`. */
  private groupByProduct<T extends { sku: string; externalId?: string | null }>(items: T[]) {
    const groups = new Map<string, { simple: T | null; variants: { code: string; item: T }[] }>();
    for (const item of items) {
      const [productCode, variantCode] = (item.externalId ?? item.sku).split("::");
      const g = groups.get(productCode!) ?? { simple: null, variants: [] };
      if (variantCode) g.variants.push({ code: variantCode, item });
      else g.simple = item;
      groups.set(productCode!, g);
    }
    return groups;
  }

  private async writeGroups<T extends { sku: string; externalId?: string | null }>(
    items: T[],
    path: string,
    fields: (item: T) => Record<string, unknown>,
  ): Promise<WriteResult[]> {
    const sourceId = await this.productSourceId();
    const results: WriteResult[] = [];
    for (const [code, g] of this.groupByProduct(items)) {
      const body: Record<string, unknown> = { Code: code, ProductSourceId: sourceId, ...(g.simple ? fields(g.simple) : {}) };
      if (g.variants.length) body.Variants = g.variants.map((v) => ({ Code: v.code, ...fields(v.item) }));
      const affected = [...(g.simple ? [g.simple] : []), ...g.variants.map((v) => v.item)];
      try {
        await this.call(path, body);
        results.push(...affected.map((i) => ({ sku: i.sku, ok: true })));
      } catch (err) {
        results.push(...affected.map((i) => ({ sku: i.sku, ok: false, message: err instanceof Error ? err.message : String(err) })));
      }
    }
    return results;
  }

  pushStock(items: { sku: string; quantity: number; externalId?: string | null }[]) {
    return this.writeGroups(items, "/api/Product/UpdateProductQuantityByCode", (i) => ({ Quantity: i.quantity }));
  }

  pushPrice(items: { sku: string; price: bigint; listPrice?: bigint | null; externalId?: string | null }[], currency: string) {
    const dec = (v: bigint) => Number(toDecimalString(money(v, currency)));
    return this.writeGroups(items, "/api/Product/UpdateProductPriceByCode", (i) => ({
      Price: dec(i.price),
      ...(i.listPrice ? { MarketPrice: dec(i.listPrice) } : {}),
    }));
  }
}

export const stockmountProvider: ProviderDefinition<Credentials, Settings> = {
  id: "stockmount",
  name: "StockMount",
  kind: "integrator",
  docs: {
    status: "verified",
    sources: ["https://github.com/StockMount/SmIntegration-dotnet (Doc: StockMount API Servisi Uygulama Kılavuzu v1.6, 10.09.2018)"],
    notes: [
      "API yalnızca ücretli üyelikte ve StockMount dükkân tipinde açılır (Entegrasyon → Api Bilgileri).",
      "Webhook yok; siparişler LastModificationTime filtresiyle artımlı sorgulanır (mağaza × durum).",
      "Kılavuz 2018 tarihli; istek limiti yayımlanmamış, saniyede 5 istekle sınırlandırıldı.",
    ],
  },
  capabilities: { readOrders: true, readListings: true, writeStock: true, writePrice: true },
  credentialsSchema,
  settingsSchema,
  credentialFields: ["apiKey", "apiPassword"],
  defaultPollMinutes: 10,
  hosts: ["out.stockmount.com"],
  create: (ctx) => new StockMountConnector(ctx),
};
