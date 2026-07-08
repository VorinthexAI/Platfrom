import { NextResponse, type NextRequest } from "next/server";
import { getEntityBySubdomain } from "@/lib/galaxy/registry-helpers";

/**
 * Anchored experiences that are caves, not registry entities: hostnames
 * here rewrite straight to their page route, exactly like planets do —
 * `hunt.vorinthex.com` dives into the hunt asteroid the way
 * `orbit.vorinthex.com` enters the Orbit world.
 */
const CAVE_SUBDOMAIN_PATHS: Record<string, string> = {
  hunt: "/hunt",
};

function caveSubdomainPath(hostname: string): string | null {
  const host = hostname.split(":")[0] ?? "";
  const label = host.split(".")[0] ?? "";
  return CAVE_SUBDOMAIN_PATHS[label] ?? null;
}

/**
 * Campaign subdomain router: `atlas.vorinthex.com` and friends internally
 * rewrite to the entity's canonical path (the registry decides which
 * hostnames exist). Canonical URLs in metadata prevent duplicate-content
 * issues. Unknown hostnames pass through untouched.
 */
export function proxy(request: NextRequest) {
  const hostname = request.headers.get("host") ?? "";

  if (request.nextUrl.pathname === "/") {
    const cavePath = caveSubdomainPath(hostname);
    if (cavePath) {
      const url = request.nextUrl.clone();
      url.pathname = cavePath;
      return NextResponse.rewrite(url);
    }

    const entity = getEntityBySubdomain(hostname);
    if (entity) {
      const url = request.nextUrl.clone();
      url.pathname = entity.routes.path;
      return NextResponse.rewrite(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Skip static assets and API routes — only pages need subdomain mapping.
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
