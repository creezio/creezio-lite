import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@creezio/brand-config", "@creezio/desktop-tooling"],
  // Ops console locale — pas d'export static (API routes + curl feeds).
  experimental: {
    serverActions: {
      bodySizeLimit: "1mb",
    },
  },
};

export default nextConfig;
