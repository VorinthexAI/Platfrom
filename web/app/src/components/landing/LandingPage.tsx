import type { ReactNode } from "react";
import { UniverseStage } from "@/components/galaxy/UniverseStage";
import { FragmentOverlay } from "@/components/fragments/FragmentOverlay";
import { ArrivalJump } from "@/components/caves/ArrivalJump";
import { CaveAutoStart } from "@/components/caves/CaveAutoStart";
import { CaveOverlay } from "@/components/caves/CaveOverlay";
import { JumpOverlay } from "@/components/caves/JumpOverlay";
import { TransitionVeil } from "@/components/caves/TransitionVeil";
import type { CaveKind } from "@/lib/galaxy-store";
import { AeoSections } from "./AeoSections";
import { AnalyticsConductor } from "./AnalyticsConductor";
import { AudioConductor } from "./AudioConductor";
import { FooterStrip } from "./FooterStrip";
import { HeroContent } from "./HeroContent";
import { InteriorOverlay } from "./InteriorOverlay";
import { IntroCurtain } from "./IntroCurtain";
import { OrbitRail } from "./OrbitRail";
import { PresenceConductor } from "./PresenceConductor";
import { ProductDrawer } from "./ProductDrawer";
import { ScrollHint } from "./ScrollHint";
import { SiteNav } from "./SiteNav";

interface LandingPageProps {
  /** Registry entity id the camera should open on (deep link). */
  initialEntityId?: string;
  /** Cave story to fly into on load (member magic-link deep links). */
  initialCave?: CaveKind;
  /**
   * Verify-and-jump deep links: travel into the solar system like a fresh
   * landing, verify the token in the background, then hyper-jump straight
   * to the public galaxy — no biome on the way.
   */
  arrival?: "waitlist-verify" | "magic";
  /** Optional server-rendered deep-link detail, kept for crawlers. */
  detail?: ReactNode;
}

/**
 * The whole site is one 100dvh universe — no page scroll. Scroll/swipe
 * steps through the orbit sequence; the drawer presents the focused
 * world; joining and signing in happen inside hollowed belt asteroids.
 * Narrative copy for crawlers/answer engines lives in a visually hidden
 * block, since the visible experience is spatial.
 */
export function LandingPage({
  initialEntityId,
  initialCave,
  arrival,
  detail,
}: LandingPageProps) {
  // The arrival flight plays on a fresh landing and on verify-and-jump
  // deep links (the "travel to the solar system" beat before the hyper
  // jump); entity/cave deep links go straight to their target.
  const intro = !initialEntityId && !initialCave;
  return (
    <main className="h-dvh overflow-hidden">
      <UniverseStage initialEntityId={initialEntityId} intro={intro}>
        <SiteNav />
        <HeroContent />
        <OrbitRail />
        <ScrollHint />
        <ProductDrawer />
        <InteriorOverlay />
        <FragmentOverlay />
        <CaveOverlay />
        <TransitionVeil />
        <JumpOverlay />
        <AnalyticsConductor />
        <AudioConductor />
        <PresenceConductor />
        <FooterStrip />
        {intro ? <IntroCurtain /> : null}
      </UniverseStage>

      {initialCave ? <CaveAutoStart kind={initialCave} /> : null}
      {arrival ? <ArrivalJump kind={arrival} /> : null}

      {/* Server-rendered content for SEO/AEO and screen readers. */}
      <div className="sr-only">
        {detail}
        <AeoSections />
      </div>
    </main>
  );
}
