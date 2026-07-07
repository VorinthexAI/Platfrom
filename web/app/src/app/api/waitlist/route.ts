import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { backendConfigured, backendFetch } from "@/lib/backend";
import { emailSchema } from "@/lib/email";
import { claimCollectible } from "@/lib/fragments/fragments-server";

const waitlistSchema = z.strictObject({
  email: emailSchema,
  /** Treasure the visitor is claiming by joining ("Join Waitlist to claim"). */
  collectibleId: z.string().min(1).max(120).optional(),
});

const EXPLORER_COOKIE = "vx_explorer";
const TEMP_EMAIL_HASH_COOKIE = "vx_temp_email_hash";

interface BackendWaitlistResponse {
  email: string;
  isVerified: boolean;
  alias?: string | null;
  waitlist_number?: number | null;
  verificationEmailSent?: boolean;
  expiresAt?: string;
  devVerifyLink?: string;
}

interface ClaimPayload {
  ok: boolean;
  fragmentsAwarded?: number;
  balance?: number;
  globalTotal?: number;
  error?: string;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const parsed = waitlistSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Use a valid email address." },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  let explorerId = cookieStore.get(EXPLORER_COOKIE)?.value;
  const isNewExplorer = !explorerId;
  if (!explorerId) {
    explorerId = crypto.randomUUID();
  }
  // Presence distinct-id (1-day cookie): lets the backend hand the
  // visitor's galaxy alias over to the new user account.
  const distinctId = cookieStore.get("vx_did")?.value;
  const tempEmailHash = cookieStore.get(TEMP_EMAIL_HASH_COOKIE)?.value;

  // Claim the carried treasure for this explorer right away — the node is
  // stored before the email is ever verified. Different explorers may
  // claim the same treasure; the same explorer never claims twice (the
  // ledger and the backend's unique index both enforce it).
  let claim: ClaimPayload | null = null;
  if (parsed.data.collectibleId) {
    const result = claimCollectible(explorerId, parsed.data.collectibleId);
    if (result.ok) {
      claim = {
        ok: true,
        fragmentsAwarded: result.fragmentsAwarded,
        balance: result.balance,
        globalTotal: result.globalTotal,
      };
      if (backendConfigured()) {
        const upstream = await backendFetch<{ total_fragments?: number }>(
          "/fragments",
          {
            method: "POST",
            body: JSON.stringify({
              collectible_id: parsed.data.collectibleId,
              explorer_id: explorerId,
              name: result.collectible.name,
              rarity: result.collectible.rarity,
              fragments: result.fragmentsAwarded,
              ...(tempEmailHash ? { temp_email_hash: tempEmailHash } : {}),
            }),
          },
        );
        if (upstream.ok && upstream.data?.total_fragments !== undefined) {
          claim.globalTotal = upstream.data.total_fragments;
        }
      }
    } else {
      claim = { ok: false, error: result.error };
    }
  }

  let payload: Record<string, unknown>;
  if (backendConfigured()) {
    const result = await backendFetch<BackendWaitlistResponse>("/waitlist", {
      method: "POST",
      body: JSON.stringify({
        email: parsed.data.email,
        explorer_id: explorerId,
        ...(distinctId ? { distinct_id: distinctId } : {}),
        ...(tempEmailHash ? { temp_email_hash: tempEmailHash } : {}),
      }),
    });
    if (!result.ok || !result.data) {
      return NextResponse.json(
        { ok: false, error: "Could not reach the Nexus. Try again." },
        { status: 502 },
      );
    }
    payload = {
      ok: true,
      isVerified: result.data.isVerified,
      alias: result.data.alias ?? null,
      waitlistNumber: result.data.waitlist_number ?? null,
      claim,
    };
  } else {
    // Frontend-only development: accept the signup so the cave flow completes.
    payload = {
      ok: true,
      isVerified: false,
      alias: null,
      waitlistNumber: null,
      claim,
    };
  }

  const response = NextResponse.json(payload);
  if (isNewExplorer) {
    response.cookies.set(EXPLORER_COOKIE, explorerId, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
  }
  return response;
}
