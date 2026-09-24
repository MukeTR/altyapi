import { forwardToApi } from "@/lib/proxy-api";

export async function GET(request: Request) {
  return forwardToApi(request, "/storefront/v1/payment-methods", { method: "GET" });
}
