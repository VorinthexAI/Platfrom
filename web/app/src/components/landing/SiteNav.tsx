"use client";

import Image from "next/image";
import Link from "next/link";
import { Button } from "@vorinthex/shared/ui/components";
import { AscendIcon } from "@/components/ui/icons";
import { SpeakerIcon } from "@/components/ui/SpeakerIcon";
import { trackCtaClick } from "@/lib/analytics";
import { useAudioStore } from "@/lib/audio/audio-store";
import {
  galaxyMotion,
  syncEntityUrl,
  useGalaxyStore,
} from "@/lib/galaxy-store";

/**
 * Fixed top bar: brand mark on the left, waitlist actions on the right.
 * The worlds themselves are the product navigation.
 */
export function SiteNav() {
  const enterCave = useGalaxyStore((s) => s.enterCave);
  const mode = useGalaxyStore((s) => s.mode);
  const caveKind = useGalaxyStore((s) => s.caveKind);
  const toggleMission = useAudioStore((s) => s.toggleMission);
  const missionPlaying = useAudioStore((s) => s.missionPlaying);

  // The sealed chamber (tapped email links) offers no way out — not even
  // the brand mark or the cave shortcuts up here.
  if (mode === "cave" && caveKind === "sealed") return null;

  return (
    <header className="absolute inset-x-0 top-0 z-40">
      <nav
        aria-label="Primary"
        className="mx-auto grid h-20 w-full max-w-7xl grid-cols-[1fr_auto] items-center px-5 sm:px-10 lg:grid-cols-[1fr_auto_1fr]"
      >
        <Link
          href="/"
          onClick={(event) => {
            // The brand mark restarts the whole arrival: reset the galaxy
            // and replay the same deep-space flight as a fresh page load.
            event.preventDefault();
            trackCtaClick("brand_home", { placement: "nav" });
            const state = useGalaxyStore.getState();
            state.resetToSystem();
            galaxyMotion.momentum = 0;
            galaxyMotion.orbitAngle = 0;
            galaxyMotion.orbitVelocity = 0;
            state.startIntro();
            syncEntityUrl("/");
          }}
          className="flex items-center gap-3 justify-self-start"
        >
          {/* unoptimized: a 1.3 KB mark gains nothing from /_next/image,
              and the optimizer route can hang (it kept the tab's load
              event, and its spinner, alive forever on the dev server). */}
          <Image
            src="/logos/vorinthex-mark-128.png"
            alt=""
            width={30}
            height={30}
            className="opacity-90"
            priority
            unoptimized
          />
          <span className="hidden flex-col leading-none sm:flex">
            <span className="font-display text-[0.8rem] font-semibold tracking-[0.3em] text-silver-50">
              VORINTHEX AI
            </span>
            <span className="mt-1 font-mono text-[0.5rem] tracking-[0.38em] text-silver-500 uppercase">
              Nexus of Intelligence
            </span>
          </span>
        </Link>

        {/* The worlds speak for themselves: no product tabs in the bar,
            the galaxy is the navigation. The center column stays empty. */}
        <div className="hidden lg:block" />

        {/* Short, single-word labels so nothing ever wraps; on phones the
            mission and leaderboard collapse to icon-only buttons. */}
        <div className="flex items-center gap-2 justify-self-end sm:gap-4">
          <Button
            variant="primary"
            onClick={() => {
              trackCtaClick("waitlist_open", { placement: "nav" });
              enterCave("join");
            }}
            className="min-h-0 px-5 py-2.5 text-[0.65rem] whitespace-nowrap"
          >
            Join
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              trackCtaClick("mission_audio", { placement: "nav" });
              toggleMission();
            }}
            icon={<SpeakerIcon animated={missionPlaying} />}
            aria-label={missionPlaying ? "Stop the mission" : "Hear the mission"}
            className="min-h-0 px-3 py-2.5 text-[0.65rem] uppercase whitespace-nowrap sm:px-4"
          >
            <span className="hidden sm:inline">
              {missionPlaying ? "Stop" : "Hear"}
            </span>
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              trackCtaClick("leaderboard_open", { placement: "nav" });
              enterCave("leaderboard");
            }}
            icon={<AscendIcon size="sm" />}
            aria-label="View leaderboard"
            className="min-h-0 px-3 py-2.5 text-[0.65rem] uppercase whitespace-nowrap sm:px-4"
          >
            <span className="hidden sm:inline">Leaderboard</span>
          </Button>
        </div>
      </nav>
    </header>
  );
}
