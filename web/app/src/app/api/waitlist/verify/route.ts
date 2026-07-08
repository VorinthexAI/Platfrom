import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { backendConfigured, backendFetch } from "@/lib/backend";

const querySchema = z.strictObject({
  token_hash: z.string().regex(/^[a-f0-9]{64}$/),
});

const EXPLORER_COOKIE = "vx_explorer";

interface BackendVerifyResponse {
  ok: boolean;
  email: string;
  is_verified: boolean;
  alias?: string | null;
  waitlist_number?: number | null;
  welcome_line?: string | null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(
    Object.fromEntries(url.searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid verification link." },
      { status: 400 },
    );
  }

  if (backendConfigured()) {
    // Fragments collected anonymously in this browser (as its explorerId)
    // merge into the account the moment email ownership is proven.
    const explorerId = (await cookies()).get(EXPLORER_COOKIE)?.value;
    const query = new URLSearchParams({ token_hash: parsed.data.token_hash });
    if (explorerId) query.set("explorer_id", explorerId);
    const result = await backendFetch<BackendVerifyResponse>(
      `/waitlist/verify?${query.toString()}`,
    );
    if (!result.ok || !result.data) {
      return NextResponse.json(
        { ok: false, error: "This verification link is invalid or expired." },
        { status: result.status === 401 ? 401 : 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      email: result.data.email,
      isVerified: result.data.is_verified,
      alias: result.data.alias ?? null,
      waitlistNumber: result.data.waitlist_number ?? null,
      welcomeLine: result.data.welcome_line ?? null,
    });
  }

  // Frontend-only development: simulate a verified explorer.
  return NextResponse.json({
    ok: true,
    email: "explorer@vorinthex.dev",
    isVerified: true,
    alias: "Orbit Surfer",
    waitlistNumber: 188,
    welcomeLine:
      "Welcome, Orbit Surfer. You have joined a very exclusive club of people.",
  });
}
