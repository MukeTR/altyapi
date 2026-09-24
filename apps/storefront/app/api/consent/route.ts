import { forwardToApi } from "@/lib/proxy-api";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: { code: "bad_request", message_key: "errors.bad_request" } }, { status: 400 });
  return forwardToApi(request, "/storefront/v1/consent", { method: "POST", body });
}
