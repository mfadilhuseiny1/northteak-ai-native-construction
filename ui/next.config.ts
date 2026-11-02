import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  // the swarm's API (python -m swarm.firm_api)
  async rewrites() {
    return [{ source: "/api/:path*", destination: "http://127.0.0.1:8300/api/:path*" }];
  },
};

export default nextConfig;
