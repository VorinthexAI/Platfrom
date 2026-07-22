"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";

const FoundersGateApp = dynamic(
  () => import("@/components/founders/FoundersGateApp").then((module) => module.FoundersGateApp),
  {
    loading: () => <NexusLoading />,
    ssr: false,
  },
);
const NexusGate = dynamic(() => import("./NexusGate").then((module) => module.NexusGate), {
  loading: () => <NexusLoading />,
  ssr: false,
});

function NexusLoading() {
  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-[#1c0701]">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 46%, #7a2d05 0%, #4a1503 44%, #1c0701 78%, #0a0301 100%)",
        }}
      />
      <p className="micro-label relative z-10 text-silver-300" aria-live="polite">
        Entering the Nexus...
      </p>
    </main>
  );
}

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
