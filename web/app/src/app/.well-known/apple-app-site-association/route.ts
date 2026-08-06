import { buildAppleAppSiteAssociation } from "@/lib/app-links";

export const dynamic = "force-static";

export function GET() {
  return Response.json(buildAppleAppSiteAssociation(), {
    headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
  });
}
