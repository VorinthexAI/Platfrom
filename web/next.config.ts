import type { NextConfig } from "next";
import path from "node:path";

const workspaceRoot = path.resolve(process.cwd(), "..");

const nextConfig: NextConfig = {
  // Web Worker modules (§9.6, §37 of neural-map.md) are loaded via
  // `new Worker(new URL(...))` — Turbopack (Next 16's default bundler)
  // supports this natively via standard ESM `new URL(import.meta.url)`
  // worker syntax; no custom webpack `worker-loader` config is needed.

  // Binary tile responses (§11.1) and the WebSocket upgrade proxy (§11.4)
  // both require the Node.js runtime, not Edge — no route segment under
  // app/api/universe/** should ever set `export const runtime = "edge"`.

  images: {},

  outputFileTracingRoot: workspaceRoot,

  experimental: {
    // Required for `unauthorized()` (next/navigation) + the app/unauthorized.tsx
    // convention used by the DAL's verifySession() (neural-map.md §4.4).
    authInterrupts: true,
  },

  turbopack: {
    root: workspaceRoot,
    rules: {
      // GLSL shader sources (§30) are imported as raw strings (e.g.
      // `import frag from "./x.frag.glsl"`) by the universe engine's
      // materials — Turbopack's built-in `raw` module type handles this
      // with no external loader package needed. A per-import
      // `with { turbopackModuleType: "raw" }` attribute alone isn't
      // sufficient for an extension Turbopack has no built-in handling
      // for at all, hence this global rule.
      "*.glsl": { type: "raw" },
    },
  },

  // neural-map.md §55 — a starting-point CSP for `/console`, not a final
  // security-reviewed policy (flagged there as a Phase 6 hardening item,
  // e.g. replacing 'unsafe-inline' with a nonce once the styling
  // pipeline's exact needs are known). Pinned down here because Three.js's
  // worker usage (§9.6, §37) and the realtime WebSocket feed (§11.4) are
  // common sources of "works in dev, breaks in prod" CSP breakage if this
  // is left to a default/absent policy.
  async headers() {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
    const wsBase = process.env.NEXT_PUBLIC_WS_BASE_URL ?? "ws://localhost:4000";
    return [
      {
        source: "/console/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // §37's workers are created via `new Worker(new URL(...))`,
              // which some build configurations resolve through a blob:
              // URL — must be explicitly allowed or worker creation
              // silently fails in production only.
              "worker-src 'self' blob:",
              `connect-src 'self' ${apiBase} ${wsBase}`,
              // data: needed for the TOTP QR code image (§4.1) if ever
              // inlined rather than fetched as a URL.
              "img-src 'self' data:",
              // Tailwind v4 relies on inline styles for some utilities;
              // tighten to a nonce-based approach if that changes.
              "style-src 'self' 'unsafe-inline'",
              "script-src 'self'",
            ].join("; "),
          },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
