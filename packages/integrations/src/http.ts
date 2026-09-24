import type { Redis } from "ioredis";
import type { Logger } from "@altyapi/observability";

/** A provider rate limit: at most `limit` requests per `windowMs` for this connection. */
export interface RateRule {
  key: string;
  limit: number;
  windowMs: number;
}

export class ProviderHttpError extends Error {
  override name = "ProviderHttpError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The provider (or our own limiter) asked us to slow down; the sync resumes later. */
export class RateLimitedError extends Error {
  override name = "RateLimitedError";
  constructor(readonly retryAfterMs: number) {
    super(`rate limited, retry after ${retryAfterMs}ms`);
  }
}

export interface HttpRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  json?: unknown;
  form?: Record<string, string>;
  rate?: RateRule;
  /** Response handling; "text" returns the body as a string. */
  expect?: "json" | "text";
  timeoutMs?: number;
}

export interface HttpResponse<T> {
  status: number;
  data: T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Outbound HTTP for connectors: per-connection rate limits shared across workers (Redis),
 * timeouts, one retry for transient failures and error messages without request secrets.
 */
export class HttpClient {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly opts: {
      redis: Redis | null;
      connectionId: string;
      logger: Logger;
      fetchImpl?: typeof fetch;
      /** Longest a request waits for a free rate-limit slot before giving up. */
      maxWaitMs?: number;
    },
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async acquire(rule: RateRule): Promise<void> {
    const redis = this.opts.redis;
    if (!redis) return;
    const maxWait = this.opts.maxWaitMs ?? 20_000;
    const started = Date.now();
    for (;;) {
      const now = Date.now();
      const window = Math.floor(now / rule.windowMs);
      const key = `integration:rl:${this.opts.connectionId}:${rule.key}:${window}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.pexpire(key, rule.windowMs * 2);
      if (count <= rule.limit) return;
      const waitMs = (window + 1) * rule.windowMs - now + 5;
      if (Date.now() - started + waitMs > maxWait) throw new RateLimitedError(waitMs);
      await sleep(waitMs);
    }
  }

  async request<T>(req: HttpRequest): Promise<HttpResponse<T>> {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      if (req.rate) await this.acquire(req.rate);
      const headers: Record<string, string> = { accept: "application/json", ...(req.headers ?? {}) };
      let body: string | undefined;
      if (req.json !== undefined) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(req.json);
      } else if (req.form) {
        headers["content-type"] = "application/x-www-form-urlencoded";
        body = new URLSearchParams(req.form).toString();
      }
      let res: Response;
      try {
        res = await this.fetchImpl(req.url, { method: req.method, headers, body, redirect: "error", signal: AbortSignal.timeout(req.timeoutMs ?? 30_000) });
      } catch (err) {
        if (attempt < 2) {
          await sleep(1000);
          continue;
        }
        throw new ProviderHttpError(0, `network error: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after"));
        throw new RateLimitedError(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60_000);
      }
      if (res.status >= 500 && attempt < 2) {
        await sleep(1000);
        continue;
      }
      const text = await res.text();
      if (res.status < 200 || res.status >= 300) {
        throw new ProviderHttpError(res.status, `HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      if (req.expect === "text") return { status: res.status, data: text as T };
      try {
        return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
      } catch {
        throw new ProviderHttpError(res.status, `invalid JSON response: ${text.slice(0, 120)}`);
      }
    }
  }
}

/** Credentials were rejected; retrying will not help until the merchant fixes them. */
export class ProviderAuthError extends Error {
  override name = "ProviderAuthError";
}

/** The provider answered with an application-level error. */
export class ProviderApiError extends Error {
  override name = "ProviderApiError";
  constructor(
    readonly code: string | null,
    message: string,
  ) {
    super(message);
  }
}
