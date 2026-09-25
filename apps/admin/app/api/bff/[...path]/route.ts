import type { NextRequest } from "next/server";
import { apiFetch, type HttpMethod } from "@/lib/api/server";
import { ApiError } from "@/lib/api/errors";
import { getSessionToken } from "@/lib/session";

/**
 * Same-origin proxy for client components (search-as-you-type, polling, editor autosave,
 * uploads). It adds the session as a Bearer token, so the API's cookie CSRF check does not
 * apply; this route therefore enforces its own: every state-changing request must carry an
 * Origin header equal to the admin's own origin.
 */

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Account endpoints go through server actions only (they set and clear the session cookie). */
const BLOCKED = /^v1\/(auth|invitations)\b/;

function errorBody(status: number, code: string, messageKey: string) {
  return Response.json({ error: { code, message_key: messageKey, correlation_id: null } }, { status, headers: { "cache-control": "no-store" } });
}

function expectedOrigin(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  const joined = path.map(encodeURIComponent).join("/");
  if (!joined.startsWith("v1/") || BLOCKED.test(joined)) return errorBody(404, "not_found", "errors.route_not_found");

  if (UNSAFE.has(req.method)) {
    const origin = req.headers.get("origin");
    if (!origin || origin !== expectedOrigin(req)) return errorBody(403, "forbidden", "errors.csrf.origin_rejected");
  }

  const token = await getSessionToken();
  if (!token) return errorBody(401, "unauthenticated", "errors.auth.required");

  let body: unknown;
  if (UNSAFE.has(req.method)) {
    const text = await req.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        return errorBody(400, "bad_request", "errors.bad_request");
      }
    }
  }

  const query: Record<string, string[]> = {};
  for (const [k, v] of req.nextUrl.searchParams) (query[k] ??= []).push(v);

  let res: Response;
  try {
    res = await apiFetch(`/${joined}`, { method: req.method as HttpMethod, query, ...(body !== undefined ? { body } : {}), token, signal: req.signal });
  } catch (err) {
    if (err instanceof ApiError) {
      return Response.json({ error: { code: err.code, message_key: err.messageKey, correlation_id: null } }, { status: 503, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    }
    throw err;
  }

  // nosniff: API bodies are served from the admin origin and must only ever be read as their declared type.
  const headers = new Headers({ "cache-control": "no-store", "x-content-type-options": "nosniff" });
  for (const name of ["content-type", "x-correlation-id", "retry-after"]) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(res.status === 204 ? null : res.body, { status: res.status, headers });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
