import { forwardToApi } from "@/lib/proxy-api";
import { clearCartToken, getCartToken, setCartToken } from "@/lib/cart-cookie";

/**
 * Browser → Storefront API bridge for cart operations. The cart token lives only in an
 * httpOnly cookie; only an allow-list of cart endpoints is forwarded.
 */
const ALLOWED: Record<string, RegExp> = {
  GET: /^(|shipping-rates)$/,
  POST: /^(lines|coupons)$/,
  PATCH: /^lines\/[0-9a-f-]{36}$/,
  PUT: /^(contact|addresses|shipping-rate|attribution)$/,
  DELETE: /^coupons\/[A-Za-z0-9_-]{2,64}$/,
};

async function handle(request: Request, params: Promise<{ path?: string[] }>) {
  const { path = [] } = await params;
  const sub = path.join("/");
  const method = request.method.toUpperCase();
  if (!ALLOWED[method]?.test(sub)) return Response.json({ error: { code: "not_found", message_key: "errors.route_not_found" } }, { status: 404 });

  let token = await getCartToken();
  const body = method === "GET" || method === "DELETE" ? undefined : await request.json().catch(() => ({}));
  const apiPath = `/storefront/v1/cart${sub ? `/${sub}` : ""}`;

  if (!token) {
    // Reading an absent cart returns an empty one without creating it.
    if (method === "GET") return Response.json({ cart: null });
    const created = await forwardToApi(request, "/storefront/v1/carts", { method: "POST", body: {} });
    if (!created.ok) return created;
    const payload = (await created.json()) as { token: string };
    token = payload.token;
    await setCartToken(token);
  }
  const res = await forwardToApi(request, apiPath, { method, ...(body !== undefined ? { body } : {}), extraHeaders: { "x-altyapi-cart-token": token } });
  if (res.status === 404 && method === "GET" && sub === "") {
    await clearCartToken();
    return Response.json({ cart: null });
  }
  if (method === "GET" && sub === "" && res.ok) return Response.json({ cart: await res.json() });
  return res;
}

export async function GET(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  return handle(req, ctx.params);
}
export async function POST(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  return handle(req, ctx.params);
}
export async function PATCH(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  return handle(req, ctx.params);
}
export async function PUT(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  return handle(req, ctx.params);
}
export async function DELETE(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  return handle(req, ctx.params);
}
