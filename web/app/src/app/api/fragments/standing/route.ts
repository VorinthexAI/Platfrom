import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { backendConfigured, backendFetch } from "@/lib/backend";
import { getProgress } from "@/lib/fragments/fragments-server";

const EXPLORER_COOKIE = "vx_explorer";
const ACCESS_COOKIE = "vorinthex_access";

/**
 * The caller's authoritative standing — total fragments and 1-based
 * leaderboard rank — straight from the backend's canonical
 * COLLECT/SUM query family (the same one that builds the board), so the
 * "you" card and the in-list "You" row can never structurally disagree.
 * `rank` is null for anonymous explorers (the board is signed-in-only).
 * Falls back to the in-memory session ledger in frontend-only dev.
 */
export async function GET() {
  const cookieStore = await cookies();
  const explorerId = cookieStore.get(EXPLORER_COOKIE)?.value;
  const accessToken = cookieStore.get(ACCESS_COOKIE)?.value;

  if (backendConfigured()) {
    const query = explorerId
      ? `?explorer_id=${encodeURIComponent(explorerId)}`
      : "";
    const result = await backendFetch<{
      user_id: string | null;
      total: number;
      rank: number | null;
      entries: number;
      adopted: boolean;
    }>(`/fragments/standing${query}`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
    if (result.ok && result.data) {
      return NextResponse.json({
        userId: result.data.user_id,
        total: result.data.total,
        rank: result.data.rank,
        entries: result.data.entries,
        adopted: result.data.adopted,
      });
    }
  }

  // Local fallback: the device's session balance, unranked.
  const progress = getProgress(explorerId);
  return NextResponse.json({
    userId: null,
    total: progress.balance,
    rank: null,
    entries: progress.collected.length,
    adopted: false,
  });
}
