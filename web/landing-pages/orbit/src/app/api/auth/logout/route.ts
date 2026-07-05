import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { backendFetch } from "@/server/backend-client";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-codec";

// Best-effort against the backend — regardless of whether that call
// succeeds, we always clear the local session cookie so the user is signed
// out of this browser.
export async function POST() {
  try {
    await backendFetch("/auth/logout", { method: "POST" });
  } catch {
    // Backend unreachable — still proceed to clear the local cookie below.
  }

  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);

  return NextResponse.json({ success: true });
}
