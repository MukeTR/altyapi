import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

/** Server-side configuration. None of these values are exposed to the browser. */
export const serverEnv = {
  /** Admin API base URL (API_INTERNAL_URL wins so deployments can use a private address). */
  apiUrl: () => (process.env.API_INTERNAL_URL || required("API_URL")).replace(/\/$/, ""),
  appEnv: () => process.env.APP_ENV ?? "local",
  /** Session and preference cookies are Secure everywhere except local development over http. */
  secureCookies: () => (process.env.APP_ENV ?? "local") !== "local",
  /** Name of the API's own session cookie, read from its Set-Cookie on login and register. */
  apiSessionCookieName: () => process.env.SESSION_COOKIE_NAME || "altyapi_session",
  storeRootDomain: () => process.env.STORE_ROOT_DOMAIN || "altyapi.store",
  /**
   * Storefront origin for a hostname: "{host}" is replaced by the store's hostname. Production
   * uses the default https://{host}; local development can point at the dev storefront, e.g.
   * "http://{host}:3001".
   */
  storefrontOriginTemplate: () => process.env.STOREFRONT_ORIGIN_TEMPLATE || "https://{host}",
  apiTimeoutMs: () => Number(process.env.ADMIN_API_TIMEOUT_MS) || 15_000,
  /**
   * Number of reverse proxies in front of the admin that append the client address to
   * X-Forwarded-For (load balancer, ingress). The client IP is read from the entry the outermost
   * of them wrote, never from what the browser sent. Default 1.
   */
  trustedProxyHops: () => {
    const raw = process.env.ADMIN_TRUSTED_PROXY_HOPS;
    const n = raw === undefined || raw === "" ? 1 : Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= 10 ? n : 1;
  },
};

export function storefrontOrigin(hostname: string): string {
  return serverEnv.storefrontOriginTemplate().replace("{host}", hostname).replace(/\/$/, "");
}
