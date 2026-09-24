import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { htmlAttributes, t } from "./i18n";

/**
 * 410 Gone for removed paths (plan §5 step 6). App Router pages can only answer "not found"
 * with 404, so the proxy answers these requests itself: a path covered by one of the store's
 * gone rules (a content type prefix removed while entries were live under it) is resolved by
 * the API first, and only when the resolver confirms 410 does the proxy respond, with the
 * store's own themed not-found page rendered by a loopback request and status 410. Every
 * other request passes through untouched; the rule list is cached per store for a short time,
 * so ordinary requests cost no extra API call.
 */

/** A rule the API reports (redirects without a target). */
interface GoneRule {
  fromPath: string;
  matchType: "exact" | "prefix";
}

/** Who the request is for, as the proxy established it (never client headers). */
export interface GoneTenant {
  storeId: string | null;
  devHost: string | null;
}

const RULES_TTL_MS = 30_000;
const rulesByStore = new Map<string, { rules: GoneRule[]; expires: number }>();

/**
 * Marks the proxy's own loopback render of a gone page, so that request passes through to
 * the page instead of being answered with 410 again. Random per process: the loopback always
 * reaches this process, and no client can guess it.
 */
export const GONE_RENDER_HEADER = "x-altyapi-gone-render";
export const GONE_RENDER_TOKEN = randomBytes(24).toString("base64url");

function apiUrl(): string | null {
  const url = process.env.API_INTERNAL_URL || process.env.API_URL;
  return url ? url.replace(/\/$/, "") : null;
}

function apiHeaders(tenant: GoneTenant): Record<string, string> {
  return {
    "x-altyapi-storefront-key": process.env.STOREFRONT_API_SECRET ?? "",
    ...(tenant.storeId ? { "x-altyapi-store-id": tenant.storeId } : {}),
    ...(!tenant.storeId && tenant.devHost ? { "x-altyapi-dev-host": tenant.devHost } : {}),
  };
}

async function goneRules(api: string, tenant: GoneTenant): Promise<GoneRule[]> {
  const key = tenant.storeId ?? `dev:${tenant.devHost ?? ""}`;
  const cached = rulesByStore.get(key);
  if (cached && cached.expires > Date.now()) return cached.rules;
  const res = await fetch(`${api}/storefront/v1/gone`, { headers: apiHeaders(tenant), cache: "no-store" });
  // An unknown store or an API hiccup never turns a request into a 410.
  const rules = res.ok ? ((await res.json()) as { rules: GoneRule[] }).rules : [];
  rulesByStore.set(key, { rules, expires: Date.now() + RULES_TTL_MS });
  return rules;
}

function covered(path: string, rules: readonly GoneRule[]): boolean {
  return rules.some((r) => path === r.fromPath || (r.matchType === "prefix" && path.startsWith(`${r.fromPath}/`)));
}

/** The resolver's answer for the path: 410 only when no route serves it and a gone rule applies. */
async function confirmedGone(api: string, tenant: GoneTenant, request: NextRequest, path: string): Promise<{ locale: string; siteName: string } | null> {
  const params = new URLSearchParams(request.nextUrl.searchParams);
  params.set("path", path);
  const res = await fetch(`${api}/storefront/v1/route?${params.toString()}`, { headers: apiHeaders(tenant), cache: "no-store" });
  if (!res.ok) return null;
  const route = (await res.json()) as { status: number; locale: string; seo: { title: string } };
  return route.status === 410 ? { locale: route.locale, siteName: route.seo.title } : null;
}

/** The store's themed not-found page for the path, rendered by this process. */
async function renderNotFound(request: NextRequest): Promise<string | null> {
  const headers = new Headers(request.headers);
  headers.set(GONE_RENDER_HEADER, GONE_RENDER_TOKEN);
  headers.delete("content-length");
  const url = `http://127.0.0.1:${process.env.PORT ?? "3000"}${request.nextUrl.pathname}${request.nextUrl.search}`;
  try {
    const res = await fetch(url, { headers, cache: "no-store", redirect: "manual" });
    const type = res.headers.get("content-type") ?? "";
    return res.status === 404 && type.startsWith("text/html") ? await res.text() : null;
  } catch {
    return null;
  }
}

/** A plain page in the request language when the themed one cannot be rendered. */
function plainGonePage(locale: string, siteName: string, homePath: string): string {
  const { lang, dir } = htmlAttributes(locale);
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><html lang="${esc(lang)}" dir="${dir}"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(t(locale, "goneTitle"))} – ${esc(siteName)}</title></head><body style="font-family:system-ui;padding:4rem 1rem;text-align:center"><h1>${esc(t(locale, "goneTitle"))}</h1><p>${esc(t(locale, "goneBody"))}</p><p><a href="${esc(homePath)}">${esc(t(locale, "home"))}</a></p></body></html>`;
}

/**
 * The 410 response for a removed path, or null to let the request through. The proxy checks
 * public page requests only (GET/HEAD of public routes, not previews).
 */
export async function goneResponse(request: NextRequest, tenant: GoneTenant): Promise<NextResponse | null> {
  const api = apiUrl();
  if (!api) return null;
  const path = request.nextUrl.pathname.replace(/\/+$/, "") || "/";
  try {
    if (!covered(path, await goneRules(api, tenant))) return null;
    const gone = await confirmedGone(api, tenant, request, path);
    if (!gone) return null;
    const homePath = path.split("/")[1] === gone.locale ? `/${gone.locale}` : "/";
    const body = request.method === "HEAD" ? null : ((await renderNotFound(request)) ?? plainGonePage(gone.locale, gone.siteName, homePath));
    return new NextResponse(body, {
      status: 410,
      headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex", "cache-control": "public, max-age=0, must-revalidate" },
    });
  } catch {
    // The page itself still renders the not-found content (with 404) if the check fails.
    return null;
  }
}
