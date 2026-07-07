"use client";

import { useEffect } from "react";
import { usePresenceStore } from "@/lib/presence/presence-store";

/**
 * Boots the live-presence connection for this tab (join + SSE stream +
 * heartbeats). No UI of its own — the visitors it learns about render
 * as glowing stars inside the galaxy canvas (VisitorStars).
 */
export function PresenceConductor() {
  const ensureStarted = usePresenceStore((s) => s.ensureStarted);
  useEffect(() => {
    ensureStarted();
  }, [ensureStarted]);
  return null;
}
