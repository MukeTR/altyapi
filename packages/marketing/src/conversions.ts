import { createHash } from "node:crypto";
import { money, newId, toDecimalString } from "@altyapi/commerce-core";
import {
  and,
  conversionDeliveries,
  eq,
  orderAddresses,
  orderLines,
  orders,
  trackingConfigs,
  withTenantTx,
  type Database,
  type PostalAddress,
  type Transaction,
} from "@altyapi/database";
import type { KeyProvider } from "@altyapi/secrets";
import { decryptTrackingSecrets, type TrackingSecrets } from "./tracking";

/**
 * Server-side purchase conversions (Meta Conversions API, TikTok Events API, GA4 Measurement
 * Protocol). The browser pixel sends the same event with the same event id, so each platform
 * counts the purchase once. Nothing is sent without the shopper's consent captured at checkout.
 */

export const purchaseEventId = (orderId: string) => `purchase:${orderId}`;

/** Catalog item id shared by pixels, conversion APIs and product feeds. */
export const catalogItemId = (line: { variantId: string | null; productId: string | null; sku: string | null }) =>
  line.variantId ?? line.productId ?? line.sku ?? "unknown";

export interface ConversionDeps {
  db: Database;
  keys: KeyProvider | null;
  metaGraphApiVersion: string;
  fetchImpl?: typeof fetch;
}

type Destination = "meta_capi" | "tiktok_events" | "ga4_mp";

interface PurchaseFacts {
  orderId: string;
  orderNumber: string;
  eventTime: number;
  currency: string;
  value: number;
  tax: number;
  shipping: number;
  email: string | null;
  phone: string | null;
  externalId: string | null;
  billing: PostalAddress | null;
  items: { id: string; name: string; quantity: number; price: number }[];
  consent: { analytics: boolean; marketing: boolean };
  identifiers: { fbp?: string | null; fbc?: string | null; ttp?: string | null; ttclid?: string | null; gaClientId?: string | null };
  client: { ip?: string | null; userAgent?: string | null; pageUrl?: string | null };
}

interface SendResult {
  status: "sent" | "failed" | "skipped";
  httpStatus?: number;
  message?: string;
  /** Transient failures are retried by the queue; permanent ones are recorded and dropped. */
  retryable?: boolean;
}

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const hashed = (value: string | null | undefined, normalize: (v: string) => string | null) => {
  if (!value) return undefined;
  const n = normalize(value);
  return n ? sha256(n) : undefined;
};
const normEmail = (v: string) => v.trim().toLowerCase() || null;
const normText = (v: string) => v.trim().toLocaleLowerCase("tr-TR").replace(/[\s.,'-]/g, "") || null;

/** Digits with country code (Meta) or E.164 (TikTok). Turkish local formats get +90. */
function phoneDigits(v: string, countryCode: string): string | null {
  let d = v.replace(/\D/g, "");
  if (!d) return null;
  if (countryCode === "TR") {
    if (d.startsWith("0")) d = d.slice(1);
    if (d.length === 10) d = `90${d}`;
  }
  return d.length >= 8 ? d : null;
}

const decimal = (amount: bigint, currency: string) => Number(toDecimalString(money(amount, currency)));

async function loadFacts(tx: Transaction, storeId: string, orderId: string): Promise<PurchaseFacts | null> {
  const order = await tx.query.orders.findFirst({ where: and(eq(orders.id, orderId), eq(orders.storeId, storeId)) });
  if (!order) return null;
  const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, orderId));
  const addresses = await tx.select().from(orderAddresses).where(eq(orderAddresses.orderId, orderId));
  const billing = addresses.find((a) => a.type === "billing")?.address ?? null;
  const a = order.attribution;
  return {
    orderId: order.id,
    orderNumber: order.number,
    eventTime: Math.floor((order.confirmedAt ?? order.placedAt ?? order.createdAt).getTime() / 1000),
    currency: order.currency,
    value: decimal(order.total, order.currency),
    tax: decimal(order.taxTotal, order.currency),
    shipping: decimal(order.shippingTotal, order.currency),
    email: order.email,
    phone: order.phone ?? billing?.phone ?? null,
    externalId: order.customerId ?? order.email,
    billing,
    items: lines.map((l) => ({
      id: catalogItemId(l),
      name: l.variantTitle ? `${l.title} (${l.variantTitle})` : l.title,
      quantity: l.quantity,
      price: decimal(l.quantity > 0 ? l.total / BigInt(l.quantity) : l.unitPrice, order.currency),
    })),
    consent: { analytics: a.consent?.analytics === true, marketing: a.consent?.marketing === true },
    identifiers: a.identifiers ?? {},
    client: a.client ?? {},
  };
}

function classify(httpStatus: number, message: string): SendResult {
  if (httpStatus >= 200 && httpStatus < 300) return { status: "sent", httpStatus };
  return { status: "failed", httpStatus, message: message.slice(0, 500), retryable: httpStatus === 429 || httpStatus >= 500 };
}

async function post(fetchImpl: typeof fetch, url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  return { status: res.status, text };
}

/** Meta Conversions API: POST /{pixel-id}/events. */
async function sendMeta(deps: ConversionDeps, pixelId: string, secrets: TrackingSecrets, f: PurchaseFacts): Promise<SendResult> {
  if (!f.consent.marketing) return { status: "skipped", message: "no_marketing_consent" };
  const country = f.billing?.countryCode ?? "TR";
  const userData: Record<string, unknown> = {
    em: f.email ? [hashed(f.email, normEmail)] : undefined,
    ph: f.phone ? [hashed(f.phone, (v) => phoneDigits(v, country))].filter(Boolean) : undefined,
    fn: f.billing ? hashed(f.billing.firstName, normText) : undefined,
    ln: f.billing ? hashed(f.billing.lastName, normText) : undefined,
    ct: f.billing ? hashed(f.billing.province ?? f.billing.city, normText) : undefined,
    zp: f.billing?.postalCode ? hashed(f.billing.postalCode, normText) : undefined,
    country: hashed(country, (v) => v.toLowerCase()),
    external_id: f.externalId ? [sha256(f.externalId)] : undefined,
    client_ip_address: f.client.ip ?? undefined,
    client_user_agent: f.client.userAgent ?? undefined,
    fbp: f.identifiers.fbp ?? undefined,
    fbc: f.identifiers.fbc ?? undefined,
  };
  const body = {
    data: [
      {
        event_name: "Purchase",
        event_time: f.eventTime,
        event_id: purchaseEventId(f.orderId),
        action_source: "website",
        event_source_url: f.client.pageUrl ?? undefined,
        user_data: userData,
        custom_data: {
          currency: f.currency,
          value: f.value,
          order_id: f.orderNumber,
          content_type: "product",
          content_ids: f.items.map((i) => i.id),
          contents: f.items.map((i) => ({ id: i.id, quantity: i.quantity, item_price: i.price })),
          num_items: f.items.reduce((s, i) => s + i.quantity, 0),
        },
      },
    ],
    ...(secrets.metaTestEventCode ? { test_event_code: secrets.metaTestEventCode } : {}),
  };
  const url = `https://graph.facebook.com/${deps.metaGraphApiVersion}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(secrets.metaCapiAccessToken!)}`;
  const res = await post(deps.fetchImpl ?? fetch, url, body);
  if (res.status >= 200 && res.status < 300) return { status: "sent", httpStatus: res.status };
  let message = res.text;
  try {
    message = (JSON.parse(res.text) as { error?: { message?: string } }).error?.message ?? res.text;
  } catch {
    // keep raw text
  }
  return classify(res.status, message);
}

/** TikTok Events API 2.0: POST /open_api/v1.3/event/track/. */
async function sendTikTok(deps: ConversionDeps, pixelCode: string, secrets: TrackingSecrets, f: PurchaseFacts): Promise<SendResult> {
  if (!f.consent.marketing) return { status: "skipped", message: "no_marketing_consent" };
  const country = f.billing?.countryCode ?? "TR";
  const body = {
    event_source: "web",
    event_source_id: pixelCode,
    ...(secrets.tiktokTestEventCode ? { test_event_code: secrets.tiktokTestEventCode } : {}),
    data: [
      {
        event: "CompletePayment",
        event_time: f.eventTime,
        event_id: purchaseEventId(f.orderId),
        user: {
          email: hashed(f.email, normEmail),
          phone: hashed(f.phone, (v) => {
            const d = phoneDigits(v, country);
            return d ? `+${d}` : null;
          }),
          external_id: f.externalId ? sha256(f.externalId) : undefined,
          ip: f.client.ip ?? undefined,
          user_agent: f.client.userAgent ?? undefined,
          ttp: f.identifiers.ttp ?? undefined,
          ttclid: f.identifiers.ttclid ?? undefined,
        },
        page: f.client.pageUrl ? { url: f.client.pageUrl } : undefined,
        properties: {
          currency: f.currency,
          value: f.value,
          order_id: f.orderNumber,
          content_type: "product",
          contents: f.items.map((i) => ({ content_id: i.id, content_name: i.name, quantity: i.quantity, price: i.price })),
        },
      },
    ],
  };
  const res = await post(deps.fetchImpl ?? fetch, "https://business-api.tiktok.com/open_api/v1.3/event/track/", body, {
    "Access-Token": secrets.tiktokAccessToken!,
  });
  if (res.status < 200 || res.status >= 300) return classify(res.status, res.text);
  // TikTok reports errors in the body with HTTP 200.
  let parsed: { code?: number; message?: string } = {};
  try {
    parsed = JSON.parse(res.text) as typeof parsed;
  } catch {
    return { status: "failed", httpStatus: res.status, message: "invalid_response", retryable: true };
  }
  if (parsed.code === 0) return { status: "sent", httpStatus: res.status };
  const code = parsed.code ?? -1;
  return { status: "failed", httpStatus: res.status, message: `${code}: ${parsed.message ?? ""}`.slice(0, 500), retryable: code >= 50000 || code === 40100 };
}

/** GA4 Measurement Protocol; requires the browser's client id to join the web session. */
async function sendGa4(deps: ConversionDeps, measurementId: string, secrets: TrackingSecrets, f: PurchaseFacts): Promise<SendResult> {
  if (!f.consent.analytics) return { status: "skipped", message: "no_analytics_consent" };
  if (!f.identifiers.gaClientId) return { status: "skipped", message: "no_client_id" };
  const body = {
    client_id: f.identifiers.gaClientId,
    timestamp_micros: f.eventTime * 1_000_000,
    consent: { ad_user_data: f.consent.marketing ? "GRANTED" : "DENIED", ad_personalization: f.consent.marketing ? "GRANTED" : "DENIED" },
    events: [
      {
        name: "purchase",
        params: {
          transaction_id: f.orderNumber,
          currency: f.currency,
          value: f.value,
          tax: f.tax,
          shipping: f.shipping,
          items: f.items.map((i) => ({ item_id: i.id, item_name: i.name, quantity: i.quantity, price: i.price })),
        },
      },
    ],
  };
  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(secrets.ga4ApiSecret!)}`;
  const res = await post(deps.fetchImpl ?? fetch, url, body);
  return classify(res.status, res.text);
}

export class RetryableConversionError extends Error {
  override name = "RetryableConversionError";
}

/**
 * Sends the purchase to every enabled destination once. Already sent or skipped
 * destinations are not repeated; transient failures throw so the queue retries only those.
 */
export async function sendPurchaseConversions(deps: ConversionDeps, ref: { organizationId: string; storeId: string }, orderId: string) {
  const loaded = await withTenantTx(deps.db, ref, async (tx) => {
    const config = await tx.query.trackingConfigs.findFirst({ where: eq(trackingConfigs.storeId, ref.storeId) });
    if (!config || !(config.metaCapiEnabled || config.tiktokEventsApiEnabled || config.ga4MeasurementProtocolEnabled)) return null;
    const facts = await loadFacts(tx, ref.storeId, orderId);
    if (!facts) return null;
    const done = await tx
      .select({ destination: conversionDeliveries.destination, status: conversionDeliveries.status })
      .from(conversionDeliveries)
      .where(and(eq(conversionDeliveries.storeId, ref.storeId), eq(conversionDeliveries.eventId, purchaseEventId(orderId))));
    return { config, facts, finished: new Set(done.filter((d) => d.status !== "failed").map((d) => d.destination)) };
  });
  if (!loaded) return [];
  const { config, facts, finished } = loaded;
  const secrets = await decryptTrackingSecrets(deps.keys, config);

  const plan: { destination: Destination; run: () => Promise<SendResult> }[] = [];
  if (config.metaCapiEnabled && config.metaPixelId && secrets.metaCapiAccessToken) {
    plan.push({ destination: "meta_capi", run: () => sendMeta(deps, config.metaPixelId!, secrets, facts) });
  }
  if (config.tiktokEventsApiEnabled && config.tiktokPixelId && secrets.tiktokAccessToken) {
    plan.push({ destination: "tiktok_events", run: () => sendTikTok(deps, config.tiktokPixelId!, secrets, facts) });
  }
  if (config.ga4MeasurementProtocolEnabled && config.ga4MeasurementId && secrets.ga4ApiSecret) {
    plan.push({ destination: "ga4_mp", run: () => sendGa4(deps, config.ga4MeasurementId!, secrets, facts) });
  }

  const results: { destination: Destination; result: SendResult }[] = [];
  for (const step of plan) {
    if (finished.has(step.destination)) continue;
    let result: SendResult;
    try {
      result = await step.run();
    } catch (err) {
      result = { status: "failed", message: err instanceof Error ? err.message : String(err), retryable: true };
    }
    results.push({ destination: step.destination, result });
    await withTenantTx(deps.db, ref, (tx) =>
      tx
        .insert(conversionDeliveries)
        .values({
          id: newId(),
          ...ref,
          destination: step.destination,
          eventName: "purchase",
          eventId: purchaseEventId(orderId),
          orderId,
          status: result.status,
          httpStatus: result.httpStatus ?? null,
          message: result.message ?? null,
        })
        .onConflictDoUpdate({
          target: [conversionDeliveries.storeId, conversionDeliveries.destination, conversionDeliveries.eventId],
          set: { status: result.status, httpStatus: result.httpStatus ?? null, message: result.message ?? null, createdAt: new Date() },
        }),
    );
  }
  const transient = results.filter((r) => r.result.status === "failed" && r.result.retryable);
  if (transient.length) throw new RetryableConversionError(`conversion delivery failed: ${transient.map((t) => `${t.destination} ${t.result.message ?? ""}`).join("; ")}`);
  return results;
}
