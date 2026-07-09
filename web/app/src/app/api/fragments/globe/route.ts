import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { backendConfigured, backendFetch } from "@/lib/backend";
import { getProgress } from "@/lib/fragments/fragments-server";
import { hashString, mulberry32 } from "@/lib/three/procedural";

const EXPLORER_COOKIE = "vx_explorer";
const ACCESS_COOKIE = "vorinthex_access";

interface ThreePayload {
  points: Array<[number, number, number]>;
  colors: Array<[number, number, number]>;
  meta: Array<{
    key: string;
    label: string | null;
    /** Persisted mesh recipe — lets the jar render the exact collected crystal. */
    mesh?: Record<string, unknown> | null;
  }>;
}

/**
 * The explorer's collected fragments formatted for three.js — the neural
 * globe on /galaxy/public. Backed by the platform backend's canonical
 * node→three formatter; falls back to a locally generated constellation
 * from the in-memory ledger in frontend-only development.
 */
export async function GET() {
  const cookieStore = await cookies();
  const explorerId = cookieStore.get(EXPLORER_COOKIE)?.value;
  const accessToken = cookieStore.get(ACCESS_COOKIE)?.value;

  if (backendConfigured()) {
    const params = new URLSearchParams({ format: "three" });
    if (explorerId) params.set("explorer_id", explorerId);
    const result = await backendFetch<{
      global_total: number;
      explorer: { balance: number; collected: string[] } | null;
      three?: ThreePayload;
    }>(`/fragments/summary?${params.toString()}`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
    if (result.ok && result.data) {
      return NextResponse.json({
        ok: true,
        balance: result.data.explorer?.balance ?? 0,
        collected: result.data.explorer?.collected ?? [],
        globalTotal: result.data.global_total,
        three: result.data.three ?? { points: [], colors: [], meta: [] },
      });
    }
  }

  // Local fallback: deterministic constellation from the session ledger,
  // mirroring the backend formatter's hash→sphere placement.
  const progress = getProgress(explorerId);
  const three: ThreePayload = { points: [], colors: [], meta: [] };
  for (const id of progress.collected) {
    const random = mulberry32(hashString(id));
    const y = random() * 2 - 1;
    const theta = random() * Math.PI * 2;
    const radius = 0.85 + random() * 0.3;
    const h = Math.sqrt(Math.max(0, 1 - y * y));
    three.points.push([
      Math.cos(theta) * h * radius,
      y * radius,
      Math.sin(theta) * h * radius,
    ]);
    three.colors.push([0.7, 0.75, 0.78]);
    three.meta.push({ key: id, label: null, mesh: null });
  }
  return NextResponse.json({
    ok: true,
    balance: progress.balance,
    collected: progress.collected,
    globalTotal: progress.total,
    three,
  });
}
