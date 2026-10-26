import type { NextConfig } from "next";

// Build identity, inlined into both the client and server bundles at build
// time so `/api/version` and the running page can be compared (see
// `components/lacquer/update-prompt.client.tsx`). Vercel provides both
// system env vars at build time; the deployment ID changes on every deploy
// (including a redeploy of the same commit), the commit SHA is the fallback.
const buildId =
  process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "development";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
  },
};

export default nextConfig;
