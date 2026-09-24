import type { Redis } from "ioredis";
import type { z } from "zod";
import type { Logger } from "@altyapi/observability";
import {
  CIRCUIT_FAILURE_THRESHOLD,
  CIRCUIT_OPEN_MS,
  MAX_REQUEST_BODY_BYTES,
  MAX_RESPONSE_BODY_BYTES,
  PEER_TIMEOUT_MS,
  PROFIT_QUOTE_PATH,
  PROFIT_QUOTE_TIMEOUT_MS,
  SELF_PRODUCT,
  type PeerProduct,
  type SignedMethod,
} from "./constants";
import { EkosistemPeerError, isEkosistemErrorCode, type EkosistemErrorCode } from "./errors";
import type { PeerBases } from "./peers";
import {
  claimResponseSchema,
  errorEnvelopeSchema,
  incrementalPageSchema,
  karmatikAlertSchema,
  karmatikCompetitorPriceSchema,
  karmatikMarketBrandSchema,
  karmatikMarketKeywordSchema,
  karmatikProfitSummarySchema,
  karmatikProfitVariantSchema,
  karmatikSuggestionSchema,
  linkStatusResponseSchema,
  profitQuoteRequestSchema,
  profitQuoteResponseSchema,
  rotateResponseSchema,
  snapshotEnvelopeSchema,
  splitItems,
  suggestionDecisionSchema,
  yanitCitationSchema,
  yanitDiscoveryProductSchema,
  yanitGapSchema,
  yanitOpportunitySchema,
  yanitVisibilitySummarySchema,
  type ClaimRequest,
  type ClaimResponse,
  type ConfirmRequest,
  type LinkStatusResponse,
  type ProfitQuoteRequest,
  type ProfitQuoteResponse,
  type PushEvent,
  type SplitItems,
  type SuggestionDecision,
  type YanitVisibilitySummary,
} from "./schemas";
import { CanonicalizationError, canonicalPath, canonicalQueryFromParams, signRequest } from "./signing";

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

/**
 * Redis-backed circuit breaker shared by API and worker processes: after 5 consecutive
 * transport failures (timeout, network error, 429, 5xx) calls fail fast as `unavailable`
 * for 60 seconds. The first call after that is a trial; if it fails the breaker reopens
 * immediately. Breakers are scoped per (peer, link) so one busy or broken link never blocks
 * other stores. Redis problems never block calls (the breaker then stays closed).
 */
export class CircuitBreaker {
  constructor(
    private readonly redis: Redis | null,
    private readonly opts: { threshold: number; openMs: number } = { threshold: CIRCUIT_FAILURE_THRESHOLD, openMs: CIRCUIT_OPEN_MS },
  ) {}

  private key(scope: string, part: "open" | "fails" | "trial"): string {
    return `ekosistem:cb:${scope}:${part}`;
  }

  async isOpen(scope: string): Promise<boolean> {
    if (!this.redis) return false;
    try {
      return (await this.redis.exists(this.key(scope, "open"))) === 1;
    } catch {
      return false;
    }
  }

  async recordSuccess(scope: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(this.key(scope, "fails"), this.key(scope, "trial"));
    } catch {
      // Breaker state is advisory.
    }
  }

  /** Returns true when this failure opened the breaker. */
  async recordFailure(scope: string): Promise<boolean> {
    if (!this.redis) return false;
    try {
      const results = await this.redis
        .multi()
        .incr(this.key(scope, "fails"))
        .exists(this.key(scope, "trial"))
        .pexpire(this.key(scope, "fails"), 3600_000)
        .exec();
      const fails = Number(results?.[0]?.[1] ?? 0);
      const trial = Number(results?.[1]?.[1] ?? 0);
      if (fails >= this.opts.threshold || trial === 1) {
        await this.redis
          .multi()
          .set(this.key(scope, "open"), "1", "PX", this.opts.openMs)
          // After the open window the next failure reopens at once (half-open trial).
          .set(this.key(scope, "trial"), "1", "PX", this.opts.openMs * 10)
          .del(this.key(scope, "fails"))
          .exec();
        return true;
      }
    } catch {
      // Breaker state is advisory.
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Peer client
// ---------------------------------------------------------------------------

export interface PeerLinkCredentials {
  linkId: string;
  /** Current secret (plaintext, decrypted by the caller for this call only). */
  secret: string;
}

export interface PeerRequest<S extends z.ZodType | null> {
  peer: PeerProduct;
  method: SignedMethod;
  /** Path from the v1 root on, e.g. `/ekosistem/v1/profit/variants`. */
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  /** Signing credentials; null only for the unsigned claim call. */
  link: PeerLinkCredentials | null;
  /** Response schema; null when the response body is ignored. */
  schema: S;
  timeoutMs?: number;
  /** Explicit nonce, e.g. to repeat a rotate call idempotently. */
  nonce?: string;
}

export interface PeerResponse<T> {
  status: number;
  data: T;
  requestId: string | null;
  /** Cache-Control max-age of the answer, when given (Yanıt sends 3600). */
  maxAgeSeconds: number | null;
}

export interface PeerClientOptions {
  bases: PeerBases;
  redis: Redis | null;
  logger?: Logger | undefined;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface IncrementalParams {
  since?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export interface IncrementalResult<T> extends SplitItems<T> {
  nextCursor: string | null;
  asOf: string;
}

export interface SnapshotResult<T> {
  items: T[];
  invalid: SplitItems<T>["invalid"];
  asOf: string;
  maxAgeSeconds: number | null;
}

const STATUS_CODES: Record<number, EkosistemErrorCode> = {
  400: "bad_request",
  401: "signature_invalid",
  402: "plan_required",
  403: "scope_missing",
  404: "not_found",
  405: "method_not_allowed",
  409: "link_pending",
  413: "payload_too_large",
  422: "validation_failed",
  429: "rate_limited",
};

class ResponseTooLargeError extends Error {}

/** Breakers are per (peer, link); the unsigned claim call shares one "public" breaker per peer. */
const breakerScope = (peer: PeerProduct, linkId: string | null) => `${peer}:${linkId ?? "public"}`;

async function readCapped(res: Response, cap: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) {
    await res.body?.cancel().catch(() => undefined);
    throw new ResponseTooLargeError();
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      throw new ResponseTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function parseMaxAge(header: string | null): number | null {
  if (!header) return null;
  const m = /(?:^|,)\s*max-age=(\d+)/i.exec(header);
  return m ? Number(m[1]) : null;
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

/**
 * Outbound calls to Kârmatik and Yanıt. Bases come only from the static environment map;
 * requests are signed per §5 with the exact bytes that are sent; redirects are refused;
 * 10 s timeout (1.5 s for profit/quote); responses over 5 MB are rejected; failures are
 * classified from the §6.4 envelope. Secrets, signatures and codes are never logged.
 */
export class PeerClient {
  private readonly fetchImpl: typeof fetch;
  private readonly breaker: CircuitBreaker;
  private readonly now: () => Date;

  constructor(private readonly opts: PeerClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.breaker = new CircuitBreaker(opts.redis);
    this.now = opts.now ?? (() => new Date());
  }

  isConfigured(peer: PeerProduct): boolean {
    return Boolean(this.opts.bases[peer]);
  }

  /** Circuit breaker state of a link's calls (shared by API and worker through Redis). */
  async circuitState(peer: PeerProduct, linkId: string): Promise<"open" | "closed"> {
    return (await this.breaker.isOpen(breakerScope(peer, linkId))) ? "open" : "closed";
  }

  async request<S extends z.ZodType | null>(req: PeerRequest<S>): Promise<PeerResponse<S extends z.ZodType ? z.output<S> : null>> {
    type Out = S extends z.ZodType ? z.output<S> : null;
    const base = this.opts.bases[req.peer];
    if (!base) throw new EkosistemPeerError("not_configured", null, `no base address configured for ${req.peer}`);

    let target: string;
    try {
      const path = canonicalPath(req.path);
      if (path !== req.path) throw new CanonicalizationError("path_invalid");
      const query = canonicalQueryFromParams(req.query ?? {});
      target = query ? `${path}?${query}` : path;
    } catch (err) {
      throw new EkosistemPeerError("bad_request", null, `request target is not canonical (${err instanceof CanonicalizationError ? err.reason : "invalid"})`);
    }

    let body: Buffer;
    if (req.method === "GET" || req.method === "DELETE") {
      if (req.body !== undefined) throw new EkosistemPeerError("bad_request", null, `${req.method} requests carry no body`);
      body = Buffer.alloc(0);
    } else {
      body = Buffer.from(JSON.stringify(req.body ?? {}), "utf8");
      if (body.byteLength > MAX_REQUEST_BODY_BYTES) throw new EkosistemPeerError("payload_too_large", null, "request body exceeds 64 KB");
    }

    const scope = breakerScope(req.peer, req.link?.linkId ?? null);
    if (await this.breaker.isOpen(scope)) {
      throw new EkosistemPeerError("unavailable", null, `circuit open for ${req.peer}`, null, null, true);
    }

    const headers: Record<string, string> = { accept: "application/json" };
    if (req.method === "POST" || req.method === "PATCH") headers["content-type"] = "application/json";
    if (req.link) {
      const signed = signRequest({
        secret: req.link.secret,
        linkId: req.link.linkId,
        product: SELF_PRODUCT,
        method: req.method,
        canonical: target,
        body,
        timestamp: Math.floor(this.now().getTime() / 1000),
        ...(req.nonce ? { nonce: req.nonce } : {}),
      });
      Object.assign(headers, signed.headers);
    }

    const timeoutMs = req.timeoutMs ?? (req.path === PROFIT_QUOTE_PATH ? PROFIT_QUOTE_TIMEOUT_MS : PEER_TIMEOUT_MS);
    const started = Date.now();
    const logCtx = { peer: req.peer, method: req.method, path: req.path, linkId: req.link?.linkId ?? null };

    let res: Response;
    let raw: Buffer;
    try {
      res = await this.fetchImpl(`${base}${target}`, {
        method: req.method,
        headers,
        body: body.byteLength ? body : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      raw = await readCapped(res, MAX_RESPONSE_BODY_BYTES);
    } catch (err) {
      if (err instanceof ResponseTooLargeError) {
        await this.breaker.recordSuccess(scope);
        throw new EkosistemPeerError("invalid_response", null, "response exceeds 5 MB");
      }
      const opened = await this.breaker.recordFailure(scope);
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      this.opts.logger?.warn({ ...logCtx, durationMs: Date.now() - started, timedOut, circuitOpened: opened }, "ekosistem peer call failed");
      throw new EkosistemPeerError("unavailable", null, timedOut ? `timed out after ${timeoutMs} ms` : "network error");
    }

    const requestIdHeader = res.headers.get("x-request-id");
    if (res.status >= 200 && res.status < 300) {
      await this.breaker.recordSuccess(scope);
      this.opts.logger?.debug({ ...logCtx, status: res.status, durationMs: Date.now() - started }, "ekosistem peer call");
      const maxAgeSeconds = parseMaxAge(res.headers.get("cache-control"));
      if (req.schema === null) return { status: res.status, data: null as Out, requestId: requestIdHeader, maxAgeSeconds };
      let json: unknown;
      try {
        json = raw.byteLength ? JSON.parse(raw.toString("utf8")) : null;
      } catch {
        throw new EkosistemPeerError("invalid_response", res.status, "response is not valid JSON", null, requestIdHeader);
      }
      const parsed = req.schema.safeParse(json);
      if (!parsed.success) {
        const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`);
        this.opts.logger?.warn({ ...logCtx, status: res.status, issues }, "ekosistem peer response does not match the contract");
        throw new EkosistemPeerError("invalid_response", res.status, `response does not match the contract: ${issues.join("; ")}`, null, requestIdHeader);
      }
      return { status: res.status, data: parsed.data as Out, requestId: requestIdHeader, maxAgeSeconds };
    }

    // Error answers: the envelope code wins; the status is the fallback.
    let code: EkosistemErrorCode = res.status >= 500 ? "unavailable" : (STATUS_CODES[res.status] ?? "unavailable");
    let message = `HTTP ${res.status}`;
    let requestId = requestIdHeader;
    try {
      const env = errorEnvelopeSchema.safeParse(JSON.parse(raw.toString("utf8")));
      if (env.success) {
        if (isEkosistemErrorCode(env.data.error.code)) code = env.data.error.code;
        message = env.data.error.message ? env.data.error.message.slice(0, 300) : message;
        requestId = env.data.requestId ?? requestId;
      }
    } catch {
      // Not an envelope (e.g. a proxy error page); keep the status-derived code.
    }
    const transportFailure = res.status === 429 || res.status >= 500;
    let opened = false;
    if (transportFailure) opened = await this.breaker.recordFailure(scope);
    else await this.breaker.recordSuccess(scope);
    this.opts.logger?.warn({ ...logCtx, status: res.status, code, peerRequestId: requestId, durationMs: Date.now() - started, circuitOpened: opened }, "ekosistem peer error");
    const retryAfterMs = res.status === 429 || res.status === 503 ? parseRetryAfter(res.headers.get("retry-after")) : null;
    throw new EkosistemPeerError(code, res.status, message, retryAfterMs, requestId);
  }

  // -------------------------------------------------------------------------
  // Link lifecycle (§4)
  // -------------------------------------------------------------------------

  /** POST {I}/ekosistem/v1/links/claim — unsigned; I is the product that issued the code. */
  async claim(peer: PeerProduct, body: ClaimRequest): Promise<ClaimResponse> {
    return (await this.request({ peer, method: "POST", path: "/ekosistem/v1/links/claim", body, link: null, schema: claimResponseSchema })).data;
  }

  async confirm(peer: PeerProduct, link: PeerLinkCredentials, body: ConfirmRequest): Promise<void> {
    await this.request({ peer, method: "POST", path: `/ekosistem/v1/links/${link.linkId}/confirm`, body, link, schema: null });
  }

  async getLink(peer: PeerProduct, link: PeerLinkCredentials): Promise<LinkStatusResponse> {
    return (await this.request({ peer, method: "GET", path: `/ekosistem/v1/links/${link.linkId}`, link, schema: linkStatusResponseSchema })).data;
  }

  async deleteLink(peer: PeerProduct, link: PeerLinkCredentials): Promise<void> {
    await this.request({ peer, method: "DELETE", path: `/ekosistem/v1/links/${link.linkId}`, link, schema: null });
  }

  async patchLink(peer: PeerProduct, link: PeerLinkCredentials, grants: string[]): Promise<void> {
    await this.request({ peer, method: "PATCH", path: `/ekosistem/v1/links/${link.linkId}`, body: { grants }, link, schema: null });
  }

  /** Repeating with the same nonce returns the same new secret (§4.4). */
  async rotate(peer: PeerProduct, link: PeerLinkCredentials, nonce: string): Promise<string> {
    return (await this.request({ peer, method: "POST", path: `/ekosistem/v1/links/${link.linkId}/rotate`, body: {}, link, schema: rotateResponseSchema, nonce })).data.secret;
  }

  async pushEvent(peer: PeerProduct, link: PeerLinkCredentials, event: PushEvent): Promise<void> {
    await this.request({ peer, method: "POST", path: "/ekosistem/v1/events", body: event, link, schema: null });
  }

  // -------------------------------------------------------------------------
  // Shared pagination helpers
  // -------------------------------------------------------------------------

  private async incremental<T extends z.ZodType>(peer: PeerProduct, link: PeerLinkCredentials, path: string, item: T, params: IncrementalParams): Promise<IncrementalResult<z.output<T>>> {
    const res = await this.request({ peer, method: "GET", path, query: { since: params.since, cursor: params.cursor, limit: params.limit }, link, schema: incrementalPageSchema });
    const split = splitItems(item, res.data.items);
    return { ...split, nextCursor: res.data.nextCursor, asOf: res.data.asOf };
  }

  private async snapshot<T extends z.ZodType>(
    peer: PeerProduct,
    link: PeerLinkCredentials,
    path: string,
    item: T,
    query: Record<string, string | number | undefined> = {},
  ): Promise<SnapshotResult<z.output<T>>> {
    const res = await this.request({ peer, method: "GET", path, query, link, schema: snapshotEnvelopeSchema });
    const split = splitItems(item, res.data.items, { tombstones: false });
    return { items: split.items, invalid: split.invalid, asOf: res.data.asOf, maxAgeSeconds: res.maxAgeSeconds };
  }

  // -------------------------------------------------------------------------
  // Kârmatik (§8)
  // -------------------------------------------------------------------------

  karmatikProfitVariants(link: PeerLinkCredentials, params: IncrementalParams = {}) {
    return this.incremental("karmatik", link, "/ekosistem/v1/profit/variants", karmatikProfitVariantSchema, params);
  }

  /** Same endpoint read with profit:summary only (§8.2). */
  karmatikProfitSummaries(link: PeerLinkCredentials, params: IncrementalParams = {}) {
    return this.incremental("karmatik", link, "/ekosistem/v1/profit/variants", karmatikProfitSummarySchema, params);
  }

  karmatikSuggestions(link: PeerLinkCredentials, params: IncrementalParams = {}) {
    return this.incremental("karmatik", link, "/ekosistem/v1/pricing/suggestions", karmatikSuggestionSchema, params);
  }

  async karmatikDecision(link: PeerLinkCredentials, ref: string, decision: SuggestionDecision): Promise<void> {
    const body = suggestionDecisionSchema.parse(decision);
    await this.request({ peer: "karmatik", method: "POST", path: `/ekosistem/v1/pricing/suggestions/${ref}/decision`, body, link, schema: null });
  }

  karmatikCompetitorPrices(link: PeerLinkCredentials, params: IncrementalParams = {}) {
    return this.incremental("karmatik", link, "/ekosistem/v1/competitors/prices", karmatikCompetitorPriceSchema, params);
  }

  karmatikAlerts(link: PeerLinkCredentials, params: IncrementalParams = {}) {
    return this.incremental("karmatik", link, "/ekosistem/v1/alerts", karmatikAlertSchema, params);
  }

  karmatikMarketBrands(link: PeerLinkCredentials) {
    return this.snapshot("karmatik", link, "/ekosistem/v1/market/brands", karmatikMarketBrandSchema);
  }

  karmatikMarketKeywords(link: PeerLinkCredentials) {
    return this.snapshot("karmatik", link, "/ekosistem/v1/market/keywords", karmatikMarketKeywordSchema);
  }

  /** Synchronous profit check for admin actions only; 1.5 s timeout (§1, §8.7). */
  async karmatikProfitQuote(link: PeerLinkCredentials, input: ProfitQuoteRequest): Promise<ProfitQuoteResponse> {
    const body = profitQuoteRequestSchema.parse(input);
    return (await this.request({ peer: "karmatik", method: "POST", path: PROFIT_QUOTE_PATH, body, link, schema: profitQuoteResponseSchema })).data;
  }

  // -------------------------------------------------------------------------
  // Yanıt (§9)
  // -------------------------------------------------------------------------

  async yanitVisibilitySummary(link: PeerLinkCredentials, windowDays: 7 | 30): Promise<{ summary: YanitVisibilitySummary; maxAgeSeconds: number | null }> {
    const res = await this.request({ peer: "yanit", method: "GET", path: "/ekosistem/v1/visibility/summary", query: { windowDays }, link, schema: yanitVisibilitySummarySchema });
    return { summary: res.data, maxAgeSeconds: res.maxAgeSeconds };
  }

  yanitGaps(link: PeerLinkCredentials) {
    return this.snapshot("yanit", link, "/ekosistem/v1/visibility/gaps", yanitGapSchema);
  }

  yanitOpportunities(link: PeerLinkCredentials, params: IncrementalParams = {}) {
    return this.incremental("yanit", link, "/ekosistem/v1/opportunities", yanitOpportunitySchema, params);
  }

  yanitCitations(link: PeerLinkCredentials, windowDays = 30) {
    return this.snapshot("yanit", link, "/ekosistem/v1/citations", yanitCitationSchema, { windowDays });
  }

  yanitDiscoveryProducts(link: PeerLinkCredentials, windowDays = 30) {
    return this.snapshot("yanit", link, "/ekosistem/v1/discovery/products", yanitDiscoveryProductSchema, { windowDays });
  }
}

