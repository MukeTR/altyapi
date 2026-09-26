/**
 * Local ecosystem seed for altyapi (docs/ekosistem/yerel-kurulum.md). Idempotent: every run
 * converges on the same store, catalog, brand profile and storefront orders.
 *
 *   tools/ekosistem/yerel.sh tohum
 *   (= cd apps/api && node --env-file=../../.env --import tsx ../../tools/ekosistem/tohum-altyapi.ts)
 *
 * The merchant side goes through the API over HTTP (register/login, organization, store, tax
 * class, products, brand profile, shipping zone, fulfillment and return). Three steps have no
 * HTTP path that works locally and use the service layer against the local database instead
 * (only when DATABASE_URL is localhost:5433):
 *   - variant costs with their VAT treatment (the product API takes an amount only);
 *   - storefront checkout and payment: the real checkout code runs, with a local stand-in for
 *     the iyzico adapter (test mode, no network) and a local discount engine for one coupon
 *     (altyapi has no campaign engine yet);
 *   - the card fee on the sale transaction and the refund: no provider adapter writes
 *     payment_transactions.fee_amount, and a refund through the API would call iyzico.
 * Everything is synthetic (PLAN.md fixture, brand "Deneme Tekstil"). The API is never started
 * here: without it the seed stops.
 *
 * Hermetic test accounts (end-to-end runs open a fresh account every time):
 *
 *   ALTYAPI_TOHUM_PAROLA=<parola> node … tohum-altyapi.ts --email e2e-123@altyapi.local --slug e2e-123
 *
 * loads the same fixture into a new user / organization / store (both slugs = --slug). The
 * password comes from the environment (never argv), kimlikler.env is left untouched, and the
 * last line is `TOHUM_SONUC {json}` (email, userId, organizationId/Slug, storeId/Slug). Without
 * arguments the seed works on the shared fixture account exactly as before.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiEnvSchema, parseEnv } from "../../packages/config/src/index";
import { and, createDatabase, desc, eq, inArray, isNull, orders, paymentAttempts, paymentTransactions, withTenantTx } from "../../packages/database/src/index";
import { loadMembership } from "../../packages/auth/src/index";
import { loadStoreContext, type StoreContext } from "../../packages/tenancy/src/index";
import { setVariantCost } from "../../packages/pricing/src/index";
import { createKeyProvider } from "../../packages/secrets/src/index";
import {
  connectProvider,
  setConnectionStatus,
  type CallbackInput,
  type CancelPaymentInput,
  type CreatePaymentInput,
  type GetPaymentInput,
  type PaymentProvider,
  type PaymentResult,
  type PaymentSession,
  type PaymentStatus,
  type PaymentsDeps,
  type RefundPaymentInput,
  type VerifiedPaymentEvent,
} from "../../packages/payments/src/index";
import {
  addLine,
  applyCoupon,
  createCart,
  createProviderRegistry,
  createRefundGateway,
  handleIyzicoCallback,
  selectShippingRate,
  setAddresses,
  setAttribution,
  setContact,
  shippingOptions,
  startCheckout,
  type DiscountEngine,
} from "../../packages/checkout/src/index";
import { cancelUnpaidOrder, createRefund } from "../../packages/orders/src/index";
import { exportCatalogProducts, exportOrders, type EkosistemServerDeps, type LinkRow } from "../../packages/ekosistem/src/index";

// ---------------------------------------------------------------------------
// Fixture (PLAN.md "Ortak yerel fixture"); amounts in kuruş, VAT-inclusive
// ---------------------------------------------------------------------------

const FIXTURE_EMAIL = "ekosistem-yerel@altyapi.local";
const FIXTURE_SLUG = "deneme-tekstil";
const BRAND_NAME = "Deneme Tekstil";
const TAX = { code: "kdv10", name: "KDV %10", rateBps: 1000, pricesIncludeTax: true };
const STOCK_PER_VARIANT = 50;

interface FixtureVariant {
  size: string;
  color: string;
  barcode: string;
  sku: string;
  price: bigint;
  /** VAT-inclusive cost; null = not entered (the "maliyet eksik" case). */
  cost: bigint | null;
}

interface FixtureProduct {
  key: string;
  title: string;
  handle: string;
  productType: string;
  description: string;
  variants: FixtureVariant[];
}

const PRODUCTS: FixtureProduct[] = [
  {
    key: "tisort",
    title: "Pamuklu Tişört",
    handle: "pamuklu-tisort",
    productType: "Tişört",
    description: "<p>%100 pamuk, bisiklet yaka tişört. Yerel ekosistem tohumu (kurgusal ürün).</p>",
    variants: [
      { size: "M", color: "Beyaz", barcode: "8699990000019", sku: "DT-TS-M-BY", price: 49990n, cost: 18000n },
      { size: "L", color: "Beyaz", barcode: "8699990000026", sku: "DT-TS-L-BY", price: 49990n, cost: 18500n },
    ],
  },
  {
    key: "gomlek",
    title: "Keten Gömlek",
    handle: "keten-gomlek",
    productType: "Gömlek",
    description: "<p>Keten karışımlı, uzun kollu gömlek. Yerel ekosistem tohumu (kurgusal ürün).</p>",
    variants: [
      { size: "M", color: "Bej", barcode: "8699990000033", sku: "DT-GM-M-BJ", price: 89990n, cost: 42000n },
      { size: "L", color: "Bej", barcode: "8699990000040", sku: "DT-GM-L-BJ", price: 89990n, cost: 61000n },
    ],
  },
  {
    key: "hirka",
    title: "Örme Hırka",
    handle: "orme-hirka",
    productType: "Hırka",
    description: "<p>İnce örme, düğmeli hırka. Yerel ekosistem tohumu (kurgusal ürün).</p>",
    variants: [
      { size: "Tek", color: "Gri", barcode: "8699990000057", sku: "DT-HR-S-GR", price: 29990n, cost: 32000n },
      { size: "Tek", color: "Lacivert", barcode: "8699990000064", sku: "DT-HR-S-LC", price: 29990n, cost: null },
    ],
  },
];

const BRAND_PROFILE = {
  description: "Deneme Tekstil, yerel ekosistem sınamaları için kurgusal bir giyim markasıdır.",
  topics: ["pamuklu tişört", "keten gömlek", "örme hırka"],
  competitors: [
    { name: "Rakip Marka A", website: "https://rakip-marka-a.example", aliases: [] as string[] },
    { name: "Rakip Marka B", website: null, aliases: [] as string[] },
  ],
  socialProfiles: [] as string[],
};

const SHIPPING_ZONE = {
  name: "Türkiye (yerel tohum)",
  countryCodes: ["TR"],
  provinces: [] as string[],
  rates: [{ name: { tr: "Standart Kargo" }, type: "flat" as const, currency: "TRY", amount: "4990", carrierCode: "yurtici", minDeliveryDays: 1, maxDeliveryDays: 3, isActive: true }],
};

/** The only coupon the local discount engine knows: 10% off every line. */
const COUPON = { code: "DENEME10", rateBps: 1000n, campaignId: "0199e0a0-0000-7000-8000-00000000d10a", description: "Deneme %10 indirim (yerel tohum)" };

/**
 * Card fee of the local payment stand-in: 2.99% + 0.25 TRY of the charged total. A fixture
 * value (altyapi has no fee source yet), written on the sale transaction as a provider would.
 */
const CARD_FEE = { rateBps: 299n, fixed: 25n };

interface FixtureOrder {
  key: string;
  lines: Array<{ sku: string; quantity: number }>;
  coupon: string | null;
  province: string;
  district: string;
  touch: { utmSource: string; utmMedium: string; utmCampaign: string; referrer: string | null; landingPage: string; clickIds?: Record<string, string> };
  /** Fulfil, take back and refund this many units of the first line (partial return + refund). */
  returnUnits: number;
}

const ORDERS: FixtureOrder[] = [
  {
    key: "A",
    lines: [
      { sku: "DT-TS-M-BY", quantity: 2 },
      { sku: "DT-GM-M-BJ", quantity: 1 },
    ],
    coupon: null,
    province: "İzmir",
    district: "Konak",
    touch: {
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "sonbahar-kampanyasi",
      referrer: "https://www.google.com/",
      landingPage: "/urun/pamuklu-tisort?utm_source=google&utm_medium=cpc&utm_campaign=sonbahar-kampanyasi",
      clickIds: { gclid: "yerel-tohum-gclid" },
    },
    returnUnits: 0,
  },
  {
    key: "B",
    lines: [
      { sku: "DT-GM-L-BJ", quantity: 1 },
      { sku: "DT-HR-S-GR", quantity: 1 },
    ],
    coupon: COUPON.code,
    province: "İstanbul",
    district: "Kadıköy",
    touch: {
      utmSource: "instagram",
      utmMedium: "paid_social",
      utmCampaign: "deneme10-kupon",
      referrer: "https://l.instagram.com/",
      landingPage: "/urun/keten-gomlek?utm_source=instagram&utm_medium=paid_social&utm_campaign=deneme10-kupon",
      clickIds: { fbclid: "yerel-tohum-fbclid" },
    },
    returnUnits: 0,
  },
  {
    key: "C",
    lines: [
      { sku: "DT-TS-L-BY", quantity: 2 },
      { sku: "DT-HR-S-LC", quantity: 1 },
    ],
    coupon: null,
    province: "Ankara",
    district: "Çankaya",
    touch: {
      utmSource: "newsletter",
      utmMedium: "email",
      utmCampaign: "ekim-bulteni",
      referrer: null,
      landingPage: "/urun/pamuklu-tisort?utm_source=newsletter&utm_medium=email&utm_campaign=ekim-bulteni",
    },
    returnUnits: 1,
  },
];

const orderMarker = (key: string) => `yerel-tohum:${key}`;

// ---------------------------------------------------------------------------
// Local guards and credentials file
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(HERE, ".yerel");
const KIMLIK = path.join(STATE_DIR, "kimlikler.env");

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function assertLocal(label: string, raw: string, port?: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail(`${label} geçerli bir adres değil.`);
  }
  if (!LOCAL_HOSTS.has(url.hostname)) fail(`${label} yerel değil (${url.hostname}); tohum yalnız yerel adreslere yazar.`);
  if (port && url.port !== port) fail(`${label} beklenen yerel port ${port} değil (${url.port || "varsayılan"}).`);
}

/** Which account the seed loads the fixture into (see the header). */
interface SeedAccount {
  email: string;
  org: { name: string; slug: string };
  store: { name: string; slug: string };
  /** The shared fixture account: credentials live in kimlikler.env. */
  fixture: boolean;
  /** Test accounts only: from ALTYAPI_TOHUM_PAROLA. */
  password: string | null;
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const TEST_EMAIL_RE = /^[a-z0-9._+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)*\.local$/;

function parseSeedArgs(argv: readonly string[], env: Record<string, string | undefined>): SeedAccount {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const m = /^--(email|slug)(?:=(.*))?$/.exec(arg);
    if (!m) fail(`bilinmeyen argüman: ${arg} (yalnız --email ve --slug)`);
    const value = m[2] ?? argv[++i];
    if (value === undefined || value === "") fail(`--${m[1]} bir değer ister.`);
    values.set(m[1]!, value);
  }
  const email = (values.get("email") ?? FIXTURE_EMAIL).toLowerCase();
  const slug = values.get("slug") ?? FIXTURE_SLUG;
  const fixture = email === FIXTURE_EMAIL && slug === FIXTURE_SLUG;
  const account = { email, org: { name: BRAND_NAME, slug }, store: { name: BRAND_NAME, slug }, fixture, password: null };
  if (fixture) return account;
  // A test account must not reuse the fixture's email or slugs: that data belongs to the shared account.
  if (email === FIXTURE_EMAIL || slug === FIXTURE_SLUG) fail("Test hesabı paylaşılan fixture hesabının e-postasını ya da slug'ını kullanamaz; ikisini de verin.");
  if (!TEST_EMAIL_RE.test(email)) fail(`--email yalnız .local alan adlı bir test adresi olabilir (${email}).`);
  if (!SLUG_RE.test(slug)) fail(`--slug küçük harf, rakam ve - olmalı (${slug}).`);
  const password = env.ALTYAPI_TOHUM_PAROLA ?? "";
  if (password.length < 12) fail("Test hesabı için ALTYAPI_TOHUM_PAROLA (en az 12 karakter) ortamda verilmeli.");
  return { ...account, password };
}

function readKimlik(): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(KIMLIK)) return out;
  for (const line of readFileSync(KIMLIK, "utf8").split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out.set(m[1]!, m[2]!);
  }
  return out;
}

/** Merges keys into kimlikler.env (other products' keys are kept), under a directory lock. */
async function writeKimlik(values: Record<string, string>) {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const lock = `${KIMLIK}.lock`;
  for (let i = 0; ; i++) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      if (i > 50) fail(`${lock} kilidi alınamadı; başka bir tohum çalışıyor olabilir.`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    const lines = existsSync(KIMLIK) ? readFileSync(KIMLIK, "utf8").split("\n") : [];
    const pending = new Map(Object.entries(values));
    const next = lines.map((line) => {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line.trim());
      if (m && pending.has(m[1]!)) {
        const v = pending.get(m[1]!)!;
        pending.delete(m[1]!);
        return `${m[1]}=${v}`;
      }
      return line;
    });
    while (next.length && next[next.length - 1] === "") next.pop();
    for (const [k, v] of pending) next.push(`${k}=${v}`);
    const tmp = `${KIMLIK}.${process.pid}.tmp`;
    writeFileSync(tmp, `${next.join("\n")}\n`, { mode: 0o600 });
    renameSync(tmp, KIMLIK);
  } finally {
    rmdirSync(lock);
  }
}

// ---------------------------------------------------------------------------
// HTTP (merchant session, Bearer token)
// ---------------------------------------------------------------------------

let API_BASE = "";
let SESSION: string | null = null;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    what: string,
  ) {
    super(`${what} → ${status}: ${body.slice(0, 400)}`);
  }
}

async function http<T>(method: string, route: string, body?: unknown): Promise<{ status: number; data: T; headers: Headers }> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (SESSION) headers.authorization = `Bearer ${SESSION}`;
  const res = await fetch(`${API_BASE}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, text, `${method} ${route}`);
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T, headers: res.headers };
}

const get = async <T>(route: string) => (await http<T>("GET", route)).data;
const post = async <T>(route: string, body: unknown = {}) => (await http<T>("POST", route, body)).data;
const put = async <T>(route: string, body: unknown) => (await http<T>("PUT", route, body)).data;
const patch = async <T>(route: string, body: unknown) => (await http<T>("PATCH", route, body)).data;

function sessionFrom(headers: Headers): string {
  for (const c of headers.getSetCookie()) {
    const m = /^altyapi_session=([^;]+)/.exec(c);
    if (m) return decodeURIComponent(m[1]!);
  }
  fail("Oturum çerezi (altyapi_session) gelmedi.");
}

async function register(email: string, password: string): Promise<{ userId: string; headers: Headers }> {
  const res = await http<{ user: { id: string } }>("POST", "/v1/auth/register", { email, password, name: "Ekosistem Yerel", locale: "tr" });
  return { userId: res.data.user.id, headers: res.headers };
}

async function signIn(account: SeedAccount): Promise<{ userId: string; created: boolean }> {
  if (!account.fixture) {
    // Test account: the caller owns the password; log in when the account exists, else register.
    try {
      const res = await http<{ user: { id: string } }>("POST", "/v1/auth/login", { email: account.email, password: account.password });
      SESSION = sessionFrom(res.headers);
      return { userId: res.data.user.id, created: false };
    } catch (err) {
      if (!(err instanceof HttpError && err.status === 401)) throw err;
    }
    try {
      const { userId, headers } = await register(account.email, account.password!);
      SESSION = sessionFrom(headers);
      return { userId, created: true };
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) fail(`${account.email} zaten kayıtlı ve ALTYAPI_TOHUM_PAROLA tutmuyor.`);
      throw err;
    }
  }
  const saved = readKimlik();
  const email = saved.get("ALTYAPI_EMAIL") || account.email;
  const password = saved.get("ALTYAPI_PASSWORD");
  if (password) {
    try {
      const res = await http<{ user: { id: string } }>("POST", "/v1/auth/login", { email, password });
      SESSION = sessionFrom(res.headers);
      return { userId: res.data.user.id, created: false };
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) fail(`${KIMLIK} içindeki ALTYAPI_PASSWORD ${email} için tutmuyor.`);
      throw err;
    }
  }
  const fresh = randomBytes(24).toString("base64url");
  try {
    const { userId, headers } = await register(email, fresh);
    // Saved before anything else so a failed run can log in again.
    await writeKimlik({ ALTYAPI_EMAIL: email, ALTYAPI_PASSWORD: fresh });
    SESSION = sessionFrom(headers);
    return { userId, created: true };
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) fail(`${email} zaten kayıtlı ama parolası ${KIMLIK} içinde yok (ALTYAPI_PASSWORD).`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Local payment stand-in and discount engine
// ---------------------------------------------------------------------------

/**
 * Takes the place of the iyzico adapter for the seed only: no network, every session is paid
 * by the callback the seed sends, refunds always succeed. Connected in test mode.
 */
class LocalTestIyzico implements PaymentProvider {
  readonly name = "iyzico" as const;

  async createSession(input: CreatePaymentInput): Promise<PaymentSession> {
    return { kind: "redirect", token: `yerel-${input.reference}`, url: null, html: null, expiresAt: new Date(Date.now() + input.timeoutMinutes * 60_000) };
  }

  async verifyCallback(input: CallbackInput): Promise<VerifiedPaymentEvent> {
    const amount = typeof input.body.amount === "string" && /^\d+$/.test(input.body.amount) ? BigInt(input.body.amount) : null;
    const reference = input.reference ?? null;
    return {
      verified: true,
      providerEventId: `yerel-tohum:${reference}`,
      type: "local_test_payment",
      reference,
      outcome: amount === null ? "failed" : "paid",
      amountPaid: amount,
      providerPaymentId: `yerel-${reference}`,
      transactions: [],
      failureCode: amount === null ? "missing_amount" : null,
      failureMessage: null,
      ack: { status: 200, contentType: "text/plain", body: "" },
      evidence: { source: "yerel-tohum", mode: "test", amount: amount?.toString() ?? null },
    };
  }

  async getPayment(_input: GetPaymentInput): Promise<PaymentStatus> {
    return { outcome: "not_found", amountPaid: null, refundedAmount: null, providerPaymentId: null, transactions: [], raw: null };
  }

  async cancel(_input: CancelPaymentInput): Promise<PaymentResult> {
    return { ok: true, providerRefundIds: [], errorCode: null, errorMessage: null };
  }

  async refund(input: RefundPaymentInput): Promise<PaymentResult> {
    return { ok: true, providerRefundIds: [`yerel-iade-${input.refundId}`], errorCode: null, errorMessage: null };
  }

  async verifyCredentials() {
    return { ok: true, message: null };
  }
}

const roundBps = (amount: bigint, bps: bigint) => (amount * bps + 5_000n) / 10_000n;

const localDiscounts: DiscountEngine = {
  async evaluate(_tx, input) {
    const known = input.couponCodes.filter((c) => c === COUPON.code);
    const rejectedCodes = input.couponCodes.filter((c) => c !== COUPON.code).map((code) => ({ code, reason: "not_found" }));
    if (!known.length) return { discounts: [], appliedCodes: [], rejectedCodes, warnings: [] };
    return {
      discounts: [
        {
          campaignId: COUPON.campaignId,
          code: COUPON.code,
          description: COUPON.description,
          lineAmounts: input.lines.map((l) => ({ lineId: l.lineId, amount: roundBps(l.lineSubtotal, COUPON.rateBps) })),
          shippingAmount: 0n,
        },
      ],
      appliedCodes: [COUPON.code],
      rejectedCodes,
      warnings: [],
    };
  },
};

// ---------------------------------------------------------------------------
// API shapes used here (bigint arrives as a decimal string)
// ---------------------------------------------------------------------------

interface ProductDetail {
  id: string;
  status: string;
  taxClassId: string | null;
  translations: Record<string, { title: string; handle: string; descriptionHtml: string }>;
  options: Array<{ id: string; name: Record<string, string>; values: Array<{ id: string; value: Record<string, string> }> }>;
  variants: Array<{ id: string; sku: string | null; barcode: string | null; price: { amount: string } | null; cost: string | null; inventory: { available: number } | null }>;
}

interface OrderDetail {
  order: { id: string; number: string; status: string; paymentStatus: string; fulfillmentStatus: string };
  lines: Array<{ id: string; sku: string | null; quantity: number; fulfilledQuantity: number; returnedQuantity: number; refundedQuantity: number }>;
  fulfillments: Array<{ id: string }>;
  refunds: Array<{ id: string; status: string; amount: string }>;
  returns: Array<{ id: string; status: string }>;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function productBody(p: FixtureProduct, taxClassId: string, locationId: string, existing?: ProductDetail) {
  const sizes = [...new Set(p.variants.map((v) => v.size))];
  const colors = [...new Set(p.variants.map((v) => v.color))];
  const optionId = (name: string) => existing?.options.find((o) => o.name.tr === name);
  const valueId = (name: string, value: string) => optionId(name)?.values.find((v) => v.value.tr === value)?.id;
  return {
    status: "active",
    kind: "physical",
    translations: { tr: { title: p.title, handle: p.handle, descriptionHtml: p.description } },
    vendorName: BRAND_NAME,
    productType: p.productType,
    taxClassId,
    options: [
      { id: optionId("Beden")?.id, name: { tr: "Beden" }, values: sizes.map((s) => ({ id: valueId("Beden", s), value: { tr: s } })) },
      { id: optionId("Renk")?.id, name: { tr: "Renk" }, values: colors.map((c) => ({ id: valueId("Renk", c), value: { tr: c } })) },
    ],
    variants: p.variants.map((v) => ({
      id: existing?.variants.find((x) => x.sku === v.sku)?.id,
      optionValues: [v.size, v.color],
      sku: v.sku,
      barcode: v.barcode,
      price: v.price.toString(),
      weightGrams: 400,
      trackInventory: true,
      initialStock: [{ locationId, quantity: STOCK_PER_VARIANT }],
    })),
  };
}

function productMatches(p: FixtureProduct, d: ProductDetail, taxClassId: string): boolean {
  if (d.status !== "active" || d.taxClassId !== taxClassId || d.translations.tr?.title !== p.title) return false;
  if (d.variants.length !== p.variants.length) return false;
  return p.variants.every((v) => {
    const x = d.variants.find((y) => y.sku === v.sku);
    return !!x && x.barcode === v.barcode && x.price?.amount === v.price.toString();
  });
}

async function main() {
  const account = parseSeedArgs(process.argv.slice(2), process.env);
  const { org: ORG, store: STORE } = account;
  const env = parseEnv(apiEnvSchema, process.env);
  if (env.APP_ENV !== "local") fail(`APP_ENV=${env.APP_ENV}; tohum yalnız APP_ENV=local ile çalışır.`);
  assertLocal("DATABASE_URL", env.DATABASE_URL, "5433");
  assertLocal("API_URL", env.API_URL);
  API_BASE = env.API_URL.replace(/\/+$/, "");

  try {
    const ready = await fetch(`${API_BASE}/readyz`, { signal: AbortSignal.timeout(3000) });
    if (!ready.ok) fail(`altyapi API hazır değil (${API_BASE}/readyz → ${ready.status}).`);
  } catch {
    fail(`altyapi API ayakta değil (${API_BASE}). Önce: tools/ekosistem/yerel.sh up altyapi-api altyapi-worker`);
  }

  const database = createDatabase({ url: env.DATABASE_URL, max: 3, ssl: false, applicationName: "altyapi-tohum" });
  const db = database.db;
  const keys = createKeyProvider(env);
  if (!keys) fail("LOCAL_MASTER_KEY yok; ödeme bağlantısı şifrelenemez.");

  try {
    // 1. Merchant user, organization, store
    const { userId, created } = await signIn(account);
    console.log(`✓ kullanıcı ${account.email} (${created ? "oluşturuldu" : "giriş yapıldı"})`);

    const me = await get<{ organizations: Array<{ id: string; slug: string }> }>("/v1/me");
    let org = me.organizations.find((o) => o.slug === ORG.slug);
    if (!org) org = await post<{ id: string; slug: string }>("/v1/organizations", ORG);
    const orgBase = `/v1/organizations/${org.id}`;

    const stores = await get<{ items: Array<{ id: string; slug: string; status: string }> }>(`${orgBase}/stores`);
    let store = stores.items.find((s) => s.slug === STORE.slug);
    if (!store) store = await post<{ id: string; slug: string; status: string }>(`${orgBase}/stores`, { ...STORE, defaultLocale: "tr", defaultCurrency: "TRY", countryCode: "TR" });
    const base = `${orgBase}/stores/${store.id}`;
    if (store.status !== "active") await patch(base, { status: "active" });
    if (account.fixture) await writeKimlik({ ALTYAPI_EMAIL: account.email, ALTYAPI_ORG_ID: org.id, ALTYAPI_STORE_ID: store.id, ALTYAPI_ORG_SLUG: org.slug, ALTYAPI_STORE_SLUG: store.slug });
    console.log(`✓ organizasyon ${org.slug} (${org.id}), mağaza ${store.slug} (${store.id})`);

    // Service-layer context of the same user (same grants the API would resolve).
    const membership = await loadMembership(db, userId, org.id);
    if (!membership) fail("Kullanıcı organizasyon üyesi değil.");
    const ctx: StoreContext = await loadStoreContext(db, { organizationId: org.id, principal: { kind: "user", userId, agentId: null, sessionId: null, grants: membership.grants } }, store.id);
    const scope = { organizationId: org.id, storeId: store.id };

    // 2. Tax class, stock location, shipping zone
    const tax = await put<{ id: string }>(`${base}/tax-classes`, { ...TAX, isDefault: false });
    const locations = await get<{ items: Array<{ id: string; isDefault?: boolean }> }>(`${base}/inventory/locations`);
    const location = locations.items.find((l) => l.isDefault) ?? locations.items[0];
    if (!location) fail("Mağazada stok konumu yok.");
    const zones = await get<{ items: Array<{ id: string; name: string }> }>(`${base}/shipping-zones`);
    if (!zones.items.some((z) => z.name === SHIPPING_ZONE.name)) await post(`${base}/shipping-zones`, SHIPPING_ZONE);
    console.log(`✓ vergi sınıfı ${TAX.name}, stok konumu, kargo bölgesi "${SHIPPING_ZONE.name}"`);

    // 3. Products (published) and costs with VAT treatment
    const variantIds = new Map<string, string>();
    for (const p of PRODUCTS) {
      const found = await get<{ items: Array<{ id: string }> }>(`${base}/products?sku=${encodeURIComponent(p.variants[0]!.sku)}`);
      let detail = found.items[0] ? await get<ProductDetail>(`${base}/products/${found.items[0].id}`) : null;
      if (!detail) {
        const createdProduct = await post<{ id: string }>(`${base}/products`, productBody(p, tax.id, location.id));
        detail = await get<ProductDetail>(`${base}/products/${createdProduct.id}`);
        console.log(`  + ${p.title} oluşturuldu`);
      } else if (!productMatches(p, detail, tax.id)) {
        await put(`${base}/products/${detail.id}`, productBody(p, tax.id, location.id, detail));
        detail = await get<ProductDetail>(`${base}/products/${detail.id}`);
        console.log(`  ~ ${p.title} fixture'a göre güncellendi`);
      } else {
        console.log(`  = ${p.title} zaten güncel`);
      }
      for (const v of p.variants) {
        const id = detail.variants.find((x) => x.sku === v.sku)?.id;
        if (!id) fail(`${v.sku} varyantı bulunamadı.`);
        variantIds.set(v.sku, id);
      }
    }
    await withTenantTx(db, scope, async (tx) => {
      for (const p of PRODUCTS) {
        for (const v of p.variants) {
          // The fixture cost is VAT-inclusive at the product's rate; a missing cost stays missing.
          if (v.cost !== null) await setVariantCost(tx, scope, variantIds.get(v.sku)!, { currency: "TRY", amount: v.cost, taxIncluded: true, taxRateBps: TAX.rateBps, source: "manual" });
        }
      }
    });
    console.log(`✓ ${PRODUCTS.length} ürün / ${variantIds.size} varyant yayında, maliyetler KDV dahil (%10)`);

    // 4. Brand profile (§7.1)
    const profile = await get<typeof BRAND_PROFILE>(`${base}/ekosistem/brand-profile`);
    const same =
      profile.description === BRAND_PROFILE.description &&
      JSON.stringify(profile.topics) === JSON.stringify(BRAND_PROFILE.topics) &&
      JSON.stringify(profile.competitors.map((c) => [c.name, c.website])) === JSON.stringify(BRAND_PROFILE.competitors.map((c) => [c.name, c.website]));
    if (!same) await put(`${base}/ekosistem/brand-profile`, BRAND_PROFILE);
    console.log(`✓ marka profili (${same ? "zaten güncel" : "yazıldı"})`);

    // 5. Storefront orders through the checkout code with the local payment stand-in
    const real = createProviderRegistry();
    const payments: PaymentsDeps = { db, keys, registry: { ...real, iyzico: { ...real.iyzico, create: () => new LocalTestIyzico() } } };
    const connection = await connectProvider(payments, ctx, { provider: "iyzico", mode: "test", credentials: { apiKey: "yerel-tohum-sahte-anahtar", secretKey: "yerel-tohum-sahte-gizli" }, priority: 0 });
    const cartDeps = { db, discounts: localDiscounts };
    const checkoutDeps = { ...cartDeps, payments, apiUrl: API_BASE, reservationMinutes: 30, appEnv: env.APP_ENV };
    const gateway = createRefundGateway(payments);

    const orderIds = new Map<string, string>();
    try {
      for (const o of ORDERS) {
        const marker = orderMarker(o.key);
        const existing = await withTenantTx(db, scope, (tx) =>
          tx.select({ id: orders.id, status: orders.status, confirmedAt: orders.confirmedAt }).from(orders).where(and(eq(orders.storeId, store.id), eq(orders.note, marker))).orderBy(desc(orders.createdAt)),
        );
        const done = existing.find((r) => r.confirmedAt !== null);
        // A run that stopped between checkout and payment leaves an unpaid order: void it and start over.
        for (const r of existing.filter((x) => x.status === "awaiting_payment")) await withTenantTx(db, scope, (tx) => cancelUnpaidOrder(tx, scope, r.id, "seed_restarted"));
        if (done) {
          orderIds.set(o.key, done.id);
          continue;
        }
        const { token } = await createCart(db, scope, { currency: "TRY", locale: "tr" });
        for (const l of o.lines) await addLine(cartDeps, scope, token, { variantId: variantIds.get(l.sku)!, quantity: l.quantity, properties: {} });
        await setContact(cartDeps, scope, token, { email: `ekosistem-yerel+${o.key.toLowerCase()}@example.com`, phone: null, acceptsMarketing: false, note: marker });
        const address = { firstName: "Deneme", lastName: `Müşteri ${o.key}`, line1: "Deneme Sokak No: 1", district: o.district, city: o.district, province: o.province, postalCode: null, countryCode: "TR", phone: "+905550000000" };
        await setAddresses(cartDeps, scope, token, { shipping: address, billing: null, billingSameAsShipping: true });
        const rates = await shippingOptions(cartDeps, scope, token);
        if (!rates[0]) throw new Error("Kargo seçeneği çıkmadı.");
        await selectShippingRate(cartDeps, scope, token, rates[0].id);
        if (o.coupon) await applyCoupon(cartDeps, scope, token, o.coupon);
        const at = new Date().toISOString();
        const touch = { at, ...o.touch };
        await setAttribution(cartDeps, scope, token, { firstTouch: touch, lastTouch: touch, consent: { analytics: true, marketing: false } });
        const started = await startCheckout(checkoutDeps, scope, token, { provider: "iyzico", returnBaseUrl: "http://localhost:3001" }, { ip: "127.0.0.1", userAgent: "altyapi-tohum" });
        const [attempt] = await withTenantTx(db, scope, (tx) =>
          tx.select({ amount: paymentAttempts.amount, reference: paymentAttempts.providerReference }).from(paymentAttempts).where(eq(paymentAttempts.id, started.payment.attemptId)),
        );
        // Like a real callback, the body names its payment (iyzico: conversation id / token). Payment
        // events are deduplicated by payload hash, so a bare {status, amount} would be taken for the
        // same notification as an equal order in another store and never confirm this one.
        const body = { status: "success", conversationId: attempt!.reference, amount: attempt!.amount.toString() };
        const result = await handleIyzicoCallback(payments, started.payment.attemptId, { headers: {}, body, rawBody: JSON.stringify(body) });
        if (result.outcome !== "paid") throw new Error(`${o.key} siparişi ödenmedi (${result.outcome}).`);
        orderIds.set(o.key, started.orderId);
        console.log(`  + sipariş ${o.key} #${started.orderNumber} ödendi (kart, yerel test)`);
      }

      // Card fee on the sale transaction (no adapter records one; see header).
      await withTenantTx(db, scope, async (tx) => {
        const sales = await tx
          .select({ id: paymentTransactions.id, amount: paymentTransactions.amount })
          .from(paymentTransactions)
          .innerJoin(paymentAttempts, eq(paymentAttempts.id, paymentTransactions.paymentAttemptId))
          .where(and(inArray(paymentAttempts.orderId, [...orderIds.values()]), eq(paymentTransactions.type, "sale"), isNull(paymentTransactions.feeAmount)));
        for (const s of sales) await tx.update(paymentTransactions).set({ feeAmount: roundBps(s.amount, CARD_FEE.rateBps) + CARD_FEE.fixed }).where(eq(paymentTransactions.id, s.id));
      });

      // Partial return + refund (fulfil → return → receive over HTTP, refund via the stand-in)
      for (const o of ORDERS.filter((x) => x.returnUnits > 0)) {
        const id = orderIds.get(o.key)!;
        let d = await get<OrderDetail>(`${base}/orders/${id}`);
        const line = d.lines.find((l) => l.sku === o.lines[0]!.sku)!;
        if (d.order.fulfillmentStatus === "unfulfilled") {
          await post(`${base}/orders/${id}/fulfillments`, { carrierCode: "yurtici", trackingNumber: `YEREL${d.order.number}`, notifyCustomer: false });
          d = await get<OrderDetail>(`${base}/orders/${id}`);
        }
        let ret = d.returns[0];
        if (!ret) {
          ret = await post<{ id: string; status: string }>(`${base}/orders/${id}/returns`, { lines: [{ orderLineId: line.id, quantity: o.returnUnits, reason: "Beden uymadı", restock: true }], reason: "Beden uymadı (yerel tohum)" });
        }
        if (ret.status === "approved") await post(`${base}/returns/${ret.id}/receive`, { restockLocationId: location.id });
        const refund = await createRefund(db, gateway, ctx, id, { lines: [{ orderLineId: line.id, quantity: o.returnUnits }], returnId: ret.id, reason: "Beden uymadı (yerel tohum)", idempotencyKey: `yerel-tohum:${o.key}:iade` }, "127.0.0.1");
        if (refund.status !== "succeeded") throw new Error(`${o.key} iadesi başarısız: ${refund.status}`);
      }
    } finally {
      // Whatever went wrong above: an order this run left unpaid would be reconciled 45 minutes later by the
      // worker's REAL iyzico adapter with the fake credentials (a call to the iyzico sandbox), so it is voided
      // now; and the stand-in must not serve real checkouts: the connection stays, disabled.
      const markers = ORDERS.map((o) => orderMarker(o.key));
      const unpaid = await withTenantTx(db, scope, (tx) =>
        tx.select({ id: orders.id }).from(orders).where(and(eq(orders.storeId, store.id), inArray(orders.note, markers), eq(orders.status, "awaiting_payment"))),
      );
      for (const r of unpaid) await withTenantTx(db, scope, (tx) => cancelUnpaidOrder(tx, scope, r.id, "seed_aborted"));
      await setConnectionStatus(db, ctx, connection.id, "disabled");
    }

    // 6. Verification: the same §7.2 / §7.3 exports a linked peer reads (without a link).
    const exportDeps = { db, storeRootDomain: env.STORE_ROOT_DOMAIN, mediaBaseUrl: env.MEDIA_PUBLIC_BASE_URL ?? null } as unknown as EkosistemServerDeps;
    const pseudoLink = { organizationId: org.id, storeId: store.id } as LinkRow;
    const catalog = await exportCatalogProducts(exportDeps, pseudoLink, [["limit", "200"]], { withCosts: true });
    const exported = await exportOrders(exportDeps, pseudoLink, [["limit", "200"]], { withCosts: true });
    const seeded = exported.items.filter((i): i is Extract<typeof i, { number: string }> => "number" in i && [...orderIds.values()].includes(i.ref));

    const fixtureVariants = PRODUCTS.flatMap((p) => p.variants);
    const catalogVariants = catalog.items.flatMap((p) => ("variants" in p ? p.variants : [])).filter((v) => fixtureVariants.some((f) => f.sku === v.sku));
    const checks: Array<[string, boolean, string]> = [
      ["yayındaki ürün", catalog.items.filter((p) => "variants" in p && p.variants.some((v) => fixtureVariants.some((f) => f.sku === v.sku))).length === PRODUCTS.length, `${PRODUCTS.length} beklenir`],
      ["yayındaki varyant", catalogVariants.length === fixtureVariants.length, `${fixtureVariants.length} beklenir`],
      [
        "maliyet (KDV dahil, %10)",
        catalogVariants.filter((v) => v.cost?.taxIncluded === true && v.cost.taxRateBps === TAX.rateBps).length === fixtureVariants.filter((f) => f.cost !== null).length,
        `${fixtureVariants.filter((f) => f.cost !== null).length} beklenir`,
      ],
      ["maliyetsiz varyant", catalogVariants.filter((v) => v.cost === null).length === fixtureVariants.filter((f) => f.cost === null).length, `${fixtureVariants.filter((f) => f.cost === null).length} beklenir`],
      ["ödenmiş vitrin siparişi", seeded.length === ORDERS.length, `${ORDERS.length} beklenir`],
      ["kart ücreti dolu", seeded.every((i) => i.payment?.method === "card" && i.payment.fee !== null), "hepsi"],
      ["indirim kodu", seeded.filter((i) => i.discounts.some((x) => x.code === COUPON.code)).length === ORDERS.filter((x) => x.coupon).length, `${ORDERS.filter((x) => x.coupon).length} beklenir`],
      ["kısmi iade", seeded.filter((i) => i.paymentStatus === "partially_refunded" && i.refunds.length > 0).length === ORDERS.filter((x) => x.returnUnits > 0).length, `${ORDERS.filter((x) => x.returnUnits > 0).length} beklenir`],
      ["UTM atfı", seeded.every((i) => !!i.attribution.firstTouch?.utmSource), "hepsi"],
    ];

    console.log("\nSiparişler (§7.3 dışa aktarımıyla):");
    for (const o of ORDERS) {
      const i = seeded.find((x) => x.ref === orderIds.get(o.key));
      if (!i) continue;
      const t = i.attribution.firstTouch;
      console.log(
        `  ${o.key} #${i.number} ${i.status}/${i.paymentStatus} toplam ${i.totals.total} indirim ${i.totals.discount} iade ${i.totals.refunded} maliyet ${i.totals.cost ?? "null"} ` +
          `kart ücreti ${i.payment?.fee ?? "null"} · ${i.city} · ${t?.utmSource}/${t?.utmMedium}${t?.clickChannel ? ` (${t.clickChannel})` : ""}`,
      );
    }
    console.log("\nDoğrulama:");
    for (const [label, ok, expected] of checks) console.log(`  ${ok ? "✓" : "✗"} ${label} (${expected})`);
    if (account.fixture) {
      await writeKimlik({ ALTYAPI_ORG_ID: org.id, ALTYAPI_STORE_ID: store.id });
      console.log(`\nKimlikler: ${KIMLIK} (ALTYAPI_EMAIL, ALTYAPI_PASSWORD, ALTYAPI_ORG_ID, ALTYAPI_STORE_ID)`);
    } else {
      // Machine-readable result for the end-to-end runner (no secrets: the caller has the password).
      console.log(`TOHUM_SONUC ${JSON.stringify({ email: account.email, userId, organizationId: org.id, organizationSlug: org.slug, storeId: store.id, storeSlug: store.slug })}`);
    }
    if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
  } finally {
    await database.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
