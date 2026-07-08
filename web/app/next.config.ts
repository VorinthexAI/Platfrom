import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
// appRoot is platform/web/app — the bun-workspace root (platform/) is two
// levels up, and Turbopack needs it to resolve hoisted monorepo deps.
const workspaceRoot = path.resolve(appRoot, "../..");

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone/server.js) so the
  // Docker runner needs neither node_modules nor the source tree at runtime.
  output: "standalone",
  // Trace hoisted monorepo deps + @vorinthex/shared from the workspace root
  // (same value turbopack.root uses) so standalone tracing pulls them in.
  outputFileTracingRoot: workspaceRoot,
  // @vorinthex/shared ships TypeScript source straight from the workspace.
  transpilePackages: ["@vorinthex/shared"],
  // One logo image; skip the sharp-based optimizer so the image stays ARM-clean.
  images: {
    unoptimized: true,
  },
  turbopack: {
    root: workspaceRoot,
  },
};

export default nextConfig;
