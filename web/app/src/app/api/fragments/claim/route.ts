import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { backendConfigured, backendFetch } from "@/lib/backend";
import { claimCollectible } from "@/lib/fragments/fragments-server";

const claimSchema = z.strictObject({
  collectibleId: z.string().min(1).max(120),
});

const EXPLORER_COOKIE = "vx_explorer";
const TEMP_EMAIL_HASH_COOKIE = "vx_temp_email_hash";

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

  const parsed = claimSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid claim." },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  let explorerId = cookieStore.get(EXPLORER_COOKIE)?.value;
  const tempEmailHash = cookieStore.get(TEMP_EMAIL_HASH_COOKIE)?.value;
  const isNewExplorer = !explorerId;
  if (!explorerId) {
    explorerId = crypto.randomUUID();
  }

  const result = claimCollectible(explorerId, parsed.data.collectibleId);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  // Persist the claim in the platform backend (durable ledger + SSE bump).
  // The local in-memory ledger stays authoritative for this session's UX
  // so a backend hiccup never breaks the treasure hunt.
  let globalTotal = result.globalTotal;
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
      globalTotal = upstream.data.total_fragments;
    }
  }

  const response = NextResponse.json({
    ok: true,
    name: result.collectible.name,
    rarity: result.collectible.rarity,
    fragmentsAwarded: result.fragmentsAwarded,
    balance: result.balance,
    globalTotal,
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
