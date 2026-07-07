"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FragmentGlobe, type GlobeData } from "@/components/fragments/FragmentGlobe";
import { useGalaxyStore } from "@/lib/galaxy-store";

interface StoredProfile {
  email: string;
  alias: string | null;
  waitlistNumber: number | null;
  welcomeLine: string | null;
}

/**
 * The explorer's own corner of the galaxy: alias, waitlist number, and a
 * spinning neural globe of every Intelligence Fragment they've collected.
 * Collecting matters — fragments earn better offers and early-access
 * pricing when the doors open.
 */
export function PublicGalaxy() {
  const router = useRouter();
  const [profile, setProfile] = useState<StoredProfile | null>(null);
  const [balance, setBalance] = useState(0);
  const [globe, setGlobe] = useState<GlobeData>({ points: [], colors: [] });

  useEffect(() => {
    (async () => {
      await Promise.resolve();
      try {
        const raw = window.localStorage.getItem("vx_profile");
        if (raw) setProfile(JSON.parse(raw));
      } catch {
        // Corrupt local profile — greet anonymously.
      }
      try {
        const response = await fetch("/api/fragments/globe");
        if (!response.ok) return;
        const data = await response.json();
        setBalance(data.balance ?? 0);
        setGlobe(data.three ?? { points: [], colors: [] });
      } catch {
        // The globe is decorative — stay quiet on failure.
      }
    })();
  }, []);
  // (all state updates above happen in async continuations, never sync in the effect)

  const displayName = profile?.alias ?? "Explorer";
  const returnToGalaxy = () => {
    useGalaxyStore.getState().resetToSystem();
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "/");
    }
    router.replace("/");
  };

  return (
    <main className="obsidian-noise flex min-h-svh flex-col items-center justify-center px-5 py-16 text-center">
      <p className="micro-label">Your galaxy</p>
      <h1 className="font-display mt-5 max-w-xl text-3xl leading-snug tracking-[0.08em] text-silver-50 uppercase sm:text-4xl">
        Welcome, {displayName}.
      </h1>
      {profile?.waitlistNumber ? (
        <p className="mt-4 max-w-md text-sm leading-relaxed text-silver-300">
          You are galaxy explorer{" "}
          <span className="text-silver-50">
            #{profile.waitlistNumber.toLocaleString("en-US")}
          </span>
          . Your spot is secured. See you at first light.
        </p>
      ) : (
        <p className="mt-4 max-w-md text-sm leading-relaxed text-silver-300">
          Your spot is secured. See you at first light.
        </p>
      )}

      <div className="mt-10 flex flex-col items-center">
        <FragmentGlobe data={globe} />
        <p className="chrome-text mt-2 text-5xl font-extralight tabular-nums">
          {balance.toLocaleString("en-US")}
        </p>
        <p className="mt-2 font-mono text-[0.55rem] tracking-[0.28em] text-silver-500 uppercase">
          Intelligence Fragments collected
        </p>
      </div>

      <p className="mt-8 max-w-sm text-[0.78rem] leading-relaxed text-silver-500">
        Every fragment you find in the galaxy is recorded to your name.
        Collectors earn better offers and early-access pricing when
        Vorinthex launches, keep exploring.
      </p>

      <button
        type="button"
        onClick={returnToGalaxy}
        className="vui-button vui-button-secondary mt-10 min-h-0 px-7 py-3 text-xs uppercase"
      >
        Return to the galaxy
      </button>
    </main>
  );
}
