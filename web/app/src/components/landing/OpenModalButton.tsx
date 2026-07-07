"use client";

import type { ReactNode } from "react";
import { Button, type ButtonVariant } from "@vorinthex/shared/ui/components";
import { trackCtaClick } from "@/lib/analytics";
import { useGalaxyStore } from "@/lib/galaxy-store";

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
 * hollowed belt asteroids).
 */
export function OpenModalButton({
  modal,
  variant = "ghost",
  className,
  children,
}: OpenModalButtonProps) {
  const enterCave = useGalaxyStore((s) => s.enterCave);
  const cave = modal === "waitlist" ? "join" : modal === "signin" ? "signin" : "members";
  return (
    <Button
      variant={variant}
      className={className}
      onClick={() => {
        trackCtaClick(`${modal}_open`, { cave_kind: cave });
        enterCave(cave);
      }}
    >
      {children}
    </Button>
  );
}
