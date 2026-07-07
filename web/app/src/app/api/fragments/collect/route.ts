import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { backendConfigured, backendFetch } from "@/lib/backend";
import {
  collectCollectible,
  collectProceduralLoot,
} from "@/lib/fragments/fragments-server";

const meshSchema = z.strictObject({
  generator: z.string().min(1).max(60),
  seed: z.number().int(),
  variant: z.number().int().optional(),
  scale: z.number().optional(),
  params: z
    .record(z.string().max(40), z.union([z.number(), z.string().max(60)]))
    .optional(),
});

const collectSchema = z.strictObject({
  collectibleId: z.string().min(1).max(120),
  /** Mesh recipe for registry collectibles (exact-mesh persistence). */
  mesh: meshSchema.optional(),
  /** Procedural biome loot (floor fragments / center crystals). */
  loot: z
    .strictObject({
      kind: z.enum(["fragment", "crystal"]),
      name: z.string().min(1).max(120),
      rarity: z.string().min(1).max(40),
      fragments: z.number().int().min(1).max(1_000_000),
      mesh: meshSchema.optional(),
    })
    .optional(),
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

  const parsed = collectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid collect." },
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

  const { collectibleId, loot } = parsed.data;

  let outcome: { fragmentsAwarded: number; balance: number; globalTotal: number };
  let name: string;
  let rarity: string;
  if (loot) {
    const result = collectProceduralLoot(explorerId, {
      lootId: collectibleId,
      kind: loot.kind,
      name: loot.name,
      rarity: loot.rarity,
      fragments: loot.fragments,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }
    outcome = result;
    name = loot.name;
    rarity = loot.rarity;
  } else {
    const result = collectCollectible(explorerId, collectibleId);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }
    outcome = result;
    name = result.collectible.name;
    rarity = result.collectible.rarity;
  }
  const mesh = loot?.mesh ?? parsed.data.mesh;

  // Persist the collect in the platform backend (durable ledger + SSE bump).
  // The local in-memory ledger stays authoritative for this session's UX
  // so a backend hiccup never breaks the treasure hunt.
  let globalTotal = outcome.globalTotal;
  if (backendConfigured()) {
    const upstream = await backendFetch<{ total_fragments?: number }>(
      "/fragments",
      {
        method: "POST",
        body: JSON.stringify({
          collectible_id: collectibleId,
          explorer_id: explorerId,
          name,
          rarity,
          fragments: outcome.fragmentsAwarded,
          ...(mesh ? { mesh } : {}),
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
    name,
    rarity,
    fragmentsAwarded: outcome.fragmentsAwarded,
    balance: outcome.balance,
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
