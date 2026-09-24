import { forwardToApi } from "@/lib/proxy-api";

export async function GET(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const t = new URL(request.url).searchParams.get("t") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(orderId) || !/^[\w-]{20,100}$/.test(t)) return Response.json({ error: { code: "not_found" } }, { status: 404 });
  return forwardToApi(request, `/storefront/v1/orders/${orderId}?t=${encodeURIComponent(t)}`, { method: "GET" });
}
