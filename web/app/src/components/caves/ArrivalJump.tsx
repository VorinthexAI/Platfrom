"use client";

import { useEffect, useRef, useState } from "react";
import { trackLandingEvent } from "@/lib/analytics";
import { setMagicHandoff } from "@/lib/auth/magic-handoff";
import { useGalaxyStore } from "@/lib/galaxy-store";

/**
 * Deep-link arrivals that should never open a biome: the visitor travels
 * into the solar system exactly like a fresh landing while the token is
 * verified in the background, then hyper-jumps straight to their public
 * galaxy. Only a failed token falls back into the asteroid cave, where
 * the existing story explains what went wrong.
 *
 * - "waitlist-verify": /public/waitlist/verify?token_hash=…
 * - "magic": /public/auth/token?token_hash=…&flow=user (explorer session;
 *   member links keep the Cipher Chamber TOTP flow instead)
 */

type ArrivalKind = "waitlist-verify" | "magic";

type ArrivalResult =
  | { outcome: "jump" }
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
  window.localStorage.setItem(
    "vx_profile",
    JSON.stringify({
      email: data.email,
      alias: data.alias,
      waitlistNumber: data.waitlistNumber,
      welcomeLine: data.welcomeLine,
    }),
  );
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
    window.localStorage.setItem(
      "vx_profile",
      JSON.stringify({
        alias: data.alias ?? null,
        waitlistNumber: data.waitlist_number ?? null,
        welcomeLine: data.welcome_line ?? null,
      }),
    );
    trackLandingEvent({
      slug: "auth.magic_link_authenticated",
      metadata: { flow: "user" },
    });
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
      const token = new URLSearchParams(window.location.search).get(
        "token_hash",
      );
      if (!token) {
        setResult({ outcome: "cave" });
        return;
      }
      try {
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
    } else if (result.outcome === "totp") {
      store.enterCave("magic");
    } else {
      store.enterCave(kind);
    }
  }, [result, mode, introTimedOut, kind]);

  return null;
}
