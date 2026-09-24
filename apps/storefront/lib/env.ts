import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

/** Server-side configuration. None of these values are exposed to the browser. */
export const serverEnv = {
  apiUrl: () => (process.env.API_INTERNAL_URL || required("API_URL")).replace(/\/$/, ""),
  storefrontApiSecret: () => required("STOREFRONT_API_SECRET"),
  edgeRoutingSecret: () => required("EDGE_ROUTING_SECRET"),
  appEnv: () => process.env.APP_ENV ?? "local",
  mediaBaseUrl: () => process.env.MEDIA_PUBLIC_BASE_URL ?? null,
};
