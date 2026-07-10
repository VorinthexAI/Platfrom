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

const signinSchema = z.strictObject({
  email: emailSchema,
  /** Treasure carried into the sign-in ("Already hunting? Sign in"). */
  collectibleId: z.string().min(1).max(120).optional(),
});
const EXPLORER_COOKIE = "vx_explorer";
const isProduction = process.env.NODE_ENV === "production";

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

interface CollectPayload {
  ok: boolean;
  fragmentsAwarded?: number;
  balance?: number;
  globalTotal?: number;
  error?: string;
}

/**
 * Sign-in: requests a short-lived magic link from the backend. Explorers
 * get a direct session link; platform members are routed by the backend
 * into their TOTP flow. The response is deliberately identical for unknown
 * emails, but production must not claim success if the backend bridge
 * itself is unavailable.
 *
 * A carried collectible is stored IMMEDIATELY — with the email's hash so
 * the backend attaches it straight to the signing-in user. The fragment
 * is never lost, even if they abandon the magic link.
 */
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

  const parsed = signinSchema.safeParse(body);
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

  // Store the carried treasure right away, keyed to the sign-in email.
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
              email_hash: await sha256Hex(parsed.data.email),
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

  if (!backendConfigured()) {
    if (isProduction) {
      return NextResponse.json(
        { ok: false, error: "Members sign-in is temporarily unavailable." },
        { status: 503 },
      );
    }
    const devResponse = NextResponse.json({ ok: true, collect });
    setHandoffCookies(
      devResponse,
      randomDecoyHandoff(),
      new Date(Date.now() + 35 * 60 * 1000),
    );
    if (isNewExplorer) {
      devResponse.cookies.set(EXPLORER_COOKIE, explorerId, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365,
        path: "/",
      });
    }
    return devResponse;
  }

  const result = await backendFetch<{
    founders_gate_required?: boolean;
    action?: string;
    organization_mfa_required?: boolean;
    status?: "totp_setup_required" | "totp_required";
    totp_challenge_token_hash?: string;
    name?: string | null;
    organization_title?: string | null;
    handoff_token_hash?: string;
    handoff_expires_at?: string;
  }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: parsed.data.email }),
  });

  if (!result.ok && result.status === 403 && result.data?.founders_gate_required) {
    return NextResponse.json(
      {
        ok: false,
        collect,
        founders_gate_required: true,
        error: "Founders enter through the sun.",
      },
      { status: 403 },
    );
  }

  if (!result.ok && result.status !== 403) {
    console.error("members sign-in backend request failed", {
      status: result.status,
    });
    if (isProduction) {
      return NextResponse.json(
        { ok: false, error: "Could not send a sign-in link. Try again." },
        { status: 502 },
      );
    }
  }

  if (
    result.ok &&
    result.data?.organization_mfa_required &&
    result.data.status &&
    result.data.totp_challenge_token_hash
  ) {
    const response = NextResponse.json({
      ok: true,
      collect,
      organization_mfa_required: true,
      status: result.data.status,
      totp_challenge_token_hash: result.data.totp_challenge_token_hash,
      name: result.data.name ?? null,
      title: result.data.organization_title ?? null,
    });
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

  const response = NextResponse.json({ ok: true, collect });
  // Park the cross-device handoff secret. Unknown emails get a decoy so
  // the response — headers included — never reveals who exists.
  const handoff = result.data?.handoff_token_hash;
  const handoffExpiresAt = result.data?.handoff_expires_at
    ? new Date(result.data.handoff_expires_at)
    : new Date(Date.now() + 35 * 60 * 1000);
  setHandoffCookies(response, handoff ?? randomDecoyHandoff(), handoffExpiresAt);
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
