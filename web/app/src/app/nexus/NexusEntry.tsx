"use client";

import { useCallback, useState } from "react";
import { FoundersGateApp } from "@/components/founders/FoundersGateApp";
import { NexusGate } from "./NexusGate";

/**
 * Session renewal must happen through a route handler so its Set-Cookie
 * response reaches the browser. Server components cannot persist a rotated
 * single-use refresh token.
 */
export function NexusEntry() {
  const [showGate, setShowGate] = useState(false);
  const showFoundersGate = useCallback(() => setShowGate(true), []);

  return showGate ? <NexusGate /> : <FoundersGateApp onUnauthorized={showFoundersGate} />;
}
