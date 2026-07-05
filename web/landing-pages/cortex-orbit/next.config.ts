import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
// appRoot is platform/web/landing-pages/cortex-orbit — the bun-workspace root
// (platform/) is three levels up. Same pattern as the vorinthex app's
// next.config.ts, needed so Turbopack/Next don't mis-infer the workspace
// root from the multiple bun.lock files under web/landing-pages/*.
const workspaceRoot = path.resolve(appRoot, "../../..");

const nextConfig: NextConfig = {
  images: {},
  transpilePackages: ["@vorinthex/shared"],
  turbopack: {
    root: workspaceRoot,
  },
};

export default nextConfig;
