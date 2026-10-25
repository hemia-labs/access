import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  async rewrites() {
    const api = process.env.ACCESS_API_URL ?? "http://localhost:3019";
    return ["/v1/:path*", "/health/:path*", "/.well-known/:path*"].map(
      (source) => ({ source, destination: `${api}${source}` })
    );
  },
};

export default nextConfig;
