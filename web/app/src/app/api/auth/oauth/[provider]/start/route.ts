import { NextResponse } from "next/server";
import { backendConfigured, backendFetch } from "@/lib/backend";

const providers = new Set(["google", "apple"]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!providers.has(provider)) {
    return NextResponse.json({ error: "Unknown OAuth provider." }, { status: 404 });
  }
  const origin = new URL(request.url).origin;
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
