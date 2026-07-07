"use client";

import { useEffect } from "react";
import { useGalaxyStore, type CaveKind } from "@/lib/galaxy-store";

/**
 * Deep-linked cave stories: /public/waitlist/verify and /public/auth/token
 * mount this to fly straight into the right asteroid as the page loads —
 * the query params tell the flow inside what to verify.
 */
export function CaveAutoStart({ kind }: { kind: CaveKind }) {
  const enterCave = useGalaxyStore((s) => s.enterCave);
  useEffect(() => {
    enterCave(kind);
  }, [enterCave, kind]);
  return null;
}
