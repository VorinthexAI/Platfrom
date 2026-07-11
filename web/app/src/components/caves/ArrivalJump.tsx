"use client";

import { useEffect, useRef, useState } from "react";
import { trackLandingEvent } from "@/lib/analytics";
import { hasPendingHandoff } from "@/lib/auth/handoff-client";
import { setLinkLanding } from "@/lib/auth/link-landing";
import { setMagicHandoff } from "@/lib/auth/magic-handoff";
import { useGalaxyStore } from "@/lib/galaxy-store";

/**
 * Deep-link arrivals. The visitor travels into the solar system exactly
 * like a fresh landing while the token is verified in the background.
 *
 * Where a SUCCESSFUL tap ends up depends on which surface opened it:
 * - The surface that requested the link (its handoff marker cookie is
 *   here) hyper-jumps straight into the galaxy, as always.
 * - Any other surface — a mail app's built-in view, another device —
 *   lands in the sealed chamber: the action worked, the session belongs
 *   to the surface that requested it, and there is no way out.
 *
 * Only a failed token falls back into the asteroid cave, where the
 * existing story explains what went wrong and offers a fresh link.
 *
 * - "waitlist-verify": /public/waitlist/verify?token_hash=…
 * - "magic": /public/auth/token?token_hash=…&flow=user (explorer session;
 *   member links keep the Cipher Chamber TOTP flow instead)
 * - "oauth-callback": /auth/oauth/callback?status=…&alias=… — the OAuth
 *   exchange already happened server-side (see the Next.js route handler),
 *   so unlike the token-based kinds above there's nothing left to verify;
 *   this just reads the result out of the query string. Always same-surface
 *   (the whole redirect chain stays in one browser), so there's no
 *   cross-device "sealed" case to handle like the token-based kinds have.
 */

type ArrivalKind = "waitlist-verify" | "magic" | "oauth-callback";

type ArrivalResult =
  | { outcome: "jump" }
  | { outcome: "sealed" }
  | { outcome: "cave" }
  | { outcome: "totp" };

/** Never leave a verified visitor stranded if the intro flight stalls. */
const INTRO_BACKSTOP_MS = 7000;

async function verifyWaitlistToken(token: string): Promise<ArrivalResult> {
  const response = await fetch(
    `/api/waitlist/verify?token_hash=${encodeURIComponent(token)}`,
  );
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) return { outcome: "cave" };
  if (!hasPendingHandoff()) {
    // A foreign surface: confirm, seal, point home. The surface that
    // requested the link claims its own session over the handoff.
    setLinkLanding({
      action: "waitlist-verify",
      alias: data.alias ?? null,
      waitlistNumber: data.waitlistNumber ?? null,
    });
    return { outcome: "sealed" };
  }
  window.localStorage.setItem(
    "vx_profile",
    JSON.stringify({
      email: data.email,
      alias: data.alias,
      aliasSlug: data.aliasSlug ?? null,
      waitlistNumber: data.waitlistNumber,
      welcomeLine: data.welcomeLine,
    }),
  );
  window.dispatchEvent(new Event("vx-profile-changed"));
  // Same surface that requested the link: consume the parked handoff so
  // its cookies clear instead of lingering until expiry.
  void fetch("/api/auth/handoff/claim", { method: "POST" }).catch(() => {});
  return { outcome: "jump" };
}

async function validateMagicToken(token: string): Promise<ArrivalResult> {
  const response = await fetch("/api/auth/magic/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token_hash: token, flow: "user" }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) return { outcome: "cave" };

  if (data.status === "authenticated") {
    trackLandingEvent({
      slug: "auth.magic_link_authenticated",
      metadata: { flow: "user" },
    });
    if (!hasPendingHandoff()) {
      setLinkLanding({
        action: "signin",
        alias: data.alias ?? null,
        aliasSlug: data.alias_slug ?? null,
        waitlistNumber: data.waitlist_number ?? null,
      });
      return { outcome: "sealed" };
    }
    window.localStorage.setItem(
      "vx_profile",
      JSON.stringify({
        alias: data.alias ?? null,
        waitlistNumber: data.waitlist_number ?? null,
        welcomeLine: data.welcome_line ?? null,
      }),
    );
    window.dispatchEvent(new Event("vx-profile-changed"));
    // Same surface that requested the link: consume the parked handoff
    // so its cookies clear instead of lingering until expiry.
    void fetch("/api/auth/handoff/claim", { method: "POST" }).catch(() => {});
    return { outcome: "jump" };
  }

  if (
    (data.status === "totp_setup_required" || data.status === "totp_required") &&
    typeof data.totp_challenge_token_hash === "string"
  ) {
    // A member link: park the already-issued challenge for the chamber.
    setMagicHandoff({
      status: data.status,
      challengeTokenHash: data.totp_challenge_token_hash,
    });
    return { outcome: "totp" };
  }

  return { outcome: "cave" };
}

function resolveOAuthArrival(): ArrivalResult {
  const params = new URLSearchParams(window.location.search);
  if (params.get("status") !== "success") return { outcome: "cave" };
  window.localStorage.setItem(
    "vx_profile",
    JSON.stringify({
      alias: params.get("alias"),
      aliasSlug: params.get("alias_slug"),
      waitlistNumber: params.get("waitlist_number")
        ? Number(params.get("waitlist_number"))
        : null,
      welcomeLine: params.get("welcome"),
    }),
  );
  window.dispatchEvent(new Event("vx-profile-changed"));
  return { outcome: "jump" };
}

export function ArrivalJump({ kind }: { kind: ArrivalKind }) {
  const mode = useGalaxyStore((s) => s.mode);
  const [result, setResult] = useState<ArrivalResult | null>(null);
  const [introTimedOut, setIntroTimedOut] = useState(false);
  const requested = useRef(false);
  const acted = useRef(false);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    (async () => {
      await Promise.resolve();
      try {
        if (kind === "oauth-callback") {
          setResult(resolveOAuthArrival());
          return;
        }
        const token = new URLSearchParams(window.location.search).get(
          "token_hash",
        );
        if (!token) {
          setResult({ outcome: "cave" });
          return;
        }
        setResult(
          kind === "waitlist-verify"
            ? await verifyWaitlistToken(token)
            : await validateMagicToken(token),
        );
      } catch {
        setResult({ outcome: "cave" });
      }
    })();
  }, [kind]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setIntroTimedOut(true),
      INTRO_BACKSTOP_MS,
    );
    return () => window.clearTimeout(timer);
  }, []);

  // Act once the verdict is in and the arrival flight has landed (or the
  // backstop fired). The jump launches from the solar system — no biome.
  useEffect(() => {
    if (!result || acted.current) return;
    const landed = mode !== "intro" || introTimedOut;
    if (!landed) return;
    acted.current = true;
    const store = useGalaxyStore.getState();
    if (result.outcome === "jump") {
      trackLandingEvent({
        slug: "waitlist.verify_jump_started",
        metadata: { kind },
      });
      store.startJump("public");
    } else if (result.outcome === "sealed") {
      store.enterCave("sealed");
    } else if (result.outcome === "totp") {
      store.enterCave("magic");
    } else {
      store.enterCave(kind);
    }
  }, [result, mode, introTimedOut, kind]);

  return null;
}
