// neural-map.md §11.4 — realtime change feed.
//
// ── WHY THIS ROUTE DOES NOT ITSELF UPGRADE TO A WEBSOCKET ──────────────────
//
// §11.4 calls for "a Next.js route handler upgrading to a proxied WS
// connection to the backend." In practice, Next.js App Router Route
// Handlers are built on the Web `Request`/`Response` APIs and do not expose
// the raw Node `http.Server`'s `upgrade` event — there is no supported,
// documented way (as of Next 16.2, checked against
// node_modules/next/dist/docs) to hijack the underlying socket from inside
// a `route.ts` file the way a bespoke Node server or a `next.config.ts`
// custom server could. Building a custom server would mean opting out of
// Next's managed request lifecycle (and Vercel/Fluid Compute deployability)
// for the sake of one endpoint — not a trade worth making for v1.
//
// The pragmatic alternative the plan explicitly sanctions for exactly this
// situation: the browser connects **directly** to the backend's WebSocket
// endpoint (derived from `NEXT_PUBLIC_WS_BASE_URL`), bypassing this Next.js
// server entirely for the long-lived connection. The problem that creates:
// the browser's `WebSocket` constructor cannot attach the httpOnly
// `vx_session` cookie to a cross-origin (or even same-origin-but-different-
// port, in local dev) handshake the way a normal `fetch` can — WebSocket
// handshakes only reliably carry cookies for same-origin, same-port
// requests, which this deployment topology (separate backend host) doesn't
// guarantee.
//
// So this route's actual job is narrower than "proxy the socket": it mints
// a short-lived, signed **WS auth ticket** over a normal authenticated
// same-origin GET (which *can* read the httpOnly cookie, via
// `verifySessionForRoute()`), and hands back a fully-formed WS URL with that
// ticket as a query param. The client (`data/universe-api.ts`'s
// `openUniverseSocket`) fetches this once per connection attempt, then opens
// a native `WebSocket` straight to the backend using the returned URL. The
// backend is expected to validate the ticket itself (same HMAC scheme,
// short TTL) rather than trusting the query param blindly — that's a
// backend-side contract this route can document but not enforce.
//
// Ticket format: reuses `src/server/auth/session-codec.ts`'s
// `encryptSessionCookie`/`SessionCookiePayload` machinery (HMAC-SHA256 over
// `base64url(payload).base64url(signature)`) rather than inventing a second
// signing scheme — the payload shape (`sub`/`state`/`iat`/`exp`) already
// says exactly what a WS ticket needs to say ("this user, authenticated,
// expires at T"). TTL is deliberately short (60s) since the ticket only
// needs to survive the handshake, not the connection's lifetime.
//
// This is explicitly flagged (per this feature's brief) as a v1 needing
// real-world backend alignment once the backend team implements ticket
// verification — not a fully bulletproof implementation.

import { encryptSessionCookie } from "@/server/auth/session-codec";
import { verifySessionForRoute } from "@/server/dal/session";

export const runtime = "nodejs";

const WS_TICKET_TTL_SECONDS = 60;

function resolveWsBase(): string {
  const configured = process.env.NEXT_PUBLIC_WS_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  // Dev fallback — mirrors backend-client.ts's localhost:4000 default, just
  // over ws:// instead of http://.
  return "ws://localhost:4000";
}

export async function GET() {
  const session = await verifySessionForRoute();
  if (!session) {
    return new Response(null, { status: 401 });
  }

  const iat = Math.floor(Date.now() / 1000);
  const ticket = await encryptSessionCookie({
    sub: session.userId,
    state: "authenticated",
    iat,
    exp: iat + WS_TICKET_TTL_SECONDS,
  });

  const wsUrl = `${resolveWsBase()}/universe/stream?ticket=${encodeURIComponent(ticket)}`;
  return Response.json({ wsUrl, expiresInSeconds: WS_TICKET_TTL_SECONDS });
}
