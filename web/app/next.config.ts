import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
// appRoot is platform/web/app — the bun-workspace root (platform/) is two
// levels up, and Turbopack needs it to resolve hoisted monorepo deps.
const workspaceRoot = path.resolve(appRoot, "../..");

const nextConfig: NextConfig = {
  // @vorinthex/shared ships TypeScript source straight from the workspace.
  transpilePackages: ["@vorinthex/shared"],
  turbopack: {
    root: workspaceRoot,
  },
};

export default nextConfig;
