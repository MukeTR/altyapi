/**
 * Uçtan uca: altyapi ↔ Yanıt (docs/ekosistem/v1.md), GERÇEK süreçlere karşı — altyapi API (:4000) + worker
 * (:4100) ve Yanıt next dev (:3200). Hiçbir sahte eş yok; yalnız yerel adresler.
 *
 *   tools/ekosistem/yerel.sh up altyapi-api altyapi-worker yanit
 *   tools/ekosistem/yerel.sh test
 *   (= cd apps/api && node --env-file=../../.env --import tsx ../../tools/ekosistem/e2e-altyapi-yanit.ts)
 *
 * Hermetik: her koşu YENİ bir altyapi kullanıcısı/organizasyonu/mağazası ve YENİ bir Yanıt BRAND kiracısı açar ve
 * ortak fixture'ı onlara yükler (tohum-altyapi.ts --email/--slug, Yanıt ekosistem-yerel-tohum.ts --email/--kiraci).
 * Paylaşılan fixture hesaplarına (ekosistem-yerel@…) dokunulmaz. Açılan bağlantılar senaryo içinde kaldırılır
 * (kaldırma da sınanır); Yanıt test kiracısı sonda kendi hesap silme ucuyla silinir. altyapi'de hesap/mağaza silme
 * ucu yok: test mağazası (slug e1-…) yerel DB'de kalır.
 *
 * Senaryolar:
 *   A  altyapi kod üretir → Yanıt kabul eder + onaylar → altyapi onaylar → iki tarafta active. Yanıt altyapi
 *      kataloğunu çeker (Yanıt'ın katalog eşitleme tetikleyicisi); altyapi worker'ı §9.1–9.4'ü çeker; okuma
 *      modelleri Yanıt'ın imzalı uçlarının SUNDUĞU değerlerle birebir; fırsattan taslak sayfa (yayınlanmaz).
 *      Sonda Yanıt tarafından kaldırma → altyapi'de revoked, kataloğun bağlantısı kesilir.
 *   B  Yanıt kod üretir → altyapi kabul eder + onaylar → Yanıt onaylar → active; veri çekmesi; altyapi'den
 *      kaldırma → worker'ın DELETE teslimiyle Yanıt'ta revoked; kaldırılmış bağlantıya imzalı istek link_invalid;
 *      Yanıt'ın çektiği altyapi kataloğunun bağlantısı kesilir.
 *   C  Negatifler: yanlış Ekosistem-Product, nonce tekrarı, bekleyen bağlantıda veri ucu 409 (iki yönde).
 *
 * Beklentiler sabit sayı değildir: karşı tarafın sunduğu değerden (imzalı uçlar) ya da fixture tanımından (tohumun
 * yazdığı "beklenen" satırları) türetilir.
 *
 * Yanıt'a yalnız HTTP (oturum çerezli tacir uçları, imzalı /ekosistem/v1 uçları). Tek istisna: Yanıt'ın katalog
 * kaydındaki ilk varyant tanımlayıcıları (sku/barkod/varyant sayısı) hiçbir uçta yok; bunlar yerel Yanıt DB'sinden
 * SALT OKUNUR (default_transaction_read_only) psql ile okunur.
 *
 * Hız sınırları gevşetilmez: koşu başına 1 claim (her yönde), 1 Yanıt girişi. Yanıt girişi IP başına 10/15 dk.
 * `E2E_KORU=1` Yanıt test kiracısını silmez (hata ayıklama).
 */
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiEnvSchema, parseEnv } from "../../packages/config/src/index";
import { and, createDatabase, desc, eq, ekosistemLinks, pages, withTenantTx, yanitCitations, yanitGaps, yanitOpportunities, yanitVisibilitySnapshots, type Database } from "../../packages/database/src/index";
import { createKeyProvider, type KeyProvider } from "../../packages/secrets/src/index";
import { createQueue, enqueueJob, type Queue } from "../../packages/events/src/index";
import { PULL_LINK_JOB_TYPE, PULL_MIN_INTERVAL_MS, canonicalQueryFromParams, canonicalTarget, decryptLinkSecret, generateRequestNonce, signRequest, type EkosistemProduct } from "../../packages/ekosistem/src/index";

// ---------------------------------------------------------------------------
// Ortam ve yerel bekçiler
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const YANIT_DIR = process.env.YANIT_DIR || "/Users/macos/yanit-wt/ekosistem";
const NODE22_BIN = process.env.NODE22_BIN || "/opt/homebrew/opt/node@22/bin";
const PSQL = process.env.PSQL || "/opt/homebrew/opt/postgresql@17/bin/psql";
const YANIT_BASE = "http://localhost:3200";
const WORKER_HEALTH = "http://localhost:4100/healthz";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const REQUEST_TIMEOUT_MS = 90_000;

function abort(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(2);
}

function assertLocal(label: string, raw: string, port?: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    abort(`${label} geçerli bir adres değil.`);
  }
  if (!LOCAL_HOSTS.has(url.hostname)) abort(`${label} yerel değil (${url.hostname}); uçtan uca test yalnız yerel servislere gider.`);
  if (port && url.port !== port) abort(`${label} beklenen yerel port ${port} değil (${url.port || "varsayılan"}).`);
  return url;
}

function readEnvFile(file: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (m) out.set(m[1]!, m[2]!.trim().replace(/^"(.*)"$/, "$1"));
  }
  return out;
}

const env = parseEnv(apiEnvSchema, process.env);
if (env.APP_ENV !== "local") abort(`APP_ENV=${env.APP_ENV}; uçtan uca test yalnız APP_ENV=local ile çalışır.`);
assertLocal("DATABASE_URL", env.DATABASE_URL, "5433");
const ALTYAPI_BASE = assertLocal("API_URL", env.API_URL).origin;
const YANIT_DB_URL = (() => {
  const raw = readEnvFile(path.join(YANIT_DIR, "apps/web/.env.local")).get("DATABASE_URL");
  if (!raw) abort("Yanıt apps/web/.env.local DATABASE_URL yok.");
  assertLocal("Yanıt DATABASE_URL", raw, "5432");
  return raw;
})();

// ---------------------------------------------------------------------------
// Sonuçlar
// ---------------------------------------------------------------------------

interface Result {
  scenario: string;
  name: string;
  ok: boolean;
  detail: string;
}
const results: Result[] = [];
let scenario = "hazırlık";

function check(name: string, ok: boolean, detail = ""): boolean {
  results.push({ scenario, name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
  return ok;
}

/** JSON with sorted keys, so equal values compare equal whatever the key order. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return v;
  });
}

function checkEqual(name: string, actual: unknown, expected: unknown): boolean {
  const a = stable(actual);
  const e = stable(expected);
  return check(name, a === e, `beklenen ${e.slice(0, 700)} · gelen ${a.slice(0, 700)}`);
}

/** A failed prerequisite: the rest of the scenario cannot run. */
class StepFailed extends Error {}

function must<T>(name: string, value: T | null | undefined, detail = ""): T {
  if (value === null || value === undefined || value === false) {
    check(name, false, detail);
    throw new StepFailed(name);
  }
  check(name, true);
  return value;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined | false>, opts: { timeoutMs: number; intervalMs?: number }): Promise<T | null> {
  const until = Date.now() + opts.timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) {
      console.log(`    … ${label}: ${Math.round(opts.timeoutMs / 1000)} sn içinde olmadı`);
      return null;
    }
    await sleep(opts.intervalMs ?? 1500);
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

interface HttpResult<T = unknown> {
  status: number;
  json: T;
  text: string;
  headers: Headers;
}

async function httpRaw<T>(url: string, init: { method: string; headers?: Record<string, string>; body?: Buffer | string }): Promise<HttpResult<T>> {
  assertLocal("istek adresi", url);
  const res = await fetch(url, { method: init.method, headers: init.headers, body: init.body, redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json: json as T, text, headers: res.headers };
}

/** altyapi tacir API'si (Bearer oturum). */
class AltyapiMerchant {
  token = "";
  constructor(
    readonly organizationId: string,
    readonly storeId: string,
  ) {}

  get base() {
    return `/v1/organizations/${this.organizationId}/stores/${this.storeId}`;
  }

  async login(email: string, password: string) {
    const r = await httpRaw<{ user?: { id: string } }>(`${ALTYAPI_BASE}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ email, password }) });
    const cookie = r.headers.getSetCookie().map((c) => /^altyapi_session=([^;]+)/.exec(c)?.[1]).find(Boolean);
    if (r.status !== 200 || !cookie) throw new StepFailed(`altyapi girişi ${r.status}: ${r.text.slice(0, 200)}`);
    this.token = decodeURIComponent(cookie);
  }

  async call<T = any>(method: string, route: string, body?: unknown): Promise<HttpResult<T>> {
    const headers: Record<string, string> = { accept: "application/json", authorization: `Bearer ${this.token}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    return httpRaw<T>(`${ALTYAPI_BASE}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
}

/** Yanıt tacir uçları (oturum çerezi). */
class YanitMerchant {
  cookies = new Map<string, string>();

  private absorb(headers: Headers) {
    for (const c of headers.getSetCookie()) {
      const m = /^([^=;]+)=([^;]*)/.exec(c);
      if (m) this.cookies.set(m[1]!, m[2]!);
    }
  }

  async login(email: string, password: string) {
    const r = await httpRaw(`${YANIT_BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ email, password }) });
    this.absorb(r.headers);
    if (r.status !== 200 || !this.cookies.get("iai_token")) throw new StepFailed(`Yanıt girişi ${r.status}: ${r.text.slice(0, 200)}`);
  }

  async call<T = any>(method: string, route: string, body?: unknown): Promise<HttpResult<T>> {
    const headers: Record<string, string> = { accept: "application/json", cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") };
    if (body !== undefined) headers["content-type"] = "application/json";
    const r = await httpRaw<T>(`${YANIT_BASE}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    this.absorb(r.headers);
    return r;
  }
}

// ---------------------------------------------------------------------------
// İmzalı /ekosistem/v1 istekleri (§5) — test, bağlantının anahtarını altyapi'nin şifreli kaydından çözer
// ---------------------------------------------------------------------------

type Side = "altyapi" | "yanit";

interface LinkKey {
  id: string;
  secret: string;
}

interface SignedCall {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number>;
  body?: unknown;
  product: EkosistemProduct;
  link: LinkKey;
  nonce?: string;
}

async function signed<T = any>(side: Side, call: SignedCall): Promise<HttpResult<T>> {
  const query = call.query ? canonicalQueryFromParams(call.query) : "";
  const canonical = canonicalTarget(query ? `${call.path}?${query}` : call.path);
  const body = call.method === "GET" || call.method === "DELETE" ? Buffer.alloc(0) : Buffer.from(JSON.stringify(call.body ?? {}), "utf8");
  const s = signRequest({ secret: call.link.secret, linkId: call.link.id, product: call.product, method: call.method, canonical, body, ...(call.nonce ? { nonce: call.nonce } : {}) });
  const headers: Record<string, string> = { accept: "application/json", ...s.headers };
  if (body.byteLength) headers["content-type"] = "application/json";
  const base = side === "altyapi" ? ALTYAPI_BASE : `${YANIT_BASE}/api`;
  return httpRaw<T>(`${base}${canonical}`, { method: call.method, headers, body: body.byteLength ? body : undefined });
}

const errorCode = (r: HttpResult): string | null => (r.json as { error?: { code?: string } } | null)?.error?.code ?? null;

function expectError(name: string, r: HttpResult, status: number, code: string): boolean {
  return check(name, r.status === status && errorCode(r) === code, `HTTP ${r.status} ${errorCode(r) ?? r.text.slice(0, 160)} (beklenen ${status} ${code})`);
}

/** Every page of an incremental endpoint without `since` (the full current set, §6.3). */
async function signedAll<T>(side: Side, call: Omit<SignedCall, "query"> & { query?: Record<string, string | number> }): Promise<{ items: T[]; status: number }> {
  const items: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const r: HttpResult<{ items?: T[]; nextCursor?: string | null }> = await signed(side, { ...call, query: { ...(call.query ?? {}), limit: 200, ...(cursor ? { cursor } : {}) } });
    if (r.status !== 200 || !Array.isArray(r.json?.items)) return { items, status: r.status };
    items.push(...r.json.items);
    cursor = r.json.nextCursor ?? null;
    if (!cursor) return { items, status: 200 };
  }
  return { items, status: 0 };
}

// ---------------------------------------------------------------------------
// Tohumlar (hermetik test hesapları)
// ---------------------------------------------------------------------------

function run(cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

function seedResult<T>(out: string): T | null {
  const line = out.split("\n").find((l) => l.startsWith("TOHUM_SONUC "));
  return line ? (JSON.parse(line.slice("TOHUM_SONUC ".length)) as T) : null;
}

interface AltyapiAccount {
  email: string;
  password: string;
  userId: string;
  organizationId: string;
  storeId: string;
  storeSlug: string;
}

async function seedAltyapi(tag: string): Promise<AltyapiAccount> {
  const email = `${tag}@altyapi.local`;
  const password = randomBytes(18).toString("base64url");
  const r = await run(process.execPath, ["--env-file=../../.env", "--import", "tsx", path.join(ROOT, "tools/ekosistem/tohum-altyapi.ts"), "--email", email, "--slug", tag], {
    cwd: path.join(ROOT, "apps/api"),
    env: { HOME: process.env.HOME, PATH: process.env.PATH, LANG: process.env.LANG ?? "en_US.UTF-8", TMPDIR: process.env.TMPDIR ?? "/tmp", ALTYAPI_TOHUM_PAROLA: password },
  });
  const res = seedResult<Omit<AltyapiAccount, "password">>(r.out);
  if (r.code !== 0 || !res) throw new StepFailed(`altyapi tohumu başarısız (çıkış ${r.code}):\n${r.out.slice(-1500)}`);
  return { ...res, password };
}

interface YanitExpectations {
  summary7: { validRuns: number; runsWithBrand: number; visibilityBps: number | null };
  previous7: { visibilityBps: number | null };
  summary30: { validRuns: number; runsWithBrand: number; visibilityBps: number | null };
  competitors7: Record<string, number>;
  gapQueries: string[];
  opportunities: number;
  citations: Array<{ domain: string; count: number; shareBps: number | null }>;
}

interface YanitAccount {
  email: string;
  password: string;
  userId: string;
  tenantId: string;
  expected: YanitExpectations;
}

/** The seed prints what §9 must answer for its fixture (derived from the rows it wrote). */
function parseYanitExpectations(out: string): YanitExpectations {
  const grab = (re: RegExp) => {
    const m = re.exec(out);
    if (!m) throw new StepFailed(`Yanıt tohum çıktısında beklenen satır yok: ${re}`);
    return m;
  };
  const s7 = grab(/beklenen §9\.1 7 gün : (\{[^\n]*?\})\s+önceki 7 gün: (\{[^\n]*\})/);
  const s30 = grab(/beklenen §9\.1 30 gün: (\{[^\n]*\})/);
  const comp = grab(/beklenen §9\.1 rakipler \(runsMentioned\) 7 gün: (\{[^\n]*\})/);
  const gaps = grab(/beklenen §9\.2 boşluk: ([^\n]*)/);
  const opp = grab(/beklenen §9\.3: (\d+) fırsat/);
  const cit = grab(/beklenen §9\.4 30 gün \(toplam \d+\): ([^\n]*)/);
  return {
    summary7: JSON.parse(s7[1]!),
    previous7: JSON.parse(s7[2]!),
    summary30: JSON.parse(s30[1]!),
    competitors7: JSON.parse(comp[1]!),
    gapQueries: gaps[1]!.split(" | ").map((q) => q.trim()),
    opportunities: Number(opp[1]),
    citations: cit[1]!.split(", ").map((part) => {
      const m = /^(.+)=(\d+) \((null|\d+) bps\)$/.exec(part.trim());
      if (!m) throw new StepFailed(`§9.4 beklenen satırı okunamadı: ${part}`);
      return { domain: m[1]!, count: Number(m[2]), shareBps: m[3] === "null" ? null : Number(m[3]) };
    }),
  };
}

async function seedYanit(tag: string): Promise<YanitAccount> {
  const email = `${tag}@yanit.local`;
  const password = randomBytes(18).toString("base64url");
  const r = await run("pnpm", ["--silent", "--filter", "@yanit/db", "seed:ekosistem-yerel", "--email", email, "--kiraci", `Deneme Tekstil ${tag}`], {
    cwd: YANIT_DIR,
    env: {
      HOME: process.env.HOME,
      PATH: `${NODE22_BIN}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
      LANG: process.env.LANG ?? "en_US.UTF-8",
      TMPDIR: process.env.TMPDIR ?? "/tmp",
      YANIT_PASSWORD: password,
    },
  });
  const res = seedResult<{ email: string; userId: string; tenantId: string }>(r.out);
  if (r.code !== 0 || !res) throw new StepFailed(`Yanıt tohumu başarısız (çıkış ${r.code}):\n${r.out.slice(-1500)}`);
  return { ...res, password, expected: parseYanitExpectations(r.out) };
}

/** Read-only query of the local Yanıt database (only for what no endpoint exposes; see the header). */
async function yanitDbJson<T>(sql: string): Promise<T> {
  const r = await run(PSQL, [YANIT_DB_URL, "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    cwd: ROOT,
    env: { HOME: process.env.HOME, PATH: process.env.PATH, PGOPTIONS: "-c default_transaction_read_only=on" },
  });
  if (r.code !== 0) throw new StepFailed(`Yanıt DB okuması başarısız: ${r.out.slice(0, 400)}`);
  return JSON.parse(r.out.trim() || "null") as T;
}

const sqlLiteral = (v: string) => `'${v.replace(/'/g, "''")}'`;

// ---------------------------------------------------------------------------
// altyapi tarafı: bağlantı kaydı, anahtar, worker tetiklemesi, okuma modelleri
// ---------------------------------------------------------------------------

interface Ctx {
  db: Database;
  keys: KeyProvider;
  queue: Queue;
  alt: AltyapiAccount;
  altApi: AltyapiMerchant;
  yan: YanitAccount;
  yanApi: YanitMerchant;
}

const scopeOf = (c: Ctx) => ({ organizationId: c.alt.organizationId, storeId: c.alt.storeId });

async function altyapiLinkRow(c: Ctx, linkId: string) {
  const [row] = await withTenantTx(c.db, scopeOf(c), (tx) => tx.select().from(ekosistemLinks).where(eq(ekosistemLinks.id, linkId)));
  return row ?? null;
}

async function linkKey(c: Ctx, linkId: string): Promise<LinkKey> {
  const row = await altyapiLinkRow(c, linkId);
  if (!row) throw new StepFailed(`altyapi bağlantı kaydı yok (${linkId})`);
  return { id: linkId, secret: await decryptLinkSecret(c.keys, row.storeId, row.id, row.secret) };
}

const YANIT_RESOURCES = ["visibility/summary", "visibility/gaps", "opportunities", "citations"] as const;

/** altyapi'nin kendi mekanizması: zamanlayıcının kiraladığı işle aynı `ekosistem.pull-link` işi. */
async function triggerAltyapiPull(c: Ctx, linkId: string) {
  await enqueueJob(c.queue, { type: PULL_LINK_JOB_TYPE, payload: { linkId }, organizationId: c.alt.organizationId, storeId: c.alt.storeId });
}

async function waitAltyapiPulled(c: Ctx, linkId: string, resources: readonly string[], timeoutMs: number) {
  return waitFor(
    "altyapi worker çekmesi",
    async () => {
      const row = await altyapiLinkRow(c, linkId);
      const cursors = (row?.cursors ?? {}) as Record<string, { pulledAt?: string | null; error?: string | null }>;
      return resources.every((r) => cursors[r]?.pulledAt && !cursors[r]?.error) ? row : null;
    },
    { timeoutMs, intervalMs: 2000 },
  );
}

const iso = (d: Date | string | null | undefined) => (d === null || d === undefined ? null : new Date(d).toISOString());

// ---------------------------------------------------------------------------
// Karşılaştırmalar
// ---------------------------------------------------------------------------

interface WireVariant {
  sku: string | null;
  barcode: string | null;
  price: { amount: string; currency: string } | null;
  taxIncluded: boolean | null;
  taxRateBps: number | null;
  inStock: boolean | null;
}
interface WireProduct {
  ref: string;
  status: string;
  published: boolean;
  handle: string | null;
  url: string | null;
  title: string;
  brand: string | null;
  productType: string | null;
  categories: string[];
  variants: WireVariant[];
}

/** KDV dahil raf fiyatı (kuruş) — §7.2 "taxIncluded'a uyar"; bilinmiyorsa null. */
function grossMinor(v: WireVariant): bigint | null {
  if (!v.price) return null;
  const amount = BigInt(v.price.amount);
  if (v.taxIncluded !== false) return amount;
  if (v.taxRateBps === null) return null;
  const n = amount * BigInt(10_000 + v.taxRateBps);
  return (n + 5_000n) / 10_000n;
}

/** Yanıt'ın katalog kaydı altyapi'nin sunduğu yayındaki ürünle birebir mi (ürün düzeyi model, §7.2 min/maks). */
async function compareCatalog(c: Ctx, connectionId: string, served: WireProduct[], label: string) {
  const published = served.filter((p) => p.published !== false && p.status === "active");
  const http: Array<Record<string, any>> = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i++) {
    const r: HttpResult<{ items: Array<Record<string, any>>; nextCursor: string | null; total: number; connectionStatus: string }> = await c.yanApi.call(
      "GET",
      `/api/integrations/${connectionId}/products?limit=50${cursor ? `&cursor=${cursor}` : ""}`,
    );
    if (r.status !== 200) {
      check(`${label}: Yanıt katalog listesi`, false, `HTTP ${r.status} ${r.text.slice(0, 200)}`);
      return;
    }
    http.push(...r.json.items);
    cursor = r.json.nextCursor;
    if (!cursor) break;
  }
  checkEqual(`${label}: Yanıt'taki ürün kimlikleri = altyapi'nin yayındaki ürünleri`, http.map((p) => p.externalId).sort(), published.map((p) => p.ref).sort());

  const ids = await yanitDbJson<Array<{ externalId: string; identifiers: { sku?: string; barcode?: string; variantCount?: number } | null }>>(
    `select coalesce(json_agg(json_build_object('externalId', "externalId", 'identifiers', identifiers)), '[]') from "CatalogProduct" where "connectionId" = ${sqlLiteral(connectionId)} and "deletedAt" is null`,
  );
  for (const p of published) {
    const y = http.find((x) => x.externalId === p.ref);
    const prices = p.variants.map(grossMinor).filter((x): x is bigint => x !== null);
    const currency = p.variants.find((v) => v.price)?.price?.currency ?? null;
    const toMajor = (minor: bigint | undefined) => (minor === undefined ? null : Number(minor) / 100);
    const expected = {
      title: p.title,
      handle: p.handle,
      url: p.url ? new URL(p.url).toString() : null,
      vendor: p.brand,
      productType: p.productType,
      categories: p.categories,
      status: p.status,
      currency: prices.length ? currency : null,
      price: { min: toMajor(prices.length ? prices.reduce((a, b) => (a < b ? a : b)) : undefined), max: toMajor(prices.length ? prices.reduce((a, b) => (a > b ? a : b)) : undefined) },
      availability: p.variants.some((v) => v.inStock === true) ? "IN_STOCK" : p.variants.length && p.variants.every((v) => v.inStock === false) ? "OUT_OF_STOCK" : "UNKNOWN",
    };
    const actual = y
      ? { title: y.title, handle: y.handle, url: y.url, vendor: y.vendor, productType: y.productType, categories: y.categories, status: y.status, currency: y.currency, price: y.price, availability: y.availability }
      : null;
    checkEqual(`${label}: ${p.title} — başlık/URL/fiyat min-maks/stok/durum`, actual, expected);
    const first = p.variants[0];
    const row = ids.find((x) => x.externalId === p.ref);
    checkEqual(
      `${label}: ${p.title} — barkod/SKU (ilk varyant) ve varyant sayısı`,
      row?.identifiers ?? null,
      { ...(first?.sku ? { sku: first.sku } : {}), ...(first?.barcode ? { barcode: first.barcode } : {}), variantCount: p.variants.length },
    );
  }
}

/** altyapi'nin okuma modelleri (DB) = Yanıt'ın imzalı uçlarının sunduğu değerler. */
async function compareReadModels(c: Ctx, key: LinkKey, label: string) {
  const get = (p: string, query?: Record<string, string | number>) => signed("yanit", { method: "GET", path: p, query, product: "altyapi", link: key });

  // §9.1 — 7 ve 30 gün
  for (const windowDays of [7, 30] as const) {
    const r = await get("/ekosistem/v1/visibility/summary", { windowDays });
    if (!check(`${label}: Yanıt §9.1 ${windowDays} gün 200`, r.status === 200, `HTTP ${r.status} ${r.text.slice(0, 200)}`)) continue;
    const served = r.json as Record<string, any>;
    const [row] = await withTenantTx(c.db, scopeOf(c), (tx) =>
      tx
        .select()
        .from(yanitVisibilitySnapshots)
        .where(and(eq(yanitVisibilitySnapshots.linkId, key.id), eq(yanitVisibilitySnapshots.windowDays, windowDays)))
        .orderBy(desc(yanitVisibilitySnapshots.asOf))
        .limit(1),
    );
    const { asOf: _servedAsOf, ...servedRest } = served;
    const stored = row
      ? {
          windowDays: row.windowDays,
          validRuns: row.validRuns,
          runsWithBrand: row.runsWithBrand,
          visibilityBps: row.visibilityBps,
          shareOfVoiceBps: row.shareOfVoiceBps,
          trend: { previousBps: row.previousBps, deltaBps: row.deltaBps },
          byProvider: (row.payload as Record<string, unknown>).byProvider,
          competitors: (row.payload as Record<string, unknown>).competitors,
          lastMeasuredAt: iso(row.lastMeasuredAt),
        }
      : null;
    checkEqual(`${label}: yanit_visibility_snapshots ${windowDays} gün = Yanıt'ın sunduğu`, stored, { ...servedRest, lastMeasuredAt: iso(served.lastMeasuredAt) });
  }

  // §9.2
  const g = await get("/ekosistem/v1/visibility/gaps");
  if (check(`${label}: Yanıt §9.2 200`, g.status === 200, `HTTP ${g.status}`)) {
    const served = (g.json as { items: Array<Record<string, any>> }).items;
    const rows = await withTenantTx(c.db, scopeOf(c), (tx) => tx.select().from(yanitGaps).where(eq(yanitGaps.linkId, key.id)));
    const view = (x: Record<string, any>) => ({ ref: x.ref, query: x.query, providers: x.providers, competitorsMentioned: x.competitorsMentioned, priority: x.priority, intent: x.intent, lastRunAt: iso(x.lastRunAt) });
    const byRef = (a: { ref: string }, b: { ref: string }) => (a.ref < b.ref ? -1 : 1);
    checkEqual(`${label}: yanit_gaps = Yanıt'ın sunduğu (${served.length} kayıt)`, rows.map(view).sort(byRef), served.map(view).sort(byRef));
  }

  // §9.3 (artımlı; since'siz tam küme)
  const o = await signedAll<Record<string, any>>("yanit", { method: "GET", path: "/ekosistem/v1/opportunities", product: "altyapi", link: key });
  if (check(`${label}: Yanıt §9.3 200`, o.status === 200, `HTTP ${o.status}`)) {
    const rows = await withTenantTx(c.db, scopeOf(c), (tx) => tx.select().from(yanitOpportunities).where(eq(yanitOpportunities.linkId, key.id)));
    const fromRow = (x: (typeof rows)[number]) => ({
      ref: x.ref,
      kind: x.kind,
      sourceKind: x.sourceKind,
      title: x.title,
      body: x.body,
      query: x.query,
      targetUrl: x.targetUrl,
      impact: x.impact,
      status: x.peerStatus,
      createdAt: iso(x.peerCreatedAt),
      updatedAt: iso(x.peerUpdatedAt),
    });
    const fromWire = (x: Record<string, any>) => ({ ...x, ref: String(x.ref), createdAt: iso(x.createdAt), updatedAt: iso(x.updatedAt) });
    const byRef = (a: { ref: string }, b: { ref: string }) => (a.ref < b.ref ? -1 : 1);
    checkEqual(`${label}: yanit_opportunities = Yanıt'ın sunduğu (${o.items.length} kayıt)`, rows.map(fromRow).sort(byRef), o.items.map(fromWire).sort(byRef));
  }

  // §9.4
  const ci = await get("/ekosistem/v1/citations", { windowDays: 30 });
  if (check(`${label}: Yanıt §9.4 200`, ci.status === 200, `HTTP ${ci.status}`)) {
    const served = (ci.json as { items: Array<Record<string, any>> }).items;
    const rows = await withTenantTx(c.db, scopeOf(c), (tx) => tx.select().from(yanitCitations).where(and(eq(yanitCitations.linkId, key.id), eq(yanitCitations.windowDays, 30))));
    const view = (x: Record<string, any>) => ({ domain: x.domain, count: x.count, shareBps: x.shareBps, sampleUrls: x.sampleUrls });
    const byDomain = (a: { domain: string }, b: { domain: string }) => (a.domain < b.domain ? -1 : 1);
    checkEqual(`${label}: yanit_citations 30 gün = Yanıt'ın sunduğu (${served.length} alan adı)`, rows.map(view).sort(byDomain), served.map(view).sort(byDomain));
  }
}

/** Yanıt'ın sunduğu §9 değerleri fixture tanımının (tohumun yazdığı "beklenen" satırlar) söylediği gibi mi. */
async function compareWithFixture(c: Ctx, key: LinkKey) {
  const exp = c.yan.expected;
  const get = (p: string, query?: Record<string, string | number>) => signed<Record<string, any>>("yanit", { method: "GET", path: p, query, product: "altyapi", link: key });
  const s7 = (await get("/ekosistem/v1/visibility/summary", { windowDays: 7 })).json;
  const s30 = (await get("/ekosistem/v1/visibility/summary", { windowDays: 30 })).json;
  const pick = (s: Record<string, any> | null) => (s ? { validRuns: s.validRuns, runsWithBrand: s.runsWithBrand, visibilityBps: s.visibilityBps } : null);
  checkEqual("fixture: §9.1 7 gün sayımları", pick(s7), exp.summary7);
  checkEqual("fixture: §9.1 7 gün eğilim (önceki pencere)", s7?.trend ?? null, {
    previousBps: exp.previous7.visibilityBps,
    deltaBps: exp.summary7.visibilityBps !== null && exp.previous7.visibilityBps !== null ? exp.summary7.visibilityBps - exp.previous7.visibilityBps : null,
  });
  checkEqual("fixture: §9.1 30 gün sayımları", pick(s30), exp.summary30);
  checkEqual(
    "fixture: §9.1 rakipler (takma adlar birleşik)",
    Object.fromEntries(((s7?.competitors ?? []) as Array<{ name: string; runsMentioned: number }>).map((x) => [x.name, x.runsMentioned])),
    exp.competitors7,
  );
  const gaps = (await get("/ekosistem/v1/visibility/gaps")).json;
  checkEqual("fixture: §9.2 boşluk sorguları", ((gaps?.items ?? []) as Array<{ query: string }>).map((g) => g.query).sort(), [...exp.gapQueries].sort());
  const opps = await signedAll<{ ref: string }>("yanit", { method: "GET", path: "/ekosistem/v1/opportunities", product: "altyapi", link: key });
  check("fixture: §9.3 fırsat sayısı (MANUAL paylaşılmaz)", opps.items.length === exp.opportunities, `${opps.items.length} ≠ ${exp.opportunities}`);
  const cit = (await get("/ekosistem/v1/citations", { windowDays: 30 })).json;
  const byDomain = (a: { domain: string }, b: { domain: string }) => (a.domain < b.domain ? -1 : 1);
  checkEqual(
    "fixture: §9.4 alan adı / sayı / pay",
    ((cit?.items ?? []) as Array<{ domain: string; count: number; shareBps: number | null }>).map((x) => ({ domain: x.domain, count: x.count, shareBps: x.shareBps })).sort(byDomain),
    [...exp.citations].sort(byDomain),
  );
}

// ---------------------------------------------------------------------------
// Senaryolar
// ---------------------------------------------------------------------------

const ALTYAPI_TO_YANIT = ["brand:read", "catalog:read", "content:read"];
const YANIT_TO_ALTYAPI = ["visibility:read", "opportunities:read", "citations:read", "discovery:read"];
const sorted = (xs: readonly string[]) => [...xs].sort();

async function yanitLink(c: Ctx, id: string) {
  const r = await c.yanApi.call<Record<string, any>>("GET", `/api/ecosystem/links/${id}`);
  return r.status === 200 ? r.json : null;
}

/** Triggers Yanıt's own catalog sync for the link's connection and waits until it finished. */
async function syncYanitCatalog(c: Ctx, linkId: string, label: string): Promise<string | null> {
  const withCatalog = await waitFor("Yanıt katalog bağlantısı", async () => (await yanitLink(c, linkId))?.catalog, { timeoutMs: 30_000 });
  if (!check(`${label}: Yanıt katalog bağlantısını kurdu`, !!withCatalog, "link.catalog boş")) return null;
  const connectionId = (withCatalog as { connectionId: string }).connectionId;
  const trig = await c.yanApi.call("POST", `/api/integrations/${connectionId}/sync`);
  check(`${label}: Yanıt katalog eşitleme tetikleyicisi 202`, trig.status === 202, `HTTP ${trig.status} ${trig.text.slice(0, 200)}`);
  const done = await waitFor(
    "Yanıt katalog senkronu",
    async () => {
      const r = await c.yanApi.call<{ syncs: Array<{ status: string; errorCode: string | null }> }>("GET", `/api/integrations/${connectionId}/syncs`);
      const latest = r.json?.syncs?.[0];
      if (latest && latest.status === "SUCCESS" && !r.json.syncs.some((s) => s.status === "PENDING" || s.status === "RUNNING")) return latest;
      if (latest && latest.status === "ERROR") return latest;
      return null;
    },
    { timeoutMs: 90_000, intervalMs: 2000 },
  );
  check(`${label}: Yanıt katalog senkronu bitti (SUCCESS)`, done?.status === "SUCCESS", done ? `${done.status} ${done.errorCode ?? ""}` : "zaman aşımı");
  return connectionId;
}

async function servedCatalog(key: LinkKey): Promise<WireProduct[] | null> {
  const r = await signedAll<WireProduct>("altyapi", { method: "GET", path: "/ekosistem/v1/catalog/products", product: "yanit", link: key });
  return r.status === 200 ? r.items : null;
}

async function yanitCatalogRefs(c: Ctx, connectionId: string): Promise<string[] | null> {
  const r = await c.yanApi.call<{ items: Array<{ externalId: string }> }>("GET", `/api/integrations/${connectionId}/products?limit=50`);
  return r.status === 200 ? r.json.items.map((p) => p.externalId) : null;
}

/**
 * §10: a catalog change in altyapi reaches Yanıt through altyapi's own push (worker → POST /events) and Yanıt's
 * targeted refresh — no sync is triggered here. A product is taken out of the storefront and put back.
 */
async function pushPropagation(c: Ctx, key: LinkKey, connectionId: string, served: WireProduct[]) {
  const target = served[served.length - 1];
  if (!check("dürtme: yayından kaldırılacak ürün var", !!target)) return;
  const setStatus = (status: "archived" | "active") => c.altApi.call("POST", `${c.altApi.base}/products/bulk-status`, { productIds: [target!.ref], status });
  const off = await setStatus("archived");
  check(`dürtme: altyapi'de ${target!.title} arşivlendi`, off.status === 200, `HTTP ${off.status} ${off.text.slice(0, 200)}`);
  const gone = await waitFor("Yanıt'tan düşmesi", async () => {
    const refs = await yanitCatalogRefs(c, connectionId);
    return refs && !refs.includes(target!.ref) ? refs : null;
  }, { timeoutMs: 90_000, intervalMs: 2500 });
  check("dürtme: yayından kalkan ürün Yanıt kataloğundan düştü (altyapi push → Yanıt hedefli yenileme)", !!gone);
  const on = await setStatus("active");
  check(`dürtme: altyapi'de ${target!.title} yeniden yayında`, on.status === 200, `HTTP ${on.status} ${on.text.slice(0, 200)}`);
  const back = await waitFor("Yanıt'a dönmesi", async () => {
    const refs = await yanitCatalogRefs(c, connectionId);
    return refs && refs.includes(target!.ref) ? refs : null;
  }, { timeoutMs: 90_000, intervalMs: 2500 });
  check("dürtme: yeniden yayınlanan ürün Yanıt kataloğuna döndü", !!back);
  const again = await servedCatalog(key);
  if (back && again) await compareCatalog(c, connectionId, again, "A katalog (dürtme sonrası)");
}

async function scenarioA(c: Ctx) {
  scenario = "A";
  console.log("\n▶ A — altyapi kod üretir, Yanıt kabul eder");
  const eko = `${c.altApi.base}/ekosistem`;

  const code = await c.altApi.call<{ code: string; grants: string[] }>("POST", `${eko}/codes`, { peerProduct: "yanit", grants: ALTYAPI_TO_YANIT });
  must("altyapi kod üretti (201, ek1_a_)", code.status === 201 && /^ek1_a_[0-9A-Z]{26}$/.test(code.json.code), `HTTP ${code.status} ${code.text.slice(0, 200)}`);
  checkEqual("altyapi kodunun kapsamları", sorted(code.json.grants), sorted(ALTYAPI_TO_YANIT));

  const acc = await c.yanApi.call<{ link: Record<string, any> }>("POST", "/api/ecosystem/accept", { code: code.json.code });
  must("Yanıt kodu kabul etti (201)", acc.status === 201 && acc.json?.link?.id, `HTTP ${acc.status} ${acc.text.slice(0, 300)}`);
  const linkId: string = acc.json.link.id;
  checkEqual("Yanıt: bağlantı pending, rol acceptor", { status: acc.json.link.status, role: acc.json.link.role }, { status: "pending", role: "acceptor" });
  checkEqual("Yanıt: eşin doğrulanmış kimliği = altyapi mağazası", acc.json.link.peerAccount?.id, c.alt.storeId);
  checkEqual("Yanıt: altyapi'nin verdiği kapsamlar", sorted(acc.json.link.peerScopes), sorted(ALTYAPI_TO_YANIT));

  const alt0 = (await c.altApi.call<{ items: Array<Record<string, any>> }>("GET", `${eko}/links`)).json.items.find((l) => l.id === linkId);
  checkEqual("altyapi: bağlantı pending, rol issuer", alt0 ? { status: alt0.status, role: alt0.role } : null, { status: "pending", role: "issuer" });
  const key = await linkKey(c, linkId);

  // C: bekleyen bağlantıda veri uçları 409 (iki yön), pending aşaması
  scenario = "C";
  expectError("pending: altyapi veri ucu (catalog/products) 409 link_pending", await signed("altyapi", { method: "GET", path: "/ekosistem/v1/catalog/products", product: "yanit", link: key }), 409, "link_pending");
  expectError("pending: Yanıt veri ucu (visibility/summary) 409 link_pending", await signed("yanit", { method: "GET", path: "/ekosistem/v1/visibility/summary", query: { windowDays: 7 }, product: "altyapi", link: key }), 409, "link_pending");
  scenario = "A";

  const conf = await c.yanApi.call<Record<string, any>>("POST", `/api/ecosystem/links/${linkId}/confirm`, { grants: YANIT_TO_ALTYAPI });
  must("Yanıt onayı (confirm) 200", conf.status === 200, `HTTP ${conf.status} ${conf.text.slice(0, 300)}`);
  checkEqual("Yanıt: awaiting_approval, verdiği kapsamlar", { status: conf.json.status, granted: sorted(conf.json.grantedScopes) }, { status: "awaiting_approval", granted: sorted(YANIT_TO_ALTYAPI) });
  const alt1 = await altyapiLinkRow(c, linkId);
  checkEqual(
    "altyapi: eş kanıtından sonra awaiting_approval + Yanıt'ın kapsamları + Yanıt kiracısı",
    alt1 ? { status: alt1.status, peerScopes: sorted(alt1.peerScopes), account: (alt1.peerAccount as { id?: string }).id } : null,
    { status: "awaiting_approval", peerScopes: sorted(YANIT_TO_ALTYAPI), account: c.yan.tenantId },
  );

  scenario = "C";
  expectError("awaiting_approval: altyapi veri ucu 409 link_pending", await signed("altyapi", { method: "GET", path: "/ekosistem/v1/catalog/products", product: "yanit", link: key }), 409, "link_pending");
  expectError("awaiting_approval: Yanıt veri ucu 409 link_pending", await signed("yanit", { method: "GET", path: "/ekosistem/v1/visibility/gaps", product: "altyapi", link: key }), 409, "link_pending");
  scenario = "A";

  const appr = await c.altApi.call<{ link: Record<string, any> }>("POST", `${eko}/links/${linkId}/approve`);
  must("altyapi onayladı → active", appr.status === 200 && appr.json.link.status === "active", `HTTP ${appr.status} ${appr.text.slice(0, 200)}`);
  const activeY = await waitFor(
    "Yanıt active",
    async () => {
      const r = await c.yanApi.call<Record<string, any>>("POST", `/api/ecosystem/links/${linkId}/refresh`);
      return r.json?.status === "active" ? r.json : null;
    },
    { timeoutMs: 30_000, intervalMs: 3500 },
  );
  must("Yanıt: durum yoklaması sonrası active", activeY);

  // Yanıt altyapi kataloğunu çeker
  const served = await servedCatalog(key);
  must("altyapi'nin sunduğu katalog (imzalı, yanit olarak) 200", served);
  const connectionId = await syncYanitCatalog(c, linkId, "A");
  if (connectionId && served) {
    await compareCatalog(c, connectionId, served, "A katalog");
    await pushPropagation(c, key, connectionId, served);
  }

  // altyapi worker'ı Yanıt §9.1–9.4'ü çeker
  await triggerAltyapiPull(c, linkId);
  const pulled = await waitAltyapiPulled(c, linkId, YANIT_RESOURCES, 150_000);
  check("altyapi worker §9.1–9.4 çekti (dört kaynak pulledAt, hata yok)", !!pulled, JSON.stringify((await altyapiLinkRow(c, linkId))?.cursors ?? {}).slice(0, 600));
  if (pulled) {
    // §6.4: Yanıt verisi günde bir değişir, uçlar max-age gönderir; tüketici en fazla saatte bir (ya da max-age) çeker.
    const cursors = pulled.cursors as Record<string, { pulledAt: string; maxAgeSeconds?: number | null }>;
    const dues: number[] = [];
    for (const [resource, query] of [
      ["visibility/summary", { windowDays: 30 }],
      ["visibility/gaps", undefined],
      ["citations", { windowDays: 30 }],
      ["opportunities", undefined],
    ] as const) {
      const r = await signed("yanit", { method: "GET", path: `/ekosistem/v1/${resource}`, query, product: "altyapi", link: key });
      const m = /max-age=(\d+)/.exec(r.headers.get("cache-control") ?? "");
      const maxAge = m ? Number(m[1]) : null;
      if (resource !== "opportunities") checkEqual(`altyapi ${resource}: Yanıt'ın max-age'i saklandı`, cursors[resource]?.maxAgeSeconds ?? null, maxAge);
      dues.push(Date.parse(cursors[resource]!.pulledAt) + Math.max(PULL_MIN_INTERVAL_MS, (cursors[resource]?.maxAgeSeconds ?? 0) * 1000));
    }
    // runLinkPull sets nextPullAt after its last resource: wait for that write, not for the cursors.
    const firstDue = Math.min(...dues);
    const scheduled = await waitFor("altyapi nextPullAt", async () => {
      const row = await altyapiLinkRow(c, linkId);
      return row?.nextPullAt && row.nextPullAt.getTime() >= firstDue - 1000 ? row : null;
    }, { timeoutMs: 20_000 });
    check("altyapi: sonraki çekme en erken kaynakların saatlik/max-age vadesinde", !!scheduled, `nextPullAt ${iso((await altyapiLinkRow(c, linkId))?.nextPullAt)} · en erken vade ${new Date(firstDue).toISOString()}`);
    await compareReadModels(c, key, "A");
    await compareWithFixture(c, key);
    const ov = await c.altApi.call<Record<string, any>>("GET", `${eko}/yanit/overview`);
    const latest7 = ov.json?.visibility?.find((v: { windowDays: number }) => v.windowDays === 7)?.latest;
    const s7 = (await signed<Record<string, any>>("yanit", { method: "GET", path: "/ekosistem/v1/visibility/summary", query: { windowDays: 7 }, product: "altyapi", link: key })).json;
    checkEqual("altyapi tacir görünümü (yanit/overview) 7 gün = Yanıt'ın sunduğu", latest7 ? { linked: ov.json.linked, visibilityBps: latest7.visibilityBps, validRuns: latest7.validRuns } : null, { linked: true, visibilityBps: s7?.visibilityBps, validRuns: s7?.validRuns });
  }

  // Yanıt fırsatından taslak (yayınlanmaz)
  const opps = await c.altApi.call<{ items: Array<{ ref: string; kind: string; title: string }> }>("GET", `${eko}/yanit/opportunities?status=new&limit=100`);
  const opp = opps.json?.items?.find((o) => o.kind === "faq") ?? opps.json?.items?.[0];
  if (check("altyapi: taslaklanabilir Yanıt fırsatı var", !!opp, `HTTP ${opps.status} ${opps.text.slice(0, 200)}`) && opp) {
    const d1 = await c.altApi.call<{ created: boolean; page: { id: string; status: string; type: string } }>("POST", `${eko}/yanit/opportunities/${encodeURIComponent(opp.ref)}/draft`);
    check("fırsattan taslak: 201 created", d1.status === 201 && d1.json.created === true, `HTTP ${d1.status} ${d1.text.slice(0, 300)}`);
    if (d1.status === 201) {
      const [page] = await withTenantTx(c.db, scopeOf(c), (tx) => tx.select().from(pages).where(and(eq(pages.id, d1.json.page.id), eq(pages.storeId, c.alt.storeId))));
      checkEqual("taslak sayfa oluştu, yayınlanmadı", page ? { status: page.status, publishedRevision: page.publishedRevision, publishAt: page.publishAt } : null, { status: "draft", publishedRevision: null, publishAt: null });
      const d2 = await c.altApi.call<{ created: boolean; page: { id: string } }>("POST", `${eko}/yanit/opportunities/${encodeURIComponent(opp.ref)}/draft`);
      checkEqual("aynı fırsat yeniden: 200, aynı taslak", { status: d2.status, created: d2.json?.created, page: d2.json?.page?.id }, { status: 200, created: false, page: d1.json.page.id });
      const drafted = await c.altApi.call<{ items: Array<{ ref: string; draftPageId: string | null }> }>("GET", `${eko}/yanit/opportunities?status=drafted&limit=100`);
      checkEqual("fırsat 'drafted', taslak sayfaya bağlı", drafted.json?.items?.find((o) => o.ref === opp.ref)?.draftPageId ?? null, d1.json.page.id);
    }
  }

  // C: yanlış Ekosistem-Product ve nonce tekrarı (etkin bağlantıda)
  scenario = "C";
  expectError(
    "yanlış Ekosistem-Product (karmatik) → Yanıt 401 signature_invalid",
    await signed("yanit", { method: "GET", path: "/ekosistem/v1/visibility/summary", query: { windowDays: 7 }, product: "karmatik", link: key }),
    401,
    "signature_invalid",
  );
  expectError("yanlış Ekosistem-Product (karmatik) → altyapi 401 signature_invalid", await signed("altyapi", { method: "GET", path: "/ekosistem/v1/brand", product: "karmatik", link: key }), 401, "signature_invalid");
  const control = await signed("altyapi", { method: "GET", path: "/ekosistem/v1/brand", product: "yanit", link: key });
  check("kontrol: aynı istek doğru ürünle altyapi 200", control.status === 200, `HTTP ${control.status}`);
  const productRef = served?.[0]?.ref;
  const event = { id: randomUUID(), type: "altyapi.product.updated", occurredAt: new Date().toISOString(), data: { ref: productRef ?? randomUUID() } };
  const nonceY = generateRequestNonce();
  const e1 = await signed("yanit", { method: "POST", path: "/ekosistem/v1/events", body: event, product: "altyapi", link: key, nonce: nonceY });
  check("dürtme (altyapi → Yanıt) 202", e1.status === 202, `HTTP ${e1.status} ${e1.text.slice(0, 200)}`);
  expectError("aynı nonce ile tekrar → Yanıt 401 replay", await signed("yanit", { method: "POST", path: "/ekosistem/v1/events", body: event, product: "altyapi", link: key, nonce: nonceY }), 401, "replay");
  const nonceA = generateRequestNonce();
  const unknownEvent = { id: randomUUID(), type: "yanit.deneme.bilinmeyen", occurredAt: new Date().toISOString(), data: {} };
  const e2 = await signed("altyapi", { method: "POST", path: "/ekosistem/v1/events", body: unknownEvent, product: "yanit", link: key, nonce: nonceA });
  check("bilinmeyen dürtme türü (Yanıt → altyapi) 202", e2.status === 202, `HTTP ${e2.status} ${e2.text.slice(0, 200)}`);
  expectError("aynı nonce ile tekrar → altyapi 401 replay", await signed("altyapi", { method: "POST", path: "/ekosistem/v1/events", body: unknownEvent, product: "yanit", link: key, nonce: nonceA }), 401, "replay");
  scenario = "A";

  // Yanıt tarafından kaldırma → altyapi revoked (Yanıt'ın DELETE teslimi), katalog kesilir
  const del = await c.yanApi.call<Record<string, any>>("DELETE", `/api/ecosystem/links/${linkId}`);
  check("Yanıt kaldırdı → revoked", del.status === 200 && del.json?.status === "revoked", `HTTP ${del.status} ${del.text.slice(0, 200)}`);
  const altRevoked = await waitFor("altyapi revoked", async () => {
    const row = await altyapiLinkRow(c, linkId);
    return row?.status === "revoked" ? row : null;
  }, { timeoutMs: 30_000 });
  checkEqual("altyapi: Yanıt'ın DELETE'iyle revoked (neden: peer_deleted)", altRevoked ? { status: altRevoked.status, reason: altRevoked.revokeReason } : null, { status: "revoked", reason: "peer_deleted" });
  const yl = await waitFor("Yanıt DELETE teslimi", async () => {
    const l = await yanitLink(c, linkId);
    return l?.peerDelete?.state === "done" ? l : null;
  }, { timeoutMs: 30_000 });
  check("Yanıt: eşe DELETE teslim edildi", !!yl, JSON.stringify((await yanitLink(c, linkId))?.peerDelete ?? null));
  const cut = (await yanitLink(c, linkId))?.catalog;
  checkEqual("Yanıt: altyapi kataloğunun bağlantısı kesildi", cut ? { status: cut.status, productCount: cut.productCount } : null, { status: "DISCONNECTED", productCount: 0 });
  expectError("kaldırılmış bağlantı: Yanıt veri ucu 401 link_invalid", await signed("yanit", { method: "GET", path: "/ekosistem/v1/citations", query: { windowDays: 30 }, product: "altyapi", link: key }), 401, "link_invalid");
  expectError("kaldırılmış bağlantı: altyapi veri ucu 401 link_invalid", await signed("altyapi", { method: "GET", path: "/ekosistem/v1/catalog/products", product: "yanit", link: key }), 401, "link_invalid");
  const ov = await c.altApi.call<Record<string, any>>("GET", `${eko}/yanit/overview`);
  check("altyapi tacir görünümü: Yanıt bağlı değil", ov.status === 200 && ov.json.linked === false, `HTTP ${ov.status} linked=${ov.json?.linked}`);
}

async function scenarioB(c: Ctx) {
  scenario = "B";
  console.log("\n▶ B — Yanıt kod üretir, altyapi kabul eder");
  const eko = `${c.altApi.base}/ekosistem`;

  const code = await c.yanApi.call<{ code: string; grantedScopes: string[] }>("POST", "/api/ecosystem/codes", { peer: "altyapi", grants: YANIT_TO_ALTYAPI });
  must("Yanıt kod üretti (201, ek1_y_)", code.status === 201 && /^ek1_y_[0-9A-Z]{26}$/.test(code.json.code), `HTTP ${code.status} ${code.text.slice(0, 200)}`);
  checkEqual("Yanıt kodunun kapsamları", sorted(code.json.grantedScopes), sorted(YANIT_TO_ALTYAPI));

  const acc = await c.altApi.call<Record<string, any>>("POST", `${eko}/links/accept`, { code: code.json.code, grants: ALTYAPI_TO_YANIT });
  must("altyapi kodu kabul etti (201)", acc.status === 201 && acc.json?.link?.id, `HTTP ${acc.status} ${acc.text.slice(0, 300)}`);
  const linkId: string = acc.json.link.id;
  checkEqual(
    "altyapi: pending, acceptor, eş = Yanıt kiracısı, iki yöndeki kapsamlar",
    { status: acc.json.link.status, role: acc.json.link.role, peer: acc.json.peer?.account?.id, toPeer: sorted(acc.json.grants.toPeer), fromPeer: sorted(acc.json.grants.fromPeer) },
    { status: "pending", role: "acceptor", peer: c.yan.tenantId, toPeer: sorted(ALTYAPI_TO_YANIT), fromPeer: sorted(YANIT_TO_ALTYAPI) },
  );
  const key = await linkKey(c, linkId);

  const conf = await c.altApi.call<{ link: Record<string, any> }>("POST", `${eko}/links/${linkId}/confirm`, {});
  must("altyapi onayı (confirm) → altyapi'de active", conf.status === 200 && conf.json.link.status === "active", `HTTP ${conf.status} ${conf.text.slice(0, 300)}`);
  const yWait = await yanitLink(c, linkId);
  checkEqual("Yanıt: awaiting_approval, rol issuer, eş = altyapi mağazası", yWait ? { status: yWait.status, role: yWait.role, peer: yWait.peerAccount?.id } : null, { status: "awaiting_approval", role: "issuer", peer: c.alt.storeId });

  scenario = "C";
  expectError("issuer onayı bekliyor: Yanıt veri ucu 409 link_pending", await signed("yanit", { method: "GET", path: "/ekosistem/v1/opportunities", product: "altyapi", link: key }), 409, "link_pending");
  scenario = "B";

  const appr = await c.yanApi.call<Record<string, any>>("POST", `/api/ecosystem/links/${linkId}/approve`);
  must("Yanıt onayladı → active", appr.status === 200 && appr.json?.status === "active", `HTTP ${appr.status} ${appr.text.slice(0, 200)}`);
  const altActive = await altyapiLinkRow(c, linkId);
  check("altyapi: active", altActive?.status === "active", `durum ${altActive?.status}`);

  // Veri çekmesi: Yanıt kataloğu (yeniden bağlanan katalog, tam senkron) ve altyapi worker'ı (§9.1)
  const served = await servedCatalog(key);
  must("altyapi'nin sunduğu katalog (B bağlantısı) 200", served);
  const connectionId = await syncYanitCatalog(c, linkId, "B");
  if (connectionId && served) await compareCatalog(c, connectionId, served, "B katalog");
  await triggerAltyapiPull(c, linkId);
  const pulled = await waitAltyapiPulled(c, linkId, ["visibility/summary"], 150_000);
  if (check("altyapi worker B bağlantısından §9.1 çekti", !!pulled, JSON.stringify((await altyapiLinkRow(c, linkId))?.cursors ?? {}).slice(0, 600))) {
    const r = await signed<Record<string, any>>("yanit", { method: "GET", path: "/ekosistem/v1/visibility/summary", query: { windowDays: 30 }, product: "altyapi", link: key });
    const [row] = await withTenantTx(c.db, scopeOf(c), (tx) =>
      tx.select().from(yanitVisibilitySnapshots).where(and(eq(yanitVisibilitySnapshots.linkId, linkId), eq(yanitVisibilitySnapshots.windowDays, 30))).orderBy(desc(yanitVisibilitySnapshots.asOf)).limit(1),
    );
    checkEqual("B: yanit_visibility_snapshots 30 gün = Yanıt'ın sunduğu", row ? { validRuns: row.validRuns, runsWithBrand: row.runsWithBrand, visibilityBps: row.visibilityBps } : null, { validRuns: r.json?.validRuns, runsWithBrand: r.json?.runsWithBrand, visibilityBps: r.json?.visibilityBps });
  }

  // altyapi'den kaldırma → worker DELETE'i Yanıt'a teslim eder
  const del = await c.altApi.call<{ link: Record<string, any> }>("DELETE", `${eko}/links/${linkId}`);
  check("altyapi kaldırdı → revoked (yerelde hemen)", del.status === 200 && del.json.link.status === "revoked", `HTTP ${del.status} ${del.text.slice(0, 200)}`);
  const yRevoked = await waitFor("Yanıt revoked (worker DELETE teslimi)", async () => {
    const l = await yanitLink(c, linkId);
    return l?.status === "revoked" ? l : null;
  }, { timeoutMs: 90_000, intervalMs: 2500 });
  checkEqual("Yanıt: altyapi'nin DELETE'iyle revoked (neden: peer)", yRevoked ? { status: yRevoked.status, reason: yRevoked.revokeReason } : null, { status: "revoked", reason: "peer" });
  const delivered = await altyapiLinkRow(c, linkId);
  check("altyapi: DELETE teslimi kaydedildi", !!delivered?.revokeDelivery?.deliveredAt, JSON.stringify(delivered?.revokeDelivery ?? null));
  expectError("kaldırılmış bağlantıya imzalı istek → Yanıt 401 link_invalid", await signed("yanit", { method: "GET", path: "/ekosistem/v1/visibility/summary", query: { windowDays: 7 }, product: "altyapi", link: key }), 401, "link_invalid");
  expectError("kaldırılmış bağlantıya imzalı istek → altyapi 401 link_invalid", await signed("altyapi", { method: "GET", path: "/ekosistem/v1/brand", product: "yanit", link: key }), 401, "link_invalid");
  const after = await yanitLink(c, linkId);
  checkEqual("Yanıt: altyapi'den çekilen kataloğun bağlantısı kesildi", after?.catalog ? { status: after.catalog.status, productCount: after.catalog.productCount } : null, { status: "DISCONNECTED", productCount: 0 });
  if (connectionId) {
    const list = await c.yanApi.call<{ total: number; connectionStatus: string }>("GET", `/api/integrations/${connectionId}/products`);
    checkEqual("Yanıt katalog listesi boş, bağlantı DISCONNECTED", { status: list.status, total: list.json?.total, connection: list.json?.connectionStatus }, { status: 200, total: 0, connection: "DISCONNECTED" });
  }
}

/** Removes every link still open on either test account (both sides, so neither keeps serving). */
async function revokeOpenLinks(c: Ctx): Promise<string[]> {
  const removed: string[] = [];
  const y = await c.yanApi.call<{ links: Array<{ id: string; status: string }> }>("GET", "/api/ecosystem");
  for (const l of y.json?.links?.filter((x) => x.status !== "revoked" && x.status !== "expired") ?? []) {
    await c.yanApi.call("DELETE", `/api/ecosystem/links/${l.id}`);
    removed.push(`yanit:${l.id}:${l.status}`);
  }
  const a = await c.altApi.call<{ items: Array<{ id: string; status: string }> }>("GET", `${c.altApi.base}/ekosistem/links`);
  for (const l of a.json?.items?.filter((x) => x.status !== "revoked" && x.status !== "expired") ?? []) {
    await c.altApi.call("DELETE", `${c.altApi.base}/ekosistem/links/${l.id}`);
    removed.push(`altyapi:${l.id}:${l.status}`);
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Ana akış
// ---------------------------------------------------------------------------

async function healthy(url: string) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function main() {
  const started = Date.now();
  console.log("E2E altyapi ↔ Yanıt (yerel)");
  for (const [label, url] of [
    ["altyapi API", `${ALTYAPI_BASE}/readyz`],
    ["altyapi worker", WORKER_HEALTH],
    ["Yanıt", `${YANIT_BASE}/api/health`],
  ] as const) {
    if (!(await healthy(url))) abort(`${label} ayakta değil (${url}). Önce: tools/ekosistem/yerel.sh up altyapi-api altyapi-worker yanit`);
  }

  const keys = createKeyProvider(env);
  if (!keys) abort("LOCAL_MASTER_KEY yok; bağlantı anahtarı çözülemez.");
  const database = createDatabase({ url: env.DATABASE_URL, max: 3, ssl: false, applicationName: "altyapi-e2e-yanit" });
  const queue = createQueue(env, database.db);
  const tag = `e1-${Date.now().toString(36)}`;
  let exitCode = 0;
  let c: Ctx | null = null;
  // Kept apart from `c`: a Yanıt tenant that was seeded must be deleted even when the rest of the set-up failed.
  let yanitAccount: { yan: YanitAccount; api: YanitMerchant } | null = null;
  try {
    console.log(`\n▶ Hazırlık — hermetik test hesapları (${tag})`);
    const [altR, yanR] = await Promise.allSettled([seedAltyapi(tag), seedYanit(tag)]);
    if (yanR.status === "fulfilled") {
      const api = new YanitMerchant();
      await api.login(yanR.value.email, yanR.value.password);
      yanitAccount = { yan: yanR.value, api };
    }
    const failure = [altR, yanR].find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failure) throw failure.reason;
    const alt = (altR as PromiseFulfilledResult<AltyapiAccount>).value;
    const yan = yanitAccount!.yan;
    check(`altyapi test hesabı + fixture (${alt.storeSlug})`, true);
    check(`Yanıt test kiracısı + fixture (${yan.tenantId})`, true);
    const altApi = new AltyapiMerchant(alt.organizationId, alt.storeId);
    await altApi.login(alt.email, alt.password);
    c = { db: database.db, keys, queue, alt, altApi, yan, yanApi: yanitAccount!.api };
    for (const [name, fn] of [
      ["A", scenarioA],
      ["B", scenarioB],
    ] as const) {
      try {
        await fn(c);
      } catch (err) {
        if (!(err instanceof StepFailed)) {
          check(`${name}: beklenmeyen hata`, false, err instanceof Error ? (err.stack ?? err.message) : String(err));
        } else console.log(`    ${name} yarıda kaldı: ${err.message}`);
      }
      // A scenario that stopped half-way must not leave a live link behind (the next one needs the slot).
      const leftover = await revokeOpenLinks(c);
      if (leftover.length) check(`${name}: senaryo sonunda açık bağlantı kalmadı`, false, `kaldırıldı: ${leftover.join(", ")}`);
    }
  } catch (err) {
    check("hazırlık", false, err instanceof Error ? err.message : String(err));
  } finally {
    scenario = "temizlik";
    if (c || yanitAccount) console.log("\n▶ Temizlik");
    if (c) {
      const open = await revokeOpenLinks(c);
      check("test hesaplarında açık bağlantı kalmadı", open.length === 0, `kaldırıldı: ${open.join(", ")}`);
      console.log(`  – altyapi test hesabı ${c.alt.email} / mağaza ${c.alt.storeSlug} yerel DB'de kalır (silme ucu yok).`);
    }
    if (yanitAccount) {
      if (process.env.E2E_KORU === "1") {
        console.log(`  – E2E_KORU=1: Yanıt test kiracısı bırakıldı (${yanitAccount.yan.email})`);
      } else {
        // Account deletion first removes every link of the tenant at its peers (revokeAllForTenant).
        const d = await yanitAccount.api.call("POST", "/api/account/delete", { confirm: "HESABIMI SİL" });
        check("Yanıt test kiracısı silindi (hesap silme ucu)", d.status === 200, `HTTP ${d.status} ${d.text.slice(0, 200)}`);
        const me = await yanitAccount.api.call("GET", "/api/auth/me");
        check("silinen hesabın oturumu geçersiz", me.status === 401, `HTTP ${me.status}`);
      }
    }
    await database.close();
  }

  const failed = results.filter((r) => !r.ok);
  const byScenario = new Map<string, { ok: number; total: number }>();
  for (const r of results) {
    const s = byScenario.get(r.scenario) ?? { ok: 0, total: 0 };
    s.total += 1;
    if (r.ok) s.ok += 1;
    byScenario.set(r.scenario, s);
  }
  console.log(`\nSonuç (${Math.round((Date.now() - started) / 1000)} sn):`);
  for (const [s, v] of byScenario) console.log(`  ${s}: ${v.ok}/${v.total}`);
  if (failed.length) {
    console.log("\nKalanlar:");
    for (const f of failed) console.log(`  ✗ [${f.scenario}] ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    exitCode = 1;
  }
  console.log(`E2E_OZET ${JSON.stringify(Object.fromEntries(byScenario))}`);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
