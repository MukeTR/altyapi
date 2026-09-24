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
  canonicalHostname: string;
  action: "render" | "redirect";
  redirectTo: string | null;
}

const ISOLATE_TTL_MS = 30_000;
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

    return fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? null : request.body,
      redirect: "manual",
    });
  },
} satisfies ExportedHandler<Env>;
