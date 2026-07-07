import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { backendConfigured, backendFetch } from "@/lib/backend";
import { emailSchema } from "@/lib/email";
import { collectCollectible } from "@/lib/fragments/fragments-server";

const membersSchema = z.strictObject({
  email: emailSchema,
  /** Treasure carried into the sign-in ("Already on waitlist? Sign in"). */
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
 * Members sign-in: requests a short-lived magic link from the backend.
 * The response is deliberately identical for unknown members, but production
 * must not claim success if the backend bridge itself is unavailable.
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

  const parsed = membersSchema.safeParse(body);
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

  const result = await backendFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: parsed.data.email }),
  });

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

  const response = NextResponse.json({ ok: true, collect });
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
