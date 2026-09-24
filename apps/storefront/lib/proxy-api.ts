import "server-only";
import { serverEnv } from "./env";
import { getTenant } from "./tenant";

/**
 * Forwards a browser request (cart, newsletter, checkout) to the Storefront API with the
 * internal key and tenant, adding the client IP/UA the API needs for rate limits and
 * consent evidence. Only JSON bodies are forwarded.
 */
export async function forwardToApi(request: Request, apiPath: string, init: { method: string; body?: unknown; extraHeaders?: Record<string, string> }) {
  const tenant = await getTenant();
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const res = await fetch(`${serverEnv.apiUrl()}${apiPath}`, {
    method: init.method,
    headers: {
      "content-type": "application/json",
      "x-altyapi-storefront-key": serverEnv.storefrontApiSecret(),
      ...(tenant.storeId ? { "x-altyapi-store-id": tenant.storeId } : tenant.devHost ? { "x-altyapi-dev-host": tenant.devHost } : {}),
      "x-altyapi-client-ip": ip,
      "x-altyapi-client-ua": request.headers.get("user-agent") ?? "",
      ...(init.extraHeaders ?? {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    cache: "no-store",
  });
  const text = await res.text();
  return new Response(text || null, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
}
