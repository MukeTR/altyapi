import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isLocaleCode } from "@altyapi/commerce-core/locales";
import { cacheClassOfPath } from "@altyapi/site/route-classes";
import { GONE_RENDER_HEADER, GONE_RENDER_TOKEN, goneResponse, type GoneTenant } from "./lib/gone";

const EDGE_MAX_SKEW_SECONDS = 60;
const PREVIEW_COOKIE = "altyapi_preview";
/** Checkout under a language prefix (/ar/checkout, /ar/checkout/complete): app/checkout renders it in that language. */
const LOCALIZED_CHECKOUT = /^\/([a-z]{2})(\/checkout(?:\/.*)?)$/;

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
 * client can never inject them. Shared caching follows the cache class the module manifests
 * give the path (cart and checkout private, pages and content public), and removed paths are
 * answered with 410 Gone.
 */
export async function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  for (const key of [...headers.keys()]) if (key.startsWith("x-sf-")) headers.delete(key);

  const storeId = request.headers.get("x-altyapi-store-id");
  const host = request.headers.get("x-altyapi-host");
  const routingVersion = request.headers.get("x-altyapi-routing-version");
  const secret = process.env.EDGE_ROUTING_SECRET ?? "";
  const signed = storeId && host && routingVersion && verifyEdge(secret, `${storeId}|${host}|${routingVersion}`, request.headers.get("x-altyapi-edge-signature"));

  let tenant: GoneTenant;
  if (signed) {
    headers.set("x-sf-store-id", storeId);
    headers.set("x-sf-host", host);
    tenant = { storeId, devHost: null };
  } else if ((process.env.APP_ENV ?? "local") === "local") {
    // Local development without the edge router: map the request host to a store hostname.
    const reqHost = (request.headers.get("host") ?? "").replace(/:\d+$/, "");
    const devHost = reqHost === "localhost" || reqHost === "127.0.0.1" ? process.env.STOREFRONT_DEV_HOST ?? reqHost : reqHost;
    headers.set("x-sf-dev-host", devHost);
    headers.set("x-sf-host", reqHost);
    tenant = { storeId: null, devHost };
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

  const inPreview = request.cookies.has(PREVIEW_COOKIE);
  const cacheClass = cacheClassOfPath(url.pathname);
  // A removed path answers 410 with the not-found page; previews and the proxy's own loopback
  // render of that page pass through. Next removes the flight headers before the proxy runs,
  // so a client-side navigation to such a path gets the same HTML answer, and the router then
  // loads it as a full page.
  const isPageRequest = request.method === "GET" || request.method === "HEAD";
  if (isPageRequest && !inPreview && cacheClass === "public" && request.headers.get(GONE_RENDER_HEADER) !== GONE_RENDER_TOKEN) {
    const gone = await goneResponse(request, tenant);
    if (gone) return gone;
  }

  headers.set("x-sf-path", url.pathname);
  headers.set("x-sf-search", url.search);
  // x-sf-path keeps the prefix, so the site (and the checkout UI) resolve in the page language.
  const checkout = LOCALIZED_CHECKOUT.exec(url.pathname);
  const response =
    checkout && isLocaleCode(checkout[1])
      ? NextResponse.rewrite(new URL(`${checkout[2]}${url.search}`, request.url), { request: { headers } })
      : NextResponse.next({ request: { headers } });
  if (request.method === "GET" && !inPreview && cacheClass === "public") {
    // Shared caches (the edge router, Cloudflare) may keep the HTML briefly; browsers always revalidate.
    response.headers.set("CDN-Cache-Control", "public, max-age=60, stale-while-revalidate=600");
    response.headers.set("Cache-Tag", `store-${storeId ?? "dev"}`);
  } else if (cacheClass === "private") {
    // Per-visitor pages (cart, checkout, account, storefront APIs) are never kept by a shared cache.
    response.headers.set("CDN-Cache-Control", "no-store");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
