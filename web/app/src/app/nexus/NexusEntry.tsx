"use client";

import { useCallback, useState } from "react";
import { FoundersGateApp } from "@/components/founders/FoundersGateApp";
import { NexusGate } from "./NexusGate";

/**
 * Every Nexus request is proxied through a route handler. The backend's global
 * auth middleware refreshes expired access tokens on those requests, and the
 * proxy persists the rotated pair before the next request is sent.
 */
export function NexusEntry() {
  const [showGate, setShowGate] = useState(false);
  const showFoundersGate = useCallback(() => setShowGate(true), []);

  return showGate ? <NexusGate /> : <FoundersGateApp onUnauthorized={showFoundersGate} />;
}
