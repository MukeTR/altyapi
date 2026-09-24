import { z } from "zod";
import { parseProviderDate, toIstanbulLocal } from "../dates";
import type { RateRule } from "../http";
import { toMinor } from "../money";
import type { Connector, ConnectorContext, ExternalListingInput, ExternalOrderInput, ProviderDefinition } from "../types";

/**
 * Hepsiburada Marketplace (read only), per the OpenAPI definitions published on the
 * Hepsiburada developer portal (OMS "sipariş" and "listeleme" products). Basic auth with the
 * merchant's API user and a User-Agent naming the integrator. Hepsiburada tracks order lines
 * individually, so an order is assembled from open lines, cancelled lines and the
 * shipped/delivered package lists.
 */
const HOSTS = {
  prod: { oms: "https://oms-external.hepsiburada.com", listing: "https://listing-external.hepsiburada.com" },
  sit: { oms: "https://oms-external-sit.hepsiburada.com", listing: "https://listing-external-sit.hepsiburada.com" },
} as const;
const OMS_RATE: RateRule = { key: "oms", limit: 100, windowMs: 60_000 };
const LISTING_RATE: RateRule = { key: "listing", limit: 500, windowMs: 60_000 };
const OVERLAP_MS = 10 * 60_000;

const credentialsSchema = z.object({
  username: z.string().trim().min(3).max(200),
  password: z.string().min(4).max(200),
});
const settingsSchema = z.object({
  merchantId: z.uuid(),
  /** Sent as User-Agent; must match the integrator name configured in the merchant portal. */
  integratorName: z.string().trim().min(2).max(60),
  environment: z.enum(["prod", "sit"]).default("prod"),
  initialDays: z.number().int().min(1).max(90).default(30),
});

type Credentials = z.infer<typeof credentialsSchema>;
type Settings = z.infer<typeof settingsSchema>;

interface Money {
  amount?: number;
  currency?: string;
}
interface HbLine {
  id: string;
  orderNumber: string;
  merchantSKU?: string | null;
  productBarcode?: string | null;
  name?: string | null;
  quantity?: number;
  unitPrice?: Money | null;
  status?: string | null;
  customerName?: string | null;
  shippingAddress?: { city?: string | null; town?: string | null } | null;
  cargoCompany?: string | null;
  orderDate?: string | null;
  lastStatusUpdateDate?: string | null;
}
interface HbCancelledLine {
  lineItemId: string;
  orderNumber: string;
  merchantSku?: string | null;
  quantity?: number;
  cancelDate?: string | null;
}
interface HbDelivery {
  OrderNumber?: string | null;
  OrderNumbers?: string[] | null;
  Barcode?: string | null;
  ShippedDate?: string | null;
  DeliveredDate?: string | null;
}
interface Paged<T> {
  items?: T[];
  totalCount?: number;
}

type Phase = "open" | "cancelled" | "shipped" | "delivered";
const PHASES: { phase: Phase; path: string; limit: number }[] = [
  { phase: "open", path: "/orders/merchantid/{m}", limit: 100 },
  { phase: "cancelled", path: "/orders/merchantid/{m}/cancelled", limit: 50 },
  { phase: "shipped", path: "/packages/merchantid/{m}/shipped", limit: 50 },
  { phase: "delivered", path: "/packages/merchantid/{m}/delivered", limit: 50 },
];

class HepsiburadaConnector implements Connector {
  private readonly hosts: (typeof HOSTS)[keyof typeof HOSTS];
  private readonly headers: Record<string, string>;

  constructor(private readonly ctx: ConnectorContext<Credentials, Settings>) {
    this.hosts = HOSTS[ctx.settings.environment];
    this.headers = {
      authorization: `Basic ${Buffer.from(`${ctx.credentials.username}:${ctx.credentials.password}`, "utf8").toString("base64")}`,
      "user-agent": ctx.settings.integratorName,
    };
  }

  private get<T>(base: string, path: string, query: Record<string, string | number>, rate: RateRule) {
    const url = new URL(`${base}${path.replace("{m}", encodeURIComponent(this.ctx.settings.merchantId))}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    return this.ctx.http.request<T>({ method: "GET", url: url.toString(), headers: this.headers, rate }).then((r) => r.data);
  }

  async verify() {
    try {
      await this.get<Paged<HbLine>>(this.hosts.oms, "/orders/merchantid/{m}", { offset: 0, limit: 1 }, OMS_RATE);
      return { ok: true as const, label: `Hepsiburada ${this.ctx.settings.merchantId.slice(0, 8)}…` };
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : String(err) };
    }
  }

  private mapPage(phase: Phase, rows: unknown[]): ExternalOrderInput[] {
    const currencyOf = (m?: Money | null) => (m?.currency ?? this.ctx.defaultCurrency).toUpperCase();
    const base = { channel: "Hepsiburada", total: null, shipping: null, customer: null, orderedAt: null } as const;
    if (phase === "open") {
      return (rows as HbLine[]).map((l) => ({
        ...base,
        externalId: l.orderNumber,
        externalNumber: l.orderNumber,
        rawStatus: l.status ?? null,
        status: "processing" as const,
        currency: currencyOf(l.unitPrice),
        lines: [
          {
            externalId: l.id,
            sku: l.merchantSKU ?? null,
            barcode: l.productBarcode ?? null,
            name: l.name ?? "",
            quantity: Number(l.quantity ?? 0),
            unitPrice: toMinor(l.unitPrice?.amount, currencyOf(l.unitPrice))?.toString() ?? null,
            rawStatus: l.status ?? null,
            status: "processing",
          },
        ],
        shipping: l.cargoCompany ? { carrier: l.cargoCompany, trackingNumber: null } : null,
        customer: { name: l.customerName ?? null, city: l.shippingAddress?.city ?? null, district: l.shippingAddress?.town ?? null },
        orderedAt: parseProviderDate(l.orderDate),
        externalUpdatedAt: parseProviderDate(l.lastStatusUpdateDate),
        merge: "lines" as const,
      }));
    }
    if (phase === "cancelled") {
      return (rows as HbCancelledLine[]).map((l) => ({
        ...base,
        externalId: l.orderNumber,
        externalNumber: l.orderNumber,
        rawStatus: "Cancelled",
        status: "cancelled" as const,
        currency: this.ctx.defaultCurrency,
        lines: [{ externalId: l.lineItemId, sku: l.merchantSku ?? null, barcode: null, name: "", quantity: Number(l.quantity ?? 0), unitPrice: null, rawStatus: "Cancelled", status: "cancelled" }],
        externalUpdatedAt: parseProviderDate(l.cancelDate),
        merge: "lines" as const,
      }));
    }
    const status = phase === "shipped" ? ("shipped" as const) : ("delivered" as const);
    return (rows as HbDelivery[]).flatMap((d) => {
      const numbers = d.OrderNumbers?.length ? d.OrderNumbers : d.OrderNumber ? [d.OrderNumber] : [];
      return numbers.map((n) => ({
        ...base,
        externalId: n,
        externalNumber: n,
        rawStatus: phase === "shipped" ? "Shipped" : "Delivered",
        status,
        currency: this.ctx.defaultCurrency,
        lines: [],
        shipping: d.Barcode ? { carrier: null, trackingNumber: d.Barcode } : null,
        externalUpdatedAt: parseProviderDate(phase === "shipped" ? d.ShippedDate : d.DeliveredDate),
        merge: "status" as const,
      }));
    });
  }

  /** Each pass reads the four lists for the same date window, one page per call. */
  async pullOrders(cursor: Record<string, unknown>) {
    const now = Date.now();
    const since = Number(cursor.since ?? now - this.ctx.settings.initialDays * 86_400_000);
    const until = Number(cursor.until ?? now);
    const phaseIndex = Number(cursor.phase ?? 0);
    const offset = Number(cursor.offset ?? 0);
    const { phase, path, limit } = PHASES[phaseIndex]!;
    const data = await this.get<Paged<unknown>>(
      this.hosts.oms,
      path,
      { offset, limit, begindate: toIstanbulLocal(new Date(since)), enddate: toIstanbulLocal(new Date(until)) },
      OMS_RATE,
    );
    const rows = data?.items ?? [];
    const items = this.mapPage(phase, rows);
    const total = data?.totalCount ?? 0;
    // A full page means more may follow; totalCount (when reported) bounds it.
    if (rows.length === limit && (total === 0 || offset + limit < total)) {
      return { items, cursor: { since, until, phase: phaseIndex, offset: offset + limit }, done: false };
    }
    if (phaseIndex + 1 < PHASES.length) return { items, cursor: { since, until, phase: phaseIndex + 1, offset: 0 }, done: false };
    return { items, cursor: { since: until - OVERLAP_MS }, done: true };
  }

  async pullListings(cursor: Record<string, unknown>) {
    const offset = Number(cursor.offset ?? 0);
    const limit = 100;
    const data = await this.get<{ listings?: { listingId: string; hepsiburadaSku?: string; merchantSku?: string; price?: number; availableStock?: number; isSalable?: boolean }[]; totalCount?: number }>(
      this.hosts.listing,
      "/listings/merchantid/{m}",
      { offset, limit },
      LISTING_RATE,
    );
    const currency = this.ctx.defaultCurrency;
    const rows = data?.listings ?? [];
    const items: ExternalListingInput[] = rows.map((l) => ({
      externalId: l.listingId,
      sku: l.merchantSku ?? null,
      barcode: null,
      title: l.hepsiburadaSku ?? null,
      stock: l.availableStock ?? null,
      price: toMinor(l.price, currency),
      listPrice: null,
      currency,
      active: l.isSalable ?? null,
      externalUpdatedAt: null,
    }));
    const done = rows.length < limit || offset + limit >= (data?.totalCount ?? 0);
    return { items, cursor: done ? {} : { offset: offset + limit }, done };
  }
}

export const hepsiburadaProvider: ProviderDefinition<Credentials, Settings> = {
  id: "hepsiburada",
  name: "Hepsiburada",
  kind: "marketplace",
  docs: {
    status: "verified",
    sources: ["https://developers.hepsiburada.com (OMS sipariş ve listeleme OpenAPI tanımları, 2026-05)"],
    notes: [
      "Yalnızca okuma: stok/fiyat yazımı entegratörünüzün senkronuyla çakışacağı için entegratörde yapılmalı.",
      "User-Agent, Hepsiburada satıcı panelinde tanımlı entegratör adıyla aynı olmalıdır.",
    ],
  },
  capabilities: { readOrders: true, readListings: true, writeStock: false, writePrice: false },
  credentialsSchema,
  settingsSchema,
  credentialFields: ["username", "password"],
  defaultPollMinutes: 15,
  hosts: ["oms-external.hepsiburada.com", "listing-external.hepsiburada.com"],
  create: (ctx) => new HepsiburadaConnector(ctx),
};
