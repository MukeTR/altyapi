import { ApiError, errorFromResponse, networkError } from "./errors";

export interface BffRequest {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Client-side API call through the same-origin /api/bff proxy. `path` is the API path
 * ("/v1/organizations/…"). Throws ApiError; a 401 sends the user to sign in again.
 */
export async function bff<T>(path: string, req: BffRequest = {}): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query ?? {})) if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  const qs = params.toString();
  let res: Response;
  try {
    res = await fetch(`/api/bff${path}${qs ? `?${qs}` : ""}`, {
      method: req.method ?? "GET",
      headers: { accept: "application/json", ...(req.body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
      ...(req.signal ? { signal: req.signal } : {}),
      credentials: "same-origin",
    });
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") throw err;
    throw networkError(false);
  }
  if (res.status === 401) {
    window.location.assign(`/api/session/expired?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }
  if (!res.ok) throw await errorFromResponse(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export { ApiError };
