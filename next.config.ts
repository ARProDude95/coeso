import type { NextConfig } from "next";
import { existsSync } from "node:fs";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Gives `next dev` the same bindings the deployed worker has (notably the D1
// database `DB`), so local development queries the same schema. The config is
// generated when the project is prepared for deployment, so guard for it.
// `NEXT_WRANGLER_CONFIG` lets CI (and quick local runs) use a minimal
// bindings-only config instead of the generated Sites one.
const LOCAL_WRANGLER_CONFIG =
  process.env.NEXT_WRANGLER_CONFIG?.trim() || "./freebuff.wrangler.jsonc";
if (existsSync(LOCAL_WRANGLER_CONFIG)) {
  initOpenNextCloudflareForDev({ configPath: LOCAL_WRANGLER_CONFIG });
}

// `next dev` blocks cross-origin requests to its HMR resources by default.
// The hosted preview loads the app from a different hostname, so pass that
// exact hostname in via the environment when starting the dev server.
const devOrigin = process.env.NEXT_DEV_ALLOWED_ORIGIN?.trim();

const nextConfig: NextConfig = {
  allowedDevOrigins: devOrigin ? [devOrigin] : [],
};

export default nextConfig;
