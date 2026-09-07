import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appLinkHeaderSources } from "./src/lib/app-links";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
// appRoot is platform/web/app — the bun-workspace root (platform/) is two
// levels up, and Turbopack needs it to resolve hoisted monorepo deps.
const workspaceRoot = path.resolve(appRoot, "../..");

export function getPermanentRedirects() {
  return [{ source: "/core", destination: "/", permanent: true }];
}

export function getSecurityHeaders(blockIndexing = false) {
  const headers = [
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
  ];

  if (blockIndexing) {
    headers.push({ key: "X-Robots-Tag", value: "noindex, nofollow" });
  }

  return headers;
}

export function getCheckoutHeaders() {
  return [
    { key: "Cache-Control", value: "no-store, max-age=0" },
    { key: "Pragma", value: "no-cache" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, nocache" },
    {
      key: "Content-Security-Policy",
      value: "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; form-action 'none'; img-src 'self' data:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
    },
  ];
}

export function getPrivateAuthHeaders() {
  return [
    { key: "Cache-Control", value: "private, no-store, max-age=0" },
    { key: "Pragma", value: "no-cache" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, nocache" },
    {
      key: "Content-Security-Policy",
      value: "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
    },
  ];
}

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone/server.js) so the
  // Docker runner needs neither node_modules nor the source tree at runtime.
  output: "standalone",
  // Trace hoisted monorepo deps + @vorinthex/shared from the workspace root
  // (same value turbopack.root uses) so standalone tracing pulls them in.
  outputFileTracingRoot: workspaceRoot,
  // @vorinthex/shared ships TypeScript source straight from the workspace.
  transpilePackages: ["@vorinthex/shared"],
  poweredByHeader: false,
  // One logo image; skip the sharp-based optimizer so the image stays ARM-clean.
  images: {
    unoptimized: true,
  },
  turbopack: {
    root: workspaceRoot,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: getSecurityHeaders(
          process.env.NEXT_PUBLIC_BLOCK_INDEXING === "true",
        ),
      },
      {
        source: "/checkout/:path*",
        headers: getCheckoutHeaders(),
      },
      {
        source: "/admin/:path*",
        headers: getPrivateAuthHeaders(),
      },
      {
        source: "/auth/mfa/:path*",
        headers: getPrivateAuthHeaders(),
      },
      ...appLinkHeaderSources().map((source) => ({ source, headers: getPrivateAuthHeaders() })),
    ];
  },
  redirects: getPermanentRedirects,
};

export default nextConfig;
