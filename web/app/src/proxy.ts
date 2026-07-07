import { NextResponse, type NextRequest } from "next/server";
import { getEntityBySubdomain } from "@/lib/galaxy/registry-helpers";

/**
 * Campaign subdomain router: `atlas.vorinthex.com` and friends internally
 * rewrite to the entity's canonical path (the registry decides which
 * hostnames exist). Canonical URLs in metadata prevent duplicate-content
 * issues. Unknown hostnames pass through untouched.
 */
export function proxy(request: NextRequest) {
  const hostname = request.headers.get("host") ?? "";
  const entity = getEntityBySubdomain(hostname);

  if (entity && request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = entity.routes.path;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  // Skip static assets and API routes — only pages need subdomain mapping.
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
