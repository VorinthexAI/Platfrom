import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { backendConfigured, backendFetch } from "@/lib/backend";
import { getProgress } from "@/lib/fragments/fragments-server";

const EXPLORER_COOKIE = "vx_explorer";
const ACCESS_COOKIE = "vorinthex_access";

/**
 * The explorer's fragment progress. The durable numbers (global total,
 * balance, collected ids) come from the platform backend so they survive
 * server restarts — the in-memory Next.js ledger is no longer a source of
 * truth (it only debounces same-instance rapid clicks). Goal + label stay
 * registry-sourced. Falls back to the in-memory ledger in frontend-only dev.
 */
export async function GET() {
  const cookieStore = await cookies();
  const explorerId = cookieStore.get(EXPLORER_COOKIE)?.value;
  const accessToken = cookieStore.get(ACCESS_COOKIE)?.value;

  // Goal + label are registry constants; getProgress reads them from the
  // registry (the explorer arg only affects balance/collected, which the
  // backend overrides below when configured).
  const local = getProgress(explorerId);

  if (backendConfigured()) {
    const query = explorerId
      ? `?explorer_id=${encodeURIComponent(explorerId)}`
      : "";
    const result = await backendFetch<{
      global_total: number;
      explorer: { balance: number; collected: string[] } | null;
    }>(`/fragments/summary${query}`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
    if (result.ok && result.data) {
      return NextResponse.json({
        total: result.data.global_total,
        goal: local.goal,
        label: local.label,
        balance: result.data.explorer?.balance ?? 0,
        collected: result.data.explorer?.collected ?? [],
      });
    }
  }

  return NextResponse.json(local);
}
