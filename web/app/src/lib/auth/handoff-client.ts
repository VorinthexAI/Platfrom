"use client";

/**
 * Client half of the cross-device handoff.
 *
 * The claim secret itself lives in an httpOnly cookie — page scripts only
 * ever see the secretless `vx_handoff_pending` marker. While a sign-in
 * screen waits, `watchHandoff` rides the SSE stream (EventSource retries
 * itself); when the emailed link is tapped anywhere the stream flips to
 * `approved` and `claimHandoffSession` trades the cookie for a session.
 * If the tab closed in between, the marker survives and the next visit
 * claims silently instead.
 */

/** Mirror of handoff-cookies.ts's marker name (kept out of the client
    bundle — that module is server-only). */
const HANDOFF_MARKER_COOKIE = "vx_handoff_pending";

export interface HandoffProfile {
  alias: string | null;
  aliasSlug: string | null;
  waitlistNumber: number | null;
  welcomeLine: string | null;
}

export function hasPendingHandoff(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split(";")
    .some((part) => part.trim().startsWith(`${HANDOFF_MARKER_COOKIE}=1`));
}

/**
 * One-shot claim. Returns the signed-in profile, or null while the link
 * is still untapped (or the handoff is gone). Also persists vx_profile so
 * every existing signed-in surface lights up.
 */
export async function claimHandoffSession(): Promise<HandoffProfile | null> {
  try {
    const response = await fetch("/api/auth/handoff/claim", { method: "POST" });
    const data = (await response.json().catch(() => null)) as
      | ({ ok: boolean; status?: string } & {
          alias?: string | null;
          alias_slug?: string | null;
          waitlist_number?: number | null;
          welcome_line?: string | null;
        })
      | null;
    if (!response.ok || !data?.ok) return null;
    const profile: HandoffProfile = {
      alias: data.alias ?? null,
      aliasSlug: data.alias_slug ?? null,
      waitlistNumber: data.waitlist_number ?? null,
      welcomeLine: data.welcome_line ?? null,
    };
    window.localStorage.setItem("vx_profile", JSON.stringify(profile));
    window.dispatchEvent(new Event("vx-profile-changed"));
    return profile;
  } catch {
    return null;
  }
}

/**
 * Watch for the link tap. Calls `onApproved` exactly once; returns a
 * cleanup that closes the stream. EventSource handles reconnects.
 */
export function watchHandoff(onApproved: () => void): () => void {
  if (typeof window === "undefined" || !hasPendingHandoff()) {
    return () => {};
  }
  const source = new EventSource("/api/auth/handoff/stream");
  let fired = false;
  source.addEventListener("handoff", (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data) as {
        status?: string;
      };
      if (data.status === "approved" && !fired) {
        fired = true;
        source.close();
        onApproved();
      } else if (data.status === "gone") {
        source.close();
      }
    } catch {
      // Malformed frame: keep listening.
    }
  });
  return () => source.close();
}
