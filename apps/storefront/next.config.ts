import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // One deployment serves every store; images are served by Cloudflare Image Transformations.
  images: { unoptimized: true },
  output: "standalone",
};

export default nextConfig;
