import { signEdgePayload } from "./signing";

export interface Env {
  ROUTING: KVNamespace;
  EDGE_ROUTING_SECRET: string;
  API_ORIGIN: string;
  STOREFRONT_ORIGIN: string;
  STORE_ROOT_DOMAIN: string;
}

/** Mirrors RouteResolution in @altyapi/domains. */
interface RouteResolution {
  hostname: string;
  organizationId: string;
  storeId: string;
  storeSlug: string;
  storeStatus: string;
  defaultLocale: string;
  routingVersion: number;
  contentVersion: number;
  canonicalHostname: string;
  action: "render" | "redirect";
  redirectTo: string | null;
}

const ISOLATE_TTL_MS = 30_000;
const UNCACHEABLE = /^\/(?:[a-z]{2}\/)?(?:cart|checkout|account|api|search)(?:\/|$)/;
const ORIGIN_FALLBACK_KV_TTL_S = 300;
const isolateCache = new Map<string, { value: RouteResolution | null; expires: number }>();

function normalizeHost(raw: string | null): string | null {
  if (!raw) return null;
  const host = raw.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  return /^[a-z0-9.-]{1,253}$/.test(host) ? host : null;
}

async function resolveFromOrigin(env: Env, host: string): Promise<RouteResolution | null> {
  const url = new URL("/internal/edge/resolve", env.API_ORIGIN);
  url.searchParams.set("host", host);
  const res = await fetch(url, {
    headers: { "x-altyapi-edge-signature": await signEdgePayload(env.EDGE_ROUTING_SECRET, host) },
    cf: { cacheTtl: 0 },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`origin resolve failed: ${res.status}`);
  return (await res.json()) as RouteResolution;
}

async function resolve(env: Env, ctx: ExecutionContext, host: string): Promise<RouteResolution | null> {
  const now = Date.now();
  const cached = isolateCache.get(host);
  if (cached && cached.expires > now) return cached.value;

  let value = await env.ROUTING.get<RouteResolution>(`host:${host}`, "json");
  if (!value) {
    value = await resolveFromOrigin(env, host);
    if (value) {
      // Fallback entries expire quickly; entries published by the worker (no TTL) take precedence.
      ctx.waitUntil(
        env.ROUTING.put(`host:${host}`, JSON.stringify(value), { expirationTtl: ORIGIN_FALLBACK_KV_TTL_S }),
      );
    }
  }
  // Never let an older version overwrite a newer one seen by this isolate.
  if (cached?.value && value && value.routingVersion < cached.value.routingVersion) value = cached.value;
  isolateCache.set(host, { value, expires: now + ISOLATE_TTL_MS });
  return value;
}

function notFoundPage(): Response {
  return new Response(
    `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Mağaza bulunamadı</title></head><body style="font-family:system-ui;padding:4rem;text-align:center"><h1>Mağaza bulunamadı</h1><p>Bu adres herhangi bir altyapi.io mağazasına bağlı değil.</p></body></html>`,
    { status: 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" } },
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/__edge/health") return new Response("ok");

    const host = normalizeHost(request.headers.get("host") ?? url.hostname);
    if (!host) return new Response("Bad Request", { status: 400 });

    let route: RouteResolution | null;
    try {
      route = await resolve(env, ctx, host);
    } catch {
      return new Response("Service Unavailable", { status: 503, headers: { "retry-after": "5" } });
    }
    if (!route) return notFoundPage();

    if (route.action === "redirect" && route.redirectTo) {
      return Response.redirect(`https://${route.redirectTo}${url.pathname}${url.search}`, 301);
    }
    if (url.protocol === "http:") {
      return Response.redirect(`https://${host}${url.pathname}${url.search}`, 301);
    }

    // Versioned HTML cache: the key includes the store content version, so a publish makes
    // old entries unreachable without purging. Personal pages and previews are never cached.
    const cookie = request.headers.get("cookie") ?? "";
    const cacheable =
      (request.method === "GET" || request.method === "HEAD") &&
      !UNCACHEABLE.test(url.pathname) &&
      !cookie.includes("altyapi_preview=") &&
      !request.headers.has("authorization");
    const cacheKey = new Request(`https://edge-cache.altyapi.internal/${host}${url.pathname}${url.search}${url.search ? "&" : "?"}__cv=${route.contentVersion}`, { method: "GET" });
    if (cacheable) {
      const hit = await caches.default.match(cacheKey);
      if (hit) {
        const res = new Response(hit.body, hit);
        res.headers.set("x-altyapi-cache", "HIT");
        return res;
      }
    }

    const upstreamUrl = new URL(url.pathname + url.search, env.STOREFRONT_ORIGIN);
    const headers = new Headers(request.headers);
    // Clients must never be able to inject routing metadata.
    for (const key of [...headers.keys()]) if (key.startsWith("x-altyapi-")) headers.delete(key);
    headers.set("x-forwarded-host", host);
    headers.set("x-forwarded-proto", "https");
    headers.set("x-altyapi-store-id", route.storeId);
    headers.set("x-altyapi-organization-id", route.organizationId);
    headers.set("x-altyapi-host", route.hostname);
    headers.set("x-altyapi-canonical-host", route.canonicalHostname);
    headers.set("x-altyapi-routing-version", String(route.routingVersion));
    headers.set("x-altyapi-default-locale", route.defaultLocale);
    headers.set("x-altyapi-store-status", route.storeStatus);
    headers.set(
      "x-altyapi-edge-signature",
      await signEdgePayload(env.EDGE_ROUTING_SECRET, `${route.storeId}|${route.hostname}|${route.routingVersion}`),
    );

    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? null : request.body,
      redirect: "manual",
    });
    const cdn = upstream.headers.get("cdn-cache-control");
    const maxAge = cdn ? Number(/max-age=(\d+)/.exec(cdn)?.[1] ?? 0) : 0;
    if (cacheable && upstream.status === 200 && maxAge > 0 && !upstream.headers.has("set-cookie")) {
      const toCache = new Response(upstream.clone().body, upstream);
      toCache.headers.set("cache-control", `public, max-age=${maxAge}`);
      ctx.waitUntil(caches.default.put(cacheKey, toCache));
    }
    const res = new Response(upstream.body, upstream);
    res.headers.set("x-altyapi-cache", cacheable ? "MISS" : "BYPASS");
    return res;
  },
} satisfies ExportedHandler<Env>;
