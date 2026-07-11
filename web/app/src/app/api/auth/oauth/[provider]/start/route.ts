import { NextResponse } from "next/server";
import { backendConfigured, backendFetch } from "@/lib/backend";
import { SITE_URL } from "@/lib/site";

const providers = new Set(["google", "apple"]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!providers.has(provider)) {
    return NextResponse.json({ error: "Unknown OAuth provider." }, { status: 404 });
  }
  // Never trust request.url's origin here: behind the ALB, Next's
  // trustHostHeader defaults to false, so it resolves to the container's
  // bind address (0.0.0.0:3000) instead of the real domain. The redirect
  // URI must also exactly match what's registered with Google/Apple, so
  // the canonical SITE_URL is the only correct source.
  const origin = SITE_URL;
  const redirectUri = `${origin}/api/auth/oauth/${provider}/callback`;

  if (!backendConfigured()) {
    return NextResponse.redirect(
      new URL(
        `/auth/oauth/callback?status=success&alias=${encodeURIComponent("Local Explorer")}&welcome=${encodeURIComponent("Welcome back, Local Explorer.")}`,
        origin,
      ),
    );
  }

  const result = await backendFetch<{ authorization_url?: string }>(
    `/auth/oauth/start?provider=${encodeURIComponent(provider)}&redirect_uri=${encodeURIComponent(redirectUri)}`,
  );
  if (!result.ok || !result.data?.authorization_url) {
    return NextResponse.redirect(
      new URL("/auth/oauth/callback?status=failed", origin),
    );
  }
  return NextResponse.redirect(result.data.authorization_url);
}
