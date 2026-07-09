import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { backendConfigured, backendFetch } from "@/lib/backend";
import {
  randomDecoyHandoff,
  setHandoffCookies,
} from "@/lib/auth/handoff-cookies";
import { emailSchema } from "@/lib/email";
import { collectCollectible } from "@/lib/fragments/fragments-server";

const waitlistSchema = z.strictObject({
  email: emailSchema,
  /** Treasure the visitor is collecting by joining ("Join Waitlist to collect"). */
  collectibleId: z.string().min(1).max(120).optional(),
});

const EXPLORER_COOKIE = "vx_explorer";
const TEMP_EMAIL_HASH_COOKIE = "vx_temp_email_hash";
const isProduction = process.env.NODE_ENV === "production";

interface BackendWaitlistResponse {
  email: string;
  isVerified: boolean;
  alias?: string | null;
  alias_slug?: string | null;
  waitlist_number?: number | null;
  verificationEmailSent?: boolean;
  signInEmailSent?: boolean;
  expiresAt?: string;
  handoffTokenHash?: string;
  handoffExpiresAt?: string;
  devVerifyLink?: string;
}

interface CollectPayload {
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

  // Collect the carried treasure for this explorer right away — the node is
  // stored before the email is ever verified. Different explorers may
  // collect the same treasure; the same explorer never collects twice (the
  // ledger and the backend's unique index both enforce it).
  let collect: CollectPayload | null = null;
  if (parsed.data.collectibleId) {
    const result = collectCollectible(explorerId, parsed.data.collectibleId);
    if (result.ok) {
      collect = {
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
          collect.globalTotal = upstream.data.total_fragments;
        }
      }
    } else {
      collect = { ok: false, error: result.error };
    }
  }

  let payload: Record<string, unknown>;
  let handoff: { hash: string; expiresAt: Date } | null = null;
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
      signInEmailSent: result.data.signInEmailSent ?? false,
      alias: result.data.alias ?? null,
      aliasSlug: result.data.alias_slug ?? null,
      waitlistNumber: result.data.waitlist_number ?? null,
      collect,
    };
    if (result.data.handoffTokenHash) {
      handoff = {
        hash: result.data.handoffTokenHash,
        expiresAt: result.data.handoffExpiresAt
          ? new Date(result.data.handoffExpiresAt)
          : new Date(Date.now() + 12 * 60 * 60 * 1000),
      };
    }
  } else {
    if (isProduction) {
      return NextResponse.json(
        { ok: false, error: "Waitlist signup is temporarily unavailable." },
        { status: 503 },
      );
    }
    // Frontend-only development: accept the signup so the cave flow completes.
    payload = {
      ok: true,
      isVerified: false,
      alias: null,
      aliasSlug: null,
      waitlistNumber: null,
      collect,
    };
  }

  const response = NextResponse.json(payload);
  // Park the cross-device handoff: verifying from any surface signs THIS
  // browser in. Already-verified joins get a decoy so headers stay uniform.
  setHandoffCookies(
    response,
    handoff?.hash ?? randomDecoyHandoff(),
    handoff?.expiresAt ?? new Date(Date.now() + 12 * 60 * 60 * 1000),
  );
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
