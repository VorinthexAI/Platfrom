"use client";

import { useCallback, useEffect, useState } from "react";
import { FoundersGateApp } from "@/components/founders/FoundersGateApp";
import { FoundersBackdrop } from "@/components/founders/FoundersBackdrop";
import { NexusGate } from "./NexusGate";

/**
 * Session renewal must happen through a route handler so its Set-Cookie
 * response reaches the browser. Server components cannot persist a rotated
 * single-use refresh token.
 */
export function NexusEntry() {
  const [entry, setEntry] = useState<"checking" | "workspace" | "gate">("checking");
  const showFoundersGate = useCallback(() => setEntry("gate"), []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/refresh", { method: "POST", cache: "no-store" })
      .then((response) => {
        if (cancelled) return;
        setEntry(response.status === 401 || response.status === 403 ? "gate" : "workspace");
      })
      .catch(() => {
        // Let the workspace's authoritative account request classify a
        // transient refresh failure instead of forcing another MFA prompt.
        if (!cancelled) setEntry("workspace");
      });
    return () => { cancelled = true; };
  }, []);

  if (entry === "checking") {
    return <main className="relative min-h-svh overflow-hidden bg-[#1c0701]"><FoundersBackdrop /></main>;
  }

  return entry === "gate" ? <NexusGate /> : <FoundersGateApp onUnauthorized={showFoundersGate} />;
}
