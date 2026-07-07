"use client";

import { useEffect, useRef } from "react";
import { trackLandingEvent } from "@/lib/analytics";
import {
  claimHandoffSession,
  hasPendingHandoff,
} from "@/lib/auth/handoff-client";
import { useGalaxyStore } from "@/lib/galaxy-store";

/**
 * Silent sign-in completion for returning visitors. If a past session
 * requested an emailed link, closed, and the link has since been tapped
 * somewhere, the pending-handoff marker survives in this browser's
 * cookies — so the next visit claims the approved session and jumps
 * straight into the explorer's galaxy without asking anything.
 */
export function HandoffConductor({ disabled = false }: { disabled?: boolean }) {
  const attempted = useRef(false);

  useEffect(() => {
    if (disabled || attempted.current) return;
    attempted.current = true;
    (async () => {
      await Promise.resolve();
      if (!hasPendingHandoff()) return;
      if (window.localStorage.getItem("vx_profile")) return;
      const profile = await claimHandoffSession();
      if (!profile) return;
      trackLandingEvent({
        slug: "auth.magic_link_authenticated",
        metadata: { flow: "handoff", placement: "return_visit" },
      });
      // Ride out the arrival flight, then jump. Same backstop thinking as
      // ArrivalJump: never leave a signed-in visitor stranded.
      const jumpWhenLanded = () => {
        const store = useGalaxyStore.getState();
        if (store.mode !== "intro") {
          store.startJump("public");
          return true;
        }
        return false;
      };
      if (jumpWhenLanded()) return;
      const timer = window.setInterval(() => {
        if (jumpWhenLanded()) window.clearInterval(timer);
      }, 500);
      window.setTimeout(() => window.clearInterval(timer), 12_000);
    })();
  }, [disabled]);

  return null;
}
