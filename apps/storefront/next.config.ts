import type { NextConfig } from "next";

// Local development serves each store on its own host under the platform root domain
// (proxy.ts maps the request host to the store). The dev server only allows its own host to
// load dev assets and the HMR connection, so store hosts are allowed explicitly; without this
// the page renders but never hydrates. Development only: production ignores it.
const storeRootDomain = process.env.STORE_ROOT_DOMAIN ?? "altyapi.store";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // One deployment serves every store; images are served by Cloudflare Image Transformations.
  images: { unoptimized: true },
  output: "standalone",
  allowedDevOrigins: [`*.${storeRootDomain}`],
};

export default nextConfig;
