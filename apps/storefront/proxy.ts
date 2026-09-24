import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

const EDGE_MAX_SKEW_SECONDS = 60;
const PREVIEW_COOKIE = "altyapi_preview";
/** Paths whose HTML is identical for every visitor and may be cached at the edge. */
const UNCACHEABLE = /^\/(?:[a-z]{2}\/)?(?:cart|checkout|account|api|search)(?:\/|$)/;

function verifyEdge(secret: string, payload: string, signature: string | null): boolean {
  if (!signature) return false;
  const [ts, sig] = signature.split(".");
  const t = Number(ts);
  if (!Number.isInteger(t) || !sig || Math.abs(Math.floor(Date.now() / 1000) - t) > EDGE_MAX_SKEW_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("base64url");
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Establishes the tenant for every storefront request. Routing metadata is trusted only
 * when signed by the edge router; internal x-sf-* headers are always rebuilt here so a
 * client can never inject them.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  for (const key of [...headers.keys()]) if (key.startsWith("x-sf-")) headers.delete(key);

  const storeId = request.headers.get("x-altyapi-store-id");
  const host = request.headers.get("x-altyapi-host");
  const routingVersion = request.headers.get("x-altyapi-routing-version");
  const secret = process.env.EDGE_ROUTING_SECRET ?? "";
  const signed = storeId && host && routingVersion && verifyEdge(secret, `${storeId}|${host}|${routingVersion}`, request.headers.get("x-altyapi-edge-signature"));

  if (signed) {
    headers.set("x-sf-store-id", storeId);
    headers.set("x-sf-host", host);
  } else if ((process.env.APP_ENV ?? "local") === "local") {
    // Local development without the edge router: map the request host to a store hostname.
    const reqHost = (request.headers.get("host") ?? "").replace(/:\d+$/, "");
    headers.set("x-sf-dev-host", reqHost === "localhost" || reqHost === "127.0.0.1" ? process.env.STOREFRONT_DEV_HOST ?? reqHost : reqHost);
    headers.set("x-sf-host", reqHost);
  } else {
    return new NextResponse("Store not resolved", { status: 421 });
  }

  const url = request.nextUrl;
  const previewToken = url.searchParams.get("preview_token");
  if (previewToken) {
    url.searchParams.delete("preview_token");
    const res = NextResponse.redirect(url);
    res.cookies.set(PREVIEW_COOKIE, previewToken, { httpOnly: true, secure: true, sameSite: "none", path: "/", maxAge: 3600 });
    return res;
  }
  if (url.searchParams.has("exit_preview")) {
    url.searchParams.delete("exit_preview");
    const res = NextResponse.redirect(url);
    res.cookies.delete(PREVIEW_COOKIE);
    return res;
  }

  headers.set("x-sf-path", url.pathname);
  headers.set("x-sf-search", url.search);
  const response = NextResponse.next({ request: { headers } });
  const inPreview = request.cookies.has(PREVIEW_COOKIE);
  if (request.method === "GET" && !inPreview && !UNCACHEABLE.test(url.pathname)) {
    // Shared caches (Cloudflare) may keep the HTML briefly; browsers always revalidate.
    response.headers.set("CDN-Cache-Control", "public, max-age=60, stale-while-revalidate=600");
    response.headers.set("Cache-Tag", `store-${storeId ?? "dev"}`);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
