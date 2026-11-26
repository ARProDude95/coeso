import { resolve } from "node:path";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

// The board reads its data from the Cloudflare D1 binding, so `next dev` needs
// the same bindings the Worker gets. Scoped to development: during a build this
// would start the local Workers runtime, which the deploy build must not do.
if (process.env.NODE_ENV === "development") {
  initOpenNextCloudflareForDev({ configPath: "./freebuff.wrangler.jsonc" });
}

const nextConfig: NextConfig = {
  // This project lives beside another Next app with its own lockfile. Scope
  // file tracing to this directory so the build does not walk the monorepo.
  outputFileTracingRoot: resolve(process.cwd()),
};

export default nextConfig;
