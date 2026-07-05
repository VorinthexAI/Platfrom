// neural-map.md §5.1/§6.3.1/§8.7 — the routed entry point for
// `/console/u`, reached either directly (deep link / shared universe URL)
// or when `console-shell.tsx`'s `entryMode === "universe"` (§6.3.1: the
// user's very first hit this session was a Universe link, so this route's
// own `page.tsx` output — not the shell's off-tree mount — is what renders
// into the body's universe slot).
//
// Deliberately thin: `UniverseCanvasBoundary` reads its initial camera state
// from the URL query string itself (§8.7/§9.2.4) and owns the WebGL2
// degraded-mode fallback (§14.3) internally, so this page has nothing else
// to prepare server-side — unlike the chat route, there's no
// server-fetchable "first page of data" here (tiles are fetched client-side
// once the camera/viewport is known).

import { verifySession } from "@/server/dal/session";
import { UniverseCanvasBoundary } from "@/features/universe/universe-canvas-boundary";

export default async function UniversePage() {
  // Normal per-request DAL guard (§7.10) — the console layout's own
  // `verifySession()` call is the one exception that hard-redirects.
  await verifySession();

  return <UniverseCanvasBoundary />;
}
