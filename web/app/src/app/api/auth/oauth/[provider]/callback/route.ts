import { NextResponse } from "next/server";
import { backendConfigured, backendFetch } from "@/lib/backend";
import { SITE_URL } from "@/lib/site";

const ACCESS_COOKIE = "vorinthex_access";
const REFRESH_COOKIE = "vorinthex_refresh";
const providers = new Set(["google", "apple"]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const url = new URL(request.url);
  // Same fix as the start route: request.url's origin is unreliable behind
  // the reverse proxy (resolves to 0.0.0.0:3000), so redirects and the
  // redirect_uri sent to the backend must use the canonical SITE_URL
  // instead.
  const origin = SITE_URL;
  if (!providers.has(provider)) {
    return NextResponse.redirect(new URL("/auth/oauth/callback?status=failed&reason=unknown_provider", origin));
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    // The provider itself redirected here without a code — typically the
    // visitor cancelled the consent screen, or (if this shows up
    // repeatedly) the redirect_uri registered with the provider doesn't
    // match what we send, so it's bouncing us back some other way.
    const providerError = url.searchParams.get("error");
    console.error(
      `[oauth/callback] missing code/state for ${provider}: provider_error=${providerError}`,
    );
    return NextResponse.redirect(
      new URL(`/auth/oauth/callback?status=failed&reason=${providerError ? "provider_denied" : "missing_params"}`, origin),
    );
  }

  if (!backendConfigured()) {
    return NextResponse.redirect(
      new URL(
        `/auth/oauth/callback?status=success&alias=${encodeURIComponent("Local Explorer")}&welcome=${encodeURIComponent("Welcome back, Local Explorer.")}`,
        origin,
      ),
    );
  }

  const redirectUri = `${origin}/api/auth/oauth/${provider}/callback`;
  const result = await backendFetch<{
    access_token?: string;
    refresh_token?: string;
    alias?: string | null;
    alias_slug?: string | null;
    waitlist_number?: number | null;
    welcome_line?: string | null;
  }>("/auth/oauth/callback", {
    method: "POST",
    body: JSON.stringify({ provider, code, state, redirect_uri: redirectUri }),
  });

  if (!result.ok || !result.data) {
    console.error(
      `[oauth/callback] backend rejected ${provider} exchange: status=${result.status} data=${JSON.stringify(result.data)}`,
    );
    const reason = result.status === 503 ? "provider_not_configured" : "exchange_failed";
    return NextResponse.redirect(
      new URL(`/auth/oauth/callback?status=failed&reason=${reason}`, origin),
    );
  }

  const doneUrl = new URL("/auth/oauth/callback", origin);
  doneUrl.searchParams.set("status", "success");
  if (result.data.alias) doneUrl.searchParams.set("alias", result.data.alias);
  if (result.data.alias_slug) doneUrl.searchParams.set("alias_slug", result.data.alias_slug);
  if (result.data.waitlist_number) doneUrl.searchParams.set("waitlist_number", String(result.data.waitlist_number));
  if (result.data.welcome_line) doneUrl.searchParams.set("welcome", result.data.welcome_line);

  const response = NextResponse.redirect(doneUrl);
  const secure = process.env.NODE_ENV === "production";
  if (result.data.access_token) {
    response.cookies.set(ACCESS_COOKIE, result.data.access_token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 60 * 60,
    });
  }
  if (result.data.refresh_token) {
    response.cookies.set(REFRESH_COOKIE, result.data.refresh_token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return response;
}
