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
   * The old "waitlist" alias now opens the same sign-in cave: sign-in
   * creates a new explorer account when needed.
   */
  modal: "waitlist" | "signin";
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
  const cave = "signin";
  return (
    <Button
      variant={variant}
      className={className}
      onClick={() => {
        if (hasVerifiedProfile()) {
          trackLandingEvent({
            slug: "auth.signin_authed_jump",
            metadata: { placement: "signin_button" },
          });
          startJump("public");
          return;
        }
        trackCtaClick("signin_gate_open", { cave_kind: cave, source: modal });
        enterCave(cave);
      }}
    >
      {children}
    </Button>
  );
}
