"use client";

import type { ReactNode } from "react";
import { Button, type ButtonVariant } from "@vorinthex/shared/ui/components";
import { trackCtaClick, trackLandingEvent } from "@/lib/analytics";
import { useGalaxyStore } from "@/lib/galaxy-store";

function hasVerifiedProfile(): boolean {
  try {
    return Boolean(window.localStorage.getItem("vx_profile"));
  } catch {
    return false;
  }
}

interface OpenModalButtonProps {
  /**
   * "waitlist" opens the join cave, "signin" the explorer Grove, and
   * "members" the Members Gate (magic link → TOTP → private galaxy).
   */
  modal: "waitlist" | "signin" | "members";
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
}

/**
 * Shared-library Button that launches the matching asteroid-cave story
 * (there are no modals anymore — joining and signing in happen inside
 * hollowed belt asteroids). One exception: a signed-in explorer tapping
 * "Sign in" hyper-jumps straight to their public galaxy instead of
 * opening a biome.
 */
export function OpenModalButton({
  modal,
  variant = "ghost",
  className,
  children,
}: OpenModalButtonProps) {
  const enterCave = useGalaxyStore((s) => s.enterCave);
  const startJump = useGalaxyStore((s) => s.startJump);
  const cave = modal === "waitlist" ? "join" : modal === "signin" ? "signin" : "members";
  return (
    <Button
      variant={variant}
      className={className}
      onClick={() => {
        if (modal === "signin" && hasVerifiedProfile()) {
          trackLandingEvent({
            slug: "auth.signin_authed_jump",
            metadata: { placement: "signin_button" },
          });
          startJump("public");
          return;
        }
        trackCtaClick(`${modal}_open`, { cave_kind: cave });
        enterCave(cave);
      }}
    >
      {children}
    </Button>
  );
}
