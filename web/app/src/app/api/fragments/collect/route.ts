import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { backendConfigured, backendFetch } from "@/lib/backend";
import {
  collectCollectible,
  collectProceduralLoot,
  getCollectible,
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
const ACCESS_COOKIE = "vorinthex_access";

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
  const accessToken = cookieStore.get(ACCESS_COOKIE)?.value;
  const isNewExplorer = !explorerId;
  if (!explorerId) {
    explorerId = crypto.randomUUID();
  }

  const { collectibleId, loot } = parsed.data;

  // Resolve the piece's identity + value up front so the collect can be
  // persisted to the durable backend even when the in-memory debounce
  // rejects it — no collected value is ever silently dropped.
  let name: string;
  let rarity: string;
  let fragments: number;
  if (loot) {
    name = loot.name;
    rarity = loot.rarity;
    fragments = loot.fragments;
  } else {
    const def = getCollectible(collectibleId);
    if (!def) {
      return NextResponse.json(
        { ok: false, error: "Unknown collectible." },
        { status: 404 },
      );
    }
    if (!def.isLive || !def.isCollectible) {
      return NextResponse.json(
        { ok: false, error: "This fragment cannot be collected yet." },
        { status: 409 },
      );
    }
    name = def.name;
    rarity = def.rarity;
    fragments = def.fragments;
  }
  const mesh = loot?.mesh ?? parsed.data.mesh;

  // In-memory ledger = optimistic session outcome + same-instance rapid-click
  // debounce. Its rejection (429 cooldown / 409 replayed id) no longer skips
  // the durable persist below.
  const memResult = loot
    ? collectProceduralLoot(explorerId, {
        lootId: collectibleId,
        kind: loot.kind,
        name,
        rarity,
        fragments,
      })
    : collectCollectible(explorerId, collectibleId);

  // Persist to the platform backend regardless of the in-memory result — its
  // unique (explorerId, collectibleId) index is the real dedupe authority, so
  // a backend 409 is idempotent success. Only genuine bad input (400) skips it.
  const shouldPersist =
    memResult.ok || memResult.status === 409 || memResult.status === 429;
  let globalTotal = memResult.ok ? memResult.globalTotal : 0;
  if (shouldPersist && backendConfigured()) {
    const upstream = await backendFetch<{ total_fragments?: number }>(
      "/fragments",
      {
        method: "POST",
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        body: JSON.stringify({
          collectible_id: collectibleId,
          explorer_id: explorerId,
          name,
          rarity,
          fragments,
          ...(mesh ? { mesh } : {}),
          ...(tempEmailHash ? { temp_email_hash: tempEmailHash } : {}),
        }),
      },
    );
    if (upstream.ok && upstream.data?.total_fragments !== undefined) {
      globalTotal = upstream.data.total_fragments;
    }
  }

  if (!memResult.ok) {
    // The piece is now durably persisted (if the backend is configured), but
    // the in-memory debounce rejected this click — reflect that so the client
    // doesn't optimistically double-count. It surfaces on the next hydrate.
    return NextResponse.json(
      { ok: false, error: memResult.error },
      { status: memResult.status },
    );
  }

  const response = NextResponse.json({
    ok: true,
    name,
    rarity,
    fragmentsAwarded: memResult.fragmentsAwarded,
    balance: memResult.balance,
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
