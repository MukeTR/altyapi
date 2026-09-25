import "server-only";
import { isIP } from "node:net";
import { headers } from "next/headers";
import { serverEnv } from "@/lib/env";
import { getSessionToken } from "@/lib/session";
import { ApiError, errorFromResponse, networkError, type ApiErrorInfo } from "./errors";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[];

export interface ApiRequest {
  method?: HttpMethod;
  query?: Record<string, QueryValue>;
  /** JSON body. */
  body?: unknown;
  /** Session token to use instead of the cookie (login, register); null sends the request anonymously. */
  token?: string | null;
  signal?: AbortSignal;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiErrorInfo };

const CORRELATION_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function buildQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) for (const v of value) params.append(key, String(v));
    else params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/**
 * The end user's IP address as seen by the admin's trusted proxies, or null when there is none.
 *
 * X-Forwarded-For is a list that every hop appends to, and anything left of the entries our own
 * proxies wrote is whatever the client chose to send. Next.js fills the header with the socket
 * address only when the request has none. So the trustworthy entry is the one `hops` places from
 * the right: with a single ingress (the default) that is the last entry, which the ingress wrote
 * (or Next.js did, locally). Leftmost entries are never used, so a client cannot choose the
 * address the API rate-limits by.
 */
export function clientIpFrom(forwardedFor: string | null, hops: number): string | null {
  if (!forwardedFor) return null;
  const entries = forwardedFor
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const candidate = entries[entries.length - hops];
  if (!candidate) return null;
  // Node reports IPv4 clients on dual-stack sockets as "::ffff:1.2.3.4".
  const ip = candidate.startsWith("::ffff:") && isIP(candidate.slice(7)) === 4 ? candidate.slice(7) : candidate;
  return isIP(ip) ? ip : null;
}

/**
 * Headers that carry the end user's identity to the API: the client IP (the API rate-limits login
 * and registration per IP), the user agent (stored on sessions) and the correlation id when the
 * incoming request already has one. The browser's own X-Forwarded-For is never passed through:
 * the API receives a single address resolved from the trusted proxy hops.
 */
export async function forwardedHeaders(): Promise<Record<string, string>> {
  const incoming = await headers();
  const out: Record<string, string> = {};
  const ip = clientIpFrom(incoming.get("x-forwarded-for"), serverEnv.trustedProxyHops());
  if (ip) out["x-forwarded-for"] = ip;
  const userAgent = incoming.get("user-agent");
  if (userAgent) out["user-agent"] = userAgent;
  const correlationId = incoming.get("x-correlation-id");
  if (correlationId && CORRELATION_ID.test(correlationId)) out["x-correlation-id"] = correlationId;
  return out;
}

function isConnectionRefused(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string } } | null)?.cause;
  return cause?.code === "ECONNREFUSED" || cause?.code === "ECONNRESET";
}

/**
 * Sends a request to the admin API and returns the raw response. Throws ApiError only when no
 * response arrived. Idempotent GETs are retried once when the connection is refused, which covers
 * a brief API restart.
 */
export async function apiFetch(path: string, req: ApiRequest = {}): Promise<Response> {
  const method = req.method ?? "GET";
  const token = req.token === undefined ? await getSessionToken() : req.token;
  const hdrs: Record<string, string> = { accept: "application/json", ...(await forwardedHeaders()) };
  if (token) hdrs.authorization = `Bearer ${token}`;
  if (req.body !== undefined) hdrs["content-type"] = "application/json";
  const url = `${serverEnv.apiUrl()}${path}${buildQuery(req.query)}`;
  const init: RequestInit = {
    method,
    headers: hdrs,
    cache: "no-store",
    ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
  };

  for (let attempt = 0; ; attempt++) {
    const timeout = AbortSignal.timeout(serverEnv.apiTimeoutMs());
    const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
    try {
      return await fetch(url, { ...init, signal });
    } catch (err) {
      if (method === "GET" && attempt === 0 && isConnectionRefused(err)) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        continue;
      }
      throw networkError(timeout.aborted);
    }
  }
}

/** JSON request that throws ApiError on any non-2xx status; 204 resolves to undefined. */
export async function api<T>(path: string, req?: ApiRequest): Promise<T> {
  const res = await apiFetch(path, req);
  if (!res.ok) throw await errorFromResponse(res);
  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError({
      status: res.status,
      code: "internal",
      messageKey: "errors.unexpected_response",
      correlationId: res.headers.get("x-correlation-id"),
    });
  }
}

/** Like api(), but returns failures as a serializable value instead of throwing. */
export async function apiResult<T>(path: string, req?: ApiRequest): Promise<ApiResult<T>> {
  try {
    return { ok: true, data: await api<T>(path, req) };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: err.toInfo() };
    throw err;
  }
}
