import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No browser source maps in production builds — they bloat the deploy and
  // expose source to anyone with devtools open.
  productionBrowserSourceMaps: false,
  compiler: {
    // Strip `console.*` calls from the production bundle.
    removeConsole: process.env.NODE_ENV === "production",
  },
  experimental: {
    // Tree-shake barrel imports so the ~100 individual Lucide icon imports and
    // radix-ui re-exports only ship the symbols actually used.
    optimizePackageImports: ["lucide-react", "radix-ui"],
  },
};

export default nextConfig;
