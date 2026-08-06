import { buildAndroidAssetLinks } from "@/lib/app-links";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(buildAndroidAssetLinks(process.env.ANDROID_APP_CERTIFICATE_SHA256), {
    headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
  });
}
