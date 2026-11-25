import { resolve } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This project lives beside another Next app with its own lockfile. Scope
  // file tracing to this directory so the build does not walk the monorepo.
  outputFileTracingRoot: resolve(process.cwd()),
};

export default nextConfig;
