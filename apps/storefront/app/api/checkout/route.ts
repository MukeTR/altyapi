import { forwardToApi } from "@/lib/proxy-api";
import { getCartToken } from "@/lib/cart-cookie";
import { getTenant } from "@/lib/tenant";

export async function POST(request: Request) {
  const token = await getCartToken();
  if (!token) return Response.json({ error: { code: "not_found", message_key: "errors.cart.not_found" } }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { provider?: string };
  const tenant = await getTenant();
  // Return URLs point back to the host the shopper is on (validated by the API).
  const proto = request.headers.get("x-forwarded-proto") ?? (process.env.APP_ENV === "local" ? "http" : "https");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? tenant.host;
  return forwardToApi(request, "/storefront/v1/checkout", {
    method: "POST",
    body: { ...(body.provider ? { provider: body.provider } : {}), returnBaseUrl: `${proto}://${host}` },
    extraHeaders: { "x-altyapi-cart-token": token },
  });
}
