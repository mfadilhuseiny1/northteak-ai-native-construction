import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  // Everything reaches the API through this proxy, whose defaults are 10 MB and 30 seconds: a drawing set is bigger, and a long specification takes longer to read. The API allows 64 MB.
  experimental: { proxyClientMaxBodySize: "70mb", proxyTimeout: 10 * 60 * 1000 },
  // the swarm's API (python -m swarm.firm_api)
  async rewrites() {
    return [{ source: "/api/:path*", destination: "http://127.0.0.1:8300/api/:path*" }];
  },
};

export default nextConfig;
