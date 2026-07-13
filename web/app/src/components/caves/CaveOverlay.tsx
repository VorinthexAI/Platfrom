"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Button, Skeleton, TextInput } from "@vorinthex/shared/ui/components";
import { rollCenterCrystal } from "@/components/galaxy/BiomeLoot";
import { TotpSetupPanel, TotpVerifyPanel, type TotpSetupData } from "@/components/auth/TotpWizard";
import { CloseIcon } from "@/components/ui/icons";
import { SlideUpCard } from "@/components/ui/SlideUpCard";
import { SpeakerIcon } from "@/components/ui/SpeakerIcon";
import { trackCtaClick, trackLandingEvent } from "@/lib/analytics";
import { useAudioStore } from "@/lib/audio/audio-store";
import {
  claimHandoffSession,
  hasPendingHandoff,
  watchHandoff,
} from "@/lib/auth/handoff-client";
import { peekLinkLanding, setLinkLanding } from "@/lib/auth/link-landing";
import { setMagicHandoff, takeMagicHandoff } from "@/lib/auth/magic-handoff";
import { CAVE_CONFIGS } from "@/lib/cave-config";
import { normalizeEmailInput, parseApiError } from "@/lib/email";
import { formatFragments } from "@/lib/format";
import { useFragmentsStore } from "@/lib/fragments/fragments-store";
import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import { caveLootIdentity, syncEntityUrl, useGalaxyStore } from "@/lib/galaxy-store";
import { galaxyPulseLine } from "@/lib/leaderboard/copy";
import { useLeaderboardStore } from "@/lib/leaderboard/leaderboard-store";
import {
  ABOUT_COPY,
  CONTACT_COPY,
  PRIVACY_COPY,
  TERMS_COPY,
  type VaultCopy,
} from "@/lib/legal-copy";
import { crystalOpener, tierForValue } from "@/lib/loot/crystal-tiers";

/**
 * The DOM half of the asteroid-cave stories. While the camera flies to
 * the anchor rock we show only the approach label; punching through the
 * surface fires a white-out flash; inside, a chrome panel hosts the flow:
 *
 *  1. join            — waitlist email form
 *  2. join → sent     — "check your inbox, verify to secure your spot"
 *  3. waitlist-verify — auto-verifies ?token_hash, reveals alias + number
 *  4. signin          — explorer profile: welcome line + fragments haul
 *  5. magic / mfa     — validates ?token_hash → TOTP setup (QR + 2 codes)
 *  6. magic / mfa     — returning member: single TOTP code
 *  7. success         — hyper jump into /galaxy/sun or /galaxy/public
 */
export function CaveOverlay() {
  const mode = useGalaxyStore((s) => s.mode);
  const caveKind = useGalaxyStore((s) => s.caveKind);
  const cavePhase = useGalaxyStore((s) => s.cavePhase);
  const visitSeed = useGalaxyStore((s) => s.visitSeed);
  const exitCave = useGalaxyStore((s) => s.exitCave);
  const beginEnter = useGalaxyStore((s) => s.beginEnter);

  // The camera flight normally triggers the veil from the frame loop —
  // but without WebGL (fallback hero, headless crawlers) that never
  // fires, and a deep-linked visitor must still be able to verify.
  // Guarantee entry after a beat.
  useEffect(() => {
    if (mode !== "cave" || cavePhase !== "fly") return;
    const timer = setTimeout(() => beginEnter("cave"), 4500);
    return () => clearTimeout(timer);
  }, [mode, cavePhase, beginEnter]);

  if (mode !== "cave" || !caveKind) return null;
  const config = CAVE_CONFIGS[caveKind];

  return (
    // pointer-events pass through the empty layer: only the card itself
    // captures clicks, so chamber treasures stay collectable behind it.
    <div className="pointer-events-none absolute inset-0 z-40">
      {/* approach label */}
      <AnimatePresence>
        {cavePhase === "fly" ? (
          <motion.p
            key="approach"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-x-0 bottom-24 text-center font-mono text-[0.6rem] tracking-[0.34em] text-silver-300 uppercase"
          >
            {config.approachLabel}
          </motion.p>
        ) : null}
      </AnimatePresence>

      {/* The surface punch-through is handled by the shared TransitionVeil
         , a smooth obsidian fade, no flash. */}

      {cavePhase === "inside" ? (
        caveKind === "rock" ? (
          // Uncharted rocks get a slim bottom drawer (same hold-then-slide
          // beat as the planet drawer) so the crystal stays center stage.
          <RockDrawer key={`rock-${visitSeed}`} />
        ) : caveKind === "hunt" || caveKind === "pricing" ? (
          // The hunt and the exchange break out of the single card:
          // several floating islands, each sliding up in its own cascaded
          // beat. This is a card stack, not a drawer: it owns vertical
          // scroll on mobile. The scroll layer starts BELOW the fixed nav
          // (top-20 = SiteNav's h-20) — a full-height pointer-events-auto
          // scroller would swallow the header buttons' clicks.
          <div className="pointer-events-none absolute inset-x-0 top-20 bottom-0 px-4">
            <div
              key={`${caveKind}-${visitSeed}`}
              data-scroll-safe
              className="scrollbar-hide pointer-events-auto mx-auto h-full w-full max-w-md overflow-y-auto overscroll-contain pt-[calc(env(safe-area-inset-top)+2rem)] pb-[calc(env(safe-area-inset-bottom)+3.5rem)] [touch-action:pan-y] sm:pt-12 sm:pb-12 lg:pt-8"
            >
              {caveKind === "hunt" ? <LeaderboardFlow /> : <PricingFlow />}
            </div>
          </div>
        ) : (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
            <SlideUpCard
              key={`${caveKind}-${visitSeed}`}
              className="pointer-events-auto w-full max-w-md"
            >
              <div
                className="chrome-border card-depth relative w-full rounded-3xl p-7 sm:p-9"
                style={{ background: "var(--gradient-panel)" }}
                data-scroll-safe
              >
                {/* The sealed chamber has no exit: no close, no escape —
                    the visitor's session lives where they requested it. */}
                {caveKind === "sealed" ? null : (
                  <button
                    type="button"
                    onClick={() => {
                      trackCtaClick("cave_close", { cave_kind: caveKind });
                      exitCave();
                      syncEntityUrl("/");
                    }}
                    aria-label="Leave the cave"
                    className="absolute top-4 right-4 rounded-full border border-white/10 p-2 text-silver-500 transition-colors hover:border-white/25 hover:text-silver-100"
                  >
                    <CloseIcon width={12} height={12} />
                  </button>
                )}

                {caveKind === "sealed" ? <SealedFlow /> : null}
                {caveKind === "join" || caveKind === "signin" ? <ExplorerSigninFlow /> : null}
                {caveKind === "waitlist-verify" ? <WaitlistVerifyFlow /> : null}
                {caveKind === "magic" ? <MagicFlow /> : null}
                {caveKind === "mfa" ? <MagicFlow /> : null}
                {caveKind === "organization-signin" ? <MagicFlow /> : null}
                {caveKind === "oauth-callback" ? <OAuthCallbackFlow /> : null}
                {caveKind === "founders-mystery" ? <FoundersMysteryFlow /> : null}
                {caveKind === "privacy" ? <VaultReaderFlow copy={PRIVACY_COPY} /> : null}
                {caveKind === "terms" ? <VaultReaderFlow copy={TERMS_COPY} /> : null}
                {caveKind === "about" ? <VaultReaderFlow copy={ABOUT_COPY} /> : null}
                {caveKind === "contact" ? <VaultReaderFlow copy={CONTACT_COPY} /> : null}
              </div>
            </SlideUpCard>
          </div>
        )
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* the sealed chamber — where tapped email links end                  */
/* ---------------------------------------------------------------- */

/**
 * Success state for a link opened on a surface that did not request it.
 * There is deliberately no exit: the session belongs to the screen where
 * the link was requested, and the copy sends the visitor back there.
 */
function SealedFlow() {
  const landing = peekLinkLanding();
  const action = landing?.action ?? "signin";

  return (
    <div>
      <p className="micro-label">Passage Sealed</p>
      {action === "waitlist-verify" ? (
        <>
          <h2 className="font-display mt-3 text-2xl leading-snug tracking-[0.08em] text-silver-50">
            Your Hunt profile is secured.
          </h2>
          {landing?.waitlistNumber ? (
            <p className="mt-3 text-sm leading-relaxed text-silver-300">
              You are{" "}
              <span className="text-silver-50">
                Hunt explorer #{landing.waitlistNumber.toLocaleString("en-US")}
              </span>
              . Verification is complete.
            </p>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-silver-300">
              Verification is complete.
            </p>
          )}
        </>
      ) : action === "member" ? (
        <>
          <h2 className="font-display mt-3 text-2xl leading-snug tracking-[0.08em] text-silver-50">
            The gate heard you.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-silver-300">
            Your platform sign in is approved. The MFA chamber is opening
            on the screen where you requested this link.
          </p>
        </>
      ) : (
        <>
          <h2 className="font-display mt-3 text-2xl leading-snug tracking-[0.08em] text-silver-50">
            The light was received.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-silver-300">
            Your sign in is confirmed
            {landing?.alias ? (
              <>
                , <span className="text-silver-50">{landing.alias}</span>
              </>
            ) : null}
            .
          </p>
        </>
      )}
      <p className="mt-4 text-sm leading-relaxed text-silver-300">
        Now return to where you requested this link. Your galaxy is
        already opening there, signed in and waiting for you.
      </p>
      <p className="mt-5 font-mono text-[0.55rem] leading-relaxed tracking-[0.24em] text-silver-500 uppercase">
        This passage has served its purpose and sealed itself
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* the uncharted rock — a slim drawer under the crystal               */
/* ---------------------------------------------------------------- */

/**
 * Slim bottom drawer for asteroid dives: slides up immediately with a
 * tier-toned opener (one of 500: 10 tiers × 50 unique lines), the vault's
 * exact value, and the standing order: collect it and keep exploring to
 * climb the hunt.
 */
function RockDrawer() {
  const exitCave = useGalaxyStore((s) => s.exitCave);
  const visitSeed = useGalaxyStore((s) => s.visitSeed);
  const rockBiomeSeed = useGalaxyStore((s) => s.rockBiomeSeed);
  const lootCollectedIds = useFragmentsStore((s) => s.lootCollectedIds);
  const reducedMotion = useReducedMotion();

  const { biomeKey, lootSeed } = caveLootIdentity("rock", rockBiomeSeed, visitSeed);
  const roll = rollCenterCrystal(lootSeed);
  const tier = tierForValue(roll.value);
  const opener = crystalOpener(tier, lootSeed);
  const collected = lootCollectedIds.includes(`loot-${biomeKey}-crystal`);
  const amount = formatFragments(roll.value);

  return (
    <motion.section
      role="dialog"
      aria-label="Asteroid vault"
      initial={reducedMotion ? { opacity: 0 } : { y: "130%" }}
      animate={
        reducedMotion
          ? { opacity: 1, transition: { duration: 0.5 } }
          : {
              y: 0,
              transition: { duration: 0.65, ease: [0.16, 1, 0.3, 1] },
            }
      }
      exit={
        reducedMotion
          ? { opacity: 0, transition: { duration: 0.3 } }
          : { y: "130%", transition: { duration: 0.6, ease: [0.4, 0, 0.6, 1] } }
      }
      className="pointer-events-auto absolute inset-x-2 bottom-2 z-30 sm:inset-x-6 lg:inset-x-8 lg:bottom-10"
    >
      <div
        className="chrome-border card-depth relative mx-auto w-full max-w-2xl rounded-3xl px-6 py-4 sm:px-8"
        style={{ background: "var(--gradient-panel)" }}
        data-scroll-safe
      >
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div className="min-w-0 flex-1">
            <p className="micro-label">
              {tier.name} · Vault of {amount} fragments
            </p>
            <p className="mt-1.5 text-[0.82rem] leading-relaxed text-silver-300">
              {collected ? (
                <>Vault collected. Dive into more asteroids to climb the
                hunt.</>
              ) : (
                <>
                  {opener}{" "}
                  <span className="text-silver-50">
                    Tap the crystal to collect {amount} fragments
                  </span>{" "}
                  and climb the hunt.
                </>
              )}
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => exitCave()}
            className="min-h-0 shrink-0 px-5 py-2.5 text-[0.6rem] uppercase"
          >
            Return
          </Button>
        </div>
      </div>
    </motion.section>
  );
}

/* ---------------------------------------------------------------- */
/* the galaxy leaderboard — live ranks inside the crystal cave        */
/* ---------------------------------------------------------------- */

const STANDING_TITLES = {
  win: "You are climbing",
  draw: "You are holding",
  lose: "You are falling",
} as const;

/**
 * The live board, split across three floating islands:
 *
 *  1. The call — title plus the glowing reason to collect and climb.
 *  2. The board — ten fixed seats as pure rows (open seats render as
 *     quiet placeholders until claimed) plus your own standing row,
 *     with the only close control.
 *  3. The pulse — galaxy totals and the active-explorer heartbeat.
 */
interface HunterProfile {
  alias?: string | null;
}

type HuntBoardRow =
  | {
      kind: "leader";
      key: string;
      place: number;
      alias: string | null;
      total: number;
      isMe: boolean;
    }
  | {
      kind: "standing";
      key: "my-standing";
      place: number | "—";
      total: number;
      tier: keyof typeof STANDING_TITLES;
    };

function LeaderboardFlow() {
  const exitCave = useGalaxyStore((s) => s.exitCave);
  const enterCave = useGalaxyStore((s) => s.enterCave);
  const toggleMission = useAudioStore((s) => s.toggleMission);
  const missionPlaying = useAudioStore((s) => s.missionPlaying);
  const connect = useLeaderboardStore((s) => s.connect);
  const disconnect = useLeaderboardStore((s) => s.disconnect);
  const rows = useLeaderboardStore((s) => s.rows);
  const fragmentsTotal = useLeaderboardStore((s) => s.fragmentsTotal);
  const activeExplorers = useLeaderboardStore((s) => s.activeExplorers);
  const myRank = useLeaderboardStore((s) => s.myRank);
  const myTotal = useLeaderboardStore((s) => s.myTotal);
  const myUserId = useLeaderboardStore((s) => s.myUserId);
  const standingTier = useLeaderboardStore((s) => s.standingTier);
  const updateNonce = useLeaderboardStore((s) => s.updateNonce);
  const [profile, setProfile] = useState<HunterProfile | null | "loading">(
    "loading",
  );

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  useEffect(() => {
    (async () => {
      await Promise.resolve();
      try {
        const raw = window.localStorage.getItem("vx_profile");
        setProfile(raw ? (JSON.parse(raw) as HunterProfile) : null);
      } catch {
        setProfile(null);
      }
    })();
  }, []);

  const isAuthed = profile !== "loading" && profile !== null;

  // The board renders the signed-in visitor inside the same ordered list.
  // If they are not present in the top rows yet, insert their server-ranked
  // standing at that position instead of dropping it below the table.
  const topRows = rows.slice(0, 10);
  const myPlace = myRank ?? "—";
  const boardRows: HuntBoardRow[] = topRows.map((row, index) => ({
    kind: "leader",
    key: row.userId,
    place: index + 1,
    alias: row.alias,
    total: row.total,
    isMe: Boolean(myUserId) && row.userId === myUserId,
  }));
  const hasVisibleStanding = boardRows.some((row) => row.kind === "leader" && row.isMe);
  let insertedStandingAt: number | null = null;

  if (isAuthed && !hasVisibleStanding) {
    const insertAt =
      typeof myRank === "number"
        ? Math.max(0, Math.min(myRank - 1, boardRows.length))
        : boardRows.length;
    insertedStandingAt = insertAt;
    boardRows.splice(insertAt, 0, {
      kind: "standing",
      key: "my-standing",
      place: myPlace,
      total: myTotal,
      tier: standingTier,
    });
  }

  if (
    insertedStandingAt !== null &&
    typeof myRank === "number" &&
    insertedStandingAt < boardRows.length - 1
  ) {
    boardRows.forEach((row, index) => {
      if (row.kind === "leader" && index > insertedStandingAt) {
        row.place = index + 1;
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* island 1 — the call */}
      <SlideUpCard
        index={0}
        className="chrome-border card-depth relative w-full rounded-3xl p-6 sm:p-7"
        style={{ background: "var(--gradient-panel)" }}
      >
        <p className="micro-label">Hunt</p>
        <h2 className="font-display mt-3 text-2xl tracking-[0.1em] text-silver-50">
          The great collectors
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-silver-100 [text-shadow:0_0_14px_rgba(196,204,212,0.6),0_0_34px_rgba(196,204,212,0.25)]">
          Collect Intelligence Fragments hidden across the Vorinthex galaxy.
          The higher you stand at launch, the greater your prizes, offers,
          and early access.
        </p>
      </SlideUpCard>

      {/* island 2 — hunt actions, attached to the hunt card instead of
          floating above it as a separate lead-in. */}
      <SlideUpCard
        index={1}
        className="chrome-border card-depth relative w-full rounded-3xl p-4"
        style={{ background: "var(--gradient-panel)" }}
      >
        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            onClick={() => {
              trackCtaClick("mission_audio", { placement: "hunt" });
              toggleMission();
            }}
            icon={<SpeakerIcon animated={missionPlaying} />}
            className="w-full px-5 py-3.5 text-xs uppercase"
          >
            <span className="animate-[fade-in_0.4s_ease-out]">
              {missionPlaying ? "Stop" : "Briefing"}
            </span>
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              trackCtaClick("hunt_return", { placement: "hunt" });
              exitCave();
              syncEntityUrl("/");
            }}
            className="w-full px-5 py-3 text-[0.62rem] uppercase"
          >
            Start collecting
          </Button>
        </div>
      </SlideUpCard>

      {/* island 3 — the board: pure rows, no close control (Start
          collecting above is the way back to fragment hunting) */}
      <SlideUpCard
        index={2}
        className="chrome-border card-depth relative w-full rounded-3xl p-6 sm:p-7"
        style={{ background: "var(--gradient-panel)" }}
      >
        <div className="pr-1">
        <div className="space-y-2">
          {boardRows.map((row) => {
            if (row.kind === "standing") {
              return (
                <div
                  key={row.key}
                  className="rounded-xl border border-silver-300/35 bg-white/[0.065] px-3.5 py-2.5 shadow-[0_0_32px_rgba(196,204,212,0.1)]"
                >
                  <p className="font-mono text-[0.5rem] tracking-[0.26em] text-silver-500 uppercase">
                    {STANDING_TITLES[row.tier]}
                  </p>
                  <p className="mt-1 flex items-baseline gap-3 text-sm">
                    <span className="w-6 shrink-0 font-mono text-[0.6rem] tracking-[0.2em] text-silver-300">
                      {row.place}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[0.82rem] text-silver-50">
                      You
                    </span>
                    <span className="shrink-0 font-mono text-[0.72rem] text-silver-50 tabular-nums">
                      {formatFragments(row.total)}
                    </span>
                  </p>
                </div>
              );
            }

            return (
              <p
                key={row.key}
                className={`flex items-baseline gap-3 rounded-xl border px-3.5 py-1.5 text-sm ${
                  row.isMe
                    ? "border-silver-300/40 bg-white/[0.07]"
                    : "border-white/8 bg-white/[0.02]"
                }`}
              >
                <span className="w-6 shrink-0 font-mono text-[0.6rem] tracking-[0.2em] text-silver-500">
                  {row.place}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate text-[0.82rem] ${
                    row.isMe ? "text-silver-50" : "text-silver-200"
                  }`}
                >
                  {row.isMe ? "You" : (row.alias ?? "Unnamed Explorer")}
                </span>
                <span className="shrink-0 font-mono text-[0.72rem] text-silver-50 tabular-nums">
                  {formatFragments(row.total)}
                </span>
              </p>
            );
          })}
        </div>

        {/* Signed-out visitors get the join/sign-in call after the board. */}
        {!isAuthed && profile !== "loading" ? (
          <div className="mt-3 flex flex-col gap-4">
            <p className="text-[0.78rem] leading-relaxed text-silver-500">
              Sign in with your email to sync your haul. New explorers are
              created automatically.
            </p>
            <div className="flex flex-col gap-2">
              <Button
                variant="primary"
                onClick={() => {
                  trackCtaClick("signin_gate_open", { placement: "hunt_standing" });
                  enterCave("signin");
                }}
                className="w-full px-5 py-3.5 text-xs uppercase"
              >
                Sign in
              </Button>
            </div>
          </div>
        ) : null}
        </div>
      </SlideUpCard>

      {/* island 4 — the galaxy pulse */}
      <SlideUpCard
        index={3}
        className="chrome-border card-depth relative w-full rounded-3xl px-6 py-4 sm:px-7"
        style={{ background: "var(--gradient-panel)" }}
      >
        <p className="text-center font-mono text-[0.55rem] tracking-[0.22em] text-silver-300 uppercase">
          {formatFragments(fragmentsTotal)} total fragments collected across the galaxy
        </p>
        <p className="mt-1.5 text-center text-[0.7rem] leading-relaxed text-silver-500">
          {galaxyPulseLine(activeExplorers, updateNonce * 48271 + 7)}
        </p>
      </SlideUpCard>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* the exchange — spark plans, on-demand usage, and top-ups           */
/* ---------------------------------------------------------------- */

/**
 * Spark pricing across three floating islands, cascading in like the
 * hunt: monthly plans first, then on-demand usage, then instant top-up
 * packs. Registry-driven — the /pricing page body and llms.txt render
 * the same `sparkPricing` object.
 */
function PricingFlow() {
  const exitCave = useGalaxyStore((s) => s.exitCave);
  const { summary, plans, onDemand, topUps } =
    VORINTHEX_GALAXY_REGISTRY.sparkPricing;

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* island 1 — the monthly plans, with the only close control */}
      <SlideUpCard
        index={0}
        className="chrome-border card-depth relative w-full rounded-3xl p-6 sm:p-7"
        style={{ background: "var(--gradient-panel)" }}
      >
        <button
          type="button"
          onClick={() => {
            trackCtaClick("cave_close", { cave_kind: "pricing" });
            exitCave();
            syncEntityUrl("/");
          }}
          aria-label="Leave the cave"
          className="absolute top-4 right-4 rounded-full border border-white/10 p-2 text-silver-500 transition-colors hover:border-white/25 hover:text-silver-100"
        >
          <CloseIcon width={12} height={12} />
        </button>
        <p className="micro-label">Pricing</p>
        <h2 className="font-display mt-3 text-2xl tracking-[0.1em] text-silver-50">
          Plans
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-silver-300">{summary}</p>
        <div className="mt-4 space-y-1">
          {plans.map((plan) => (
            <p
              key={plan.id}
              className="flex items-baseline gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate text-[0.82rem] text-silver-50">
                {plan.name}
              </span>
              <span className="shrink-0 font-mono text-[0.72rem] text-silver-300 tabular-nums">
                {plan.monthlySparks.toLocaleString("en-US")} Sparks
              </span>
              <span className="shrink-0 font-mono text-[0.72rem] text-silver-50 tabular-nums">
                ${plan.priceUsd}/mo
              </span>
            </p>
          ))}
        </div>
      </SlideUpCard>

      {/* island 2 — instant top-up packs */}
      <SlideUpCard
        index={1}
        className="chrome-border card-depth relative w-full rounded-3xl p-6 sm:p-7"
        style={{ background: "var(--gradient-panel)" }}
      >
        <p className="micro-label">Top-ups</p>
        <h3 className="font-display mt-3 text-xl tracking-[0.1em] text-silver-50">
          {topUps.name}
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-silver-300">
          {topUps.description}
        </p>
        <div className="mt-4 space-y-1">
          {topUps.packs.map((pack) => (
            <p
              key={pack.id}
              className="flex items-baseline gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate text-[0.82rem] text-silver-50">
                {pack.name}
              </span>
              <span className="shrink-0 font-mono text-[0.72rem] text-silver-300 tabular-nums">
                {pack.sparks.toLocaleString("en-US")} Sparks
              </span>
              <span className="shrink-0 font-mono text-[0.72rem] text-silver-50 tabular-nums">
                ${pack.priceUsd}
              </span>
            </p>
          ))}
        </div>
      </SlideUpCard>

      {/* island 3 — on-demand usage */}
      <SlideUpCard
        index={2}
        className="chrome-border card-depth relative w-full rounded-3xl p-6 sm:p-7"
        style={{ background: "var(--gradient-panel)" }}
      >
        <p className="micro-label">On demand</p>
        <h3 className="font-display mt-3 text-xl tracking-[0.1em] text-silver-50">
          {onDemand.name}
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-silver-300">
          {onDemand.description}
        </p>
      </SlideUpCard>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* static vaults — privacy, terms, about & contact, read by cavern    */
/* light                                                              */
/* ---------------------------------------------------------------- */

function VaultReaderFlow({ copy }: { copy: VaultCopy }) {
  return (
    <div>
      <p className="micro-label">{copy.eyebrow}</p>
      <h2 className="font-display mt-3 text-2xl tracking-[0.1em] text-silver-50">
        {copy.title}
      </h2>
      <div className="scrollbar-hide mt-4 max-h-[46dvh] space-y-4 overflow-y-auto text-sm leading-relaxed text-silver-300">
        {copy.paragraphs.map((paragraph) => (
          <p key={paragraph.slice(0, 24)}>{paragraph}</p>
        ))}
        <p className="text-[0.7rem] text-silver-700">{copy.footnote}</p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* 1+2 — join inside the cave                                        */
/* ---------------------------------------------------------------- */

/**
 * While a "check your inbox" screen waits, ride the handoff stream: the
 * moment the emailed link is tapped — on any device, in any mail app —
 * this browser claims its own session and jumps into the galaxy.
 */
function useHandoffJump(active: boolean, placement: string) {
  const claimed = useRef(false);
  useEffect(() => {
    if (!active) return;
    return watchHandoff(() => {
      void (async () => {
        if (claimed.current) return;
        const profile = await claimHandoffSession();
        if (!profile || claimed.current) return;
        claimed.current = true;
        if (profile.status === "authenticated") {
          trackLandingEvent({
            slug: "auth.magic_link_authenticated",
            metadata: { flow: "handoff", placement },
          });
          useGalaxyStore.getState().startJump("public");
          return;
        }
        setMagicHandoff({
          status: profile.status,
          challengeTokenHash: profile.challengeTokenHash,
        });
        useGalaxyStore.getState().enterCave("magic");
      })();
    });
  }, [active, placement]);
}

const OAUTH_FAILURE_COPY: Record<string, string> = {
  provider_not_configured:
    "This sign-in method isn't set up yet. Try email instead.",
  provider_denied: "The provider sign-in was cancelled.",
};

/**
 * Only ever entered on a FAILED OAuth callback — ArrivalJump handles the
 * success path itself (arrival="oauth-callback" on the callback page),
 * hyper-jumping straight to the public galaxy with no biome stop. This
 * cave is ArrivalJump's fallback when the provider callback reports
 * anything other than status=success.
 */
function OAuthCallbackFlow() {
  // Only ever mounted client-side (see the doc comment above) after
  // ArrivalJump has already decided this is a failure, so reading the
  // query string in the initializer is safe — no SSR mismatch to dodge.
  const [failureReason] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("reason"),
  );

  return (
    <div>
      <p className="micro-label">Provider Gate</p>
      <h2 className="font-display mt-3 text-2xl tracking-[0.1em] text-silver-50">
        Sign in did not complete.
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-silver-500">
        {(failureReason && OAUTH_FAILURE_COPY[failureReason]) ??
          "Try again with email, Google, or Apple."}
      </p>
      <Button
        variant="primary"
        onClick={() => useGalaxyStore.getState().enterCave("signin")}
        className="mt-5 w-full px-5 py-3.5 text-xs uppercase"
      >
        Sign in
      </Button>
    </div>
  );
}

/**
 * A founder's email hit ordinary sign-in or OAuth. Deliberately no
 * "Founders Gate" label, no CTA, no hint at the real entry method — the
 * close button above (shared by every non-sealed cave) is the only way
 * out, same as it is everywhere else.
 */
function FoundersMysteryFlow() {
  return (
    <div>
      <h2 className="font-display mt-3 text-2xl leading-snug tracking-[0.08em] text-silver-50">
        You are not like the others.
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-silver-300">
        Somewhere in this system, another door already knows your name.
      </p>
    </div>
  );
}

interface StoredProfile {
  email?: string;
  alias?: string | null;
  waitlistNumber?: number | null;
  welcomeLine?: string | null;
}

/**
 * Sign-in for galaxy explorers (waitlist users): shows the welcome line,
 * alias, waitlist number, and fragments collected. Members with vault
 * access go through the Members Gate instead.
 */
function ExplorerSigninFlow() {
  const exitCave = useGalaxyStore((s) => s.exitCave);
  const enterCave = useGalaxyStore((s) => s.enterCave);
  const balance = useFragmentsStore((s) => s.balance);
  const collectedCount = useFragmentsStore((s) => s.collectedIds.length);
  const pendingCollect = useFragmentsStore((s) => s.pendingCollect);
  const applyCollect = useFragmentsStore((s) => s.applyCollect);
  const [profile, setProfile] = useState<StoredProfile | null | "loading">(
    "loading",
  );
  const [method, setMethod] = useState<"choose" | "email">("choose");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState("");
  const formStarted = useRef(false);
  useHandoffJump(status === "sent", "signin_cave");

  function openLegalVault(kind: "terms" | "privacy") {
    trackCtaClick("legal_open", { legal_kind: kind, placement: "signin_cave" });
    enterCave(kind);
    syncEntityUrl(`/${kind}`);
  }

  useEffect(() => {
    (async () => {
      await Promise.resolve();
      try {
        const raw = window.localStorage.getItem("vx_profile");
        setProfile(raw ? (JSON.parse(raw) as StoredProfile) : null);
      } catch {
        setProfile(null);
      }
    })();
  }, []);

  // A verified explorer on this device: greet them and show their haul.
  if (profile !== "loading" && profile !== null) {
    return (
      <div>
        <h2 className="font-display mt-3 text-2xl leading-snug tracking-[0.06em] text-silver-50">
          {profile.welcomeLine ??
            `Welcome back${profile.alias ? `, ${profile.alias}` : ""}.`}
        </h2>
        <div className="mt-5 space-y-2.5">
          {profile.waitlistNumber ? (
            <p className="flex items-baseline justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-silver-300">
              <span className="font-mono text-[0.55rem] tracking-[0.2em] text-silver-500 uppercase">
                Hunt place
              </span>
              <span className="text-silver-50">
                #{profile.waitlistNumber.toLocaleString("en-US")}
              </span>
            </p>
          ) : null}
          <p className="flex items-baseline justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-silver-300">
            <span className="font-mono text-[0.55rem] tracking-[0.2em] text-silver-500 uppercase">
              Fragments collected
            </span>
            <span className="text-silver-50">
              {balance.toLocaleString("en-US")}
            </span>
          </p>
          <p className="flex items-baseline justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-silver-300">
            <span className="font-mono text-[0.55rem] tracking-[0.2em] text-silver-500 uppercase">
              Treasures found
            </span>
            <span className="text-silver-50">{collectedCount}</span>
          </p>
        </div>
        {profile.alias ? (
          <p className="mt-3 font-mono text-[0.55rem] tracking-[0.24em] text-silver-500 uppercase">
            Registered as {profile.alias}
          </p>
        ) : null}
        <Button
          variant="primary"
          onClick={() => {
            exitCave();
            syncEntityUrl("/");
          }}
          className="mt-6 w-full px-5 py-3.5 text-xs"
        >
          Keep exploring
        </Button>
      </div>
    );
  }

  // No profile on this device: send a sign-in light (magic link). The
  // link validates as an explorer session and hyper-jumps straight into
  // their public galaxy — spot, alias, and fragment ledger restored.
  function updateEmail(value: string) {
    if (!formStarted.current) {
      formStarted.current = true;
      trackLandingEvent({
        slug: "waitlist.form_started",
        metadata: { form: "signin_restore" },
      });
    }
    setEmail(value);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (status === "submitting") return;
    trackLandingEvent({
      slug: "waitlist.submit_clicked",
      metadata: { form: "signin_restore" },
    });
    let normalizedEmail: string;
    try {
      normalizedEmail = normalizeEmailInput(email);
    } catch {
      setError("Use a valid email address.");
      setStatus("error");
      return;
    }
    setStatus("submitting");
    setError("");
    try {
      const response = await fetch("/api/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          // The carried treasure is stored against this email right away,
          // so the fragment survives even an abandoned magic link.
          ...(pendingCollect ? { collectibleId: pendingCollect.id } : {}),
        }),
      });
      const data = await response.json().catch(() => null);
      if (response.ok) {
        if (pendingCollect && data?.collect?.ok) {
          applyCollect(pendingCollect, {
            fragmentsAwarded: data.collect.fragmentsAwarded,
            balance: data.collect.balance,
            globalTotal: data.collect.globalTotal,
          });
        }
        if (
          data?.organization_mfa_required &&
          (data.status === "totp_setup_required" ||
            data.status === "totp_required") &&
          typeof data.totp_challenge_token_hash === "string"
        ) {
          window.localStorage.setItem("vx_member_email", normalizedEmail);
          if (typeof data.name === "string") {
            window.localStorage.setItem("vx_member_name", data.name);
          }
          if (typeof data.title === "string") {
            window.localStorage.setItem("vx_member_title", data.title);
          }
          setMagicHandoff({
            status: data.status,
            challengeTokenHash: data.totp_challenge_token_hash,
          });
          useGalaxyStore.getState().enterCave("organization-signin");
          return;
        }
        // Members get a TOTP step after their link; remember who asked so
        // the sun can greet them and MFA recovery knows the email.
        window.localStorage.setItem("vx_member_email", normalizedEmail);
        setEmail(normalizedEmail);
        setStatus("sent");
      } else if (data?.founders_gate_required) {
        // No hint at the real entry method — just an unbranded, mysterious
        // non-answer, same as OAuth gets for the same email.
        useGalaxyStore.getState().enterCave("founders-mystery");
        return;
      } else {
        setError(parseApiError(data, "Could not send your link. Try again."));
        setStatus("error");
      }
    } catch {
      setError("Could not reach the Nexus. Try again.");
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div>
        <h2 className="font-display mt-3 text-2xl tracking-[0.1em] text-silver-50">
          Check your inbox.
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-silver-300">
          A light is on its way to {email}. Tap it on any device you like.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-silver-500">
          Keep this screen open and it signs itself in the moment the
          light lands.
        </p>
      </div>
    );
  }

  // Step 1: choose a way in. Email opens the second step below; Google
  // and Apple hand off straight to the provider gate.
  if (method === "choose") {
    return (
      <div>
        <h2 className="font-display mt-3 text-2xl tracking-[0.1em] text-silver-50">
          Sign in to the Hunt.
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-silver-500">
          Continue with email, Google, or Apple to create or restore your
          explorer profile, alias, and fragments.
        </p>
        {pendingCollect ? (
          <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 font-mono text-[0.55rem] tracking-[0.2em] text-silver-300 uppercase">
            Collecting: {pendingCollect.name} · +
            {pendingCollect.fragments.toLocaleString("en-US")} fragments
          </p>
        ) : null}
        <div className="mt-6 flex flex-col gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              trackCtaClick("signin_method_email", { placement: "signin_cave" });
              setMethod("email");
            }}
            className="w-full px-5 py-3.5 text-xs uppercase"
          >
            Continue with email
          </Button>
          <a
            href="/api/auth/oauth/google/start"
            onClick={() =>
              trackCtaClick("signin_method_google", { placement: "signin_cave" })
            }
            className="vui-button vui-button-secondary inline-flex w-full items-center justify-center px-5 py-3.5 text-xs uppercase"
          >
            Continue with Google
          </a>
          <a
            href="/api/auth/oauth/apple/start"
            onClick={() =>
              trackCtaClick("signin_method_apple", { placement: "signin_cave" })
            }
            className="vui-button vui-button-secondary inline-flex w-full items-center justify-center px-5 py-3.5 text-xs uppercase"
          >
            Continue with Apple
          </a>
        </div>
        <p className="mt-5 text-center text-[0.68rem] leading-relaxed text-silver-500">
          By continuing you agree to our{" "}
          <button
            type="button"
            onClick={() => openLegalVault("terms")}
            className="underline decoration-white/20 underline-offset-2 transition-colors hover:text-silver-100"
          >
            Terms of Service
          </button>{" "}
          and{" "}
          <button
            type="button"
            onClick={() => openLegalVault("privacy")}
            className="underline decoration-white/20 underline-offset-2 transition-colors hover:text-silver-100"
          >
            Privacy Policy
          </button>
          .
        </p>
      </div>
    );
  }

  // Step 2: email. Reached only via "Continue with email" above.
  return (
    <form onSubmit={handleSubmit}>
      <button
        type="button"
        onClick={() => setMethod("choose")}
        className="font-mono text-[0.58rem] tracking-[0.24em] text-silver-500 uppercase transition-colors hover:text-silver-100"
      >
        ← Back
      </button>
      <h2 className="font-display mt-3 text-2xl tracking-[0.1em] text-silver-50">
        Sign in with email.
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-silver-500">
        Enter your email to create or restore your explorer profile,
        alias, and fragments.
      </p>
      {pendingCollect ? (
        <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 font-mono text-[0.55rem] tracking-[0.2em] text-silver-300 uppercase">
          Collecting: {pendingCollect.name} · +
          {pendingCollect.fragments.toLocaleString("en-US")} fragments
        </p>
      ) : null}
      <label className="mt-6 block">
        <span className="sr-only">Email address</span>
        <TextInput
          type="email"
          required
          autoFocus
          value={email}
          onChange={(event) => updateEmail(event.target.value)}
          placeholder="Enter your email"
          className="w-full px-5 py-3.5 text-sm"
        />
      </label>
      <Button
        type="submit"
        variant="primary"
        loading={status === "submitting"}
        className="mt-4 w-full px-5 py-3.5 text-xs uppercase"
      >
        Sign in
      </Button>
      <p aria-live="polite" className="mt-3 min-h-4 text-xs text-silver-500">
        {status === "error" ? error : ""}
      </p>
    </form>
  );
}

/* ---------------------------------------------------------------- */
/* 3 — waitlist email verification inside the Ember Vault            */
/* ---------------------------------------------------------------- */

interface VerifiedProfile {
  email: string;
  alias: string | null;
  aliasSlug: string | null;
  waitlistNumber: number | null;
  welcomeLine: string | null;
}

function WaitlistVerifyFlow() {
  const startJump = useGalaxyStore((s) => s.startJump);
  const [state, setState] = useState<
    | { phase: "verifying" }
    | { phase: "verified"; profile: VerifiedProfile }
    | { phase: "failed" }
  >({ phase: "verifying" });
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    (async () => {
      await Promise.resolve();
      const token = new URLSearchParams(window.location.search).get(
        "token_hash",
      );
      if (!token) {
        setState({ phase: "failed" });
        return;
      }
      try {
        const response = await fetch(
          `/api/waitlist/verify?token_hash=${encodeURIComponent(token)}`,
        );
        const data = await response.json();
        if (!response.ok || !data.ok) {
          setState({ phase: "failed" });
          return;
        }
        const profile: VerifiedProfile = {
          email: data.email,
          alias: data.alias,
          aliasSlug: data.aliasSlug ?? null,
          waitlistNumber: data.waitlistNumber,
          welcomeLine: data.welcomeLine,
        };
        window.localStorage.setItem("vx_profile", JSON.stringify(profile));
        window.dispatchEvent(new Event("vx-profile-changed"));
        setState({ phase: "verified", profile });
        window.setTimeout(() => startJump("public"), 450);
      } catch {
        setState({ phase: "failed" });
      }
    })();
  }, [startJump]);
  // (all updates above run in async continuations, never sync in the effect)

  if (state.phase === "verifying") {
    return (
      <div>
        <p className="micro-label">Ember Vault</p>
        <h2 className="font-display mt-3 text-2xl tracking-[0.1em] text-silver-50">
          Reading your sigil…
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-silver-500">
          The vault is matching this link against the Hunt ledger.
        </p>
        <div className="mt-6 h-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/3 animate-[chrome-sheen_1.6s_linear_infinite] rounded-full bg-silver-300/70" />
        </div>
      </div>
    );
  }

  if (state.phase === "failed") {
    return (
      <div>
        <p className="micro-label">Ember Vault</p>
        <h2 className="font-display mt-3 text-2xl tracking-[0.1em] text-silver-50">
          This link has gone cold.
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-silver-300">
          Verification links burn out after 12 hours. Join again with the
          same email and we will send a fresh one. Your Hunt profile is still
          waiting.
        </p>
        <Button
          variant="primary"
          onClick={() => {
            trackCtaClick("waitlist_retry", { placement: "verify_failed" });
            useGalaxyStore.getState().enterCave("join");
          }}
          className="mt-5 min-h-0 px-6 py-3 text-[0.62rem]"
        >
          Request a new link
        </Button>
      </div>
    );
  }

  const { profile } = state;
  return (
    <div>
      <p className="micro-label">Hunt profile secured</p>
      <h2 className="font-display mt-3 text-2xl leading-snug tracking-[0.06em] text-silver-50">
        {profile.welcomeLine ??
          `Welcome${profile.alias ? `, ${profile.alias}` : ""}. You have joined The Hunt.`}
      </h2>
      {profile.waitlistNumber ? (
        <p className="mt-4 text-sm leading-relaxed text-silver-300">
          You are{" "}
          <span className="text-silver-50">
            Hunt explorer #{profile.waitlistNumber.toLocaleString("en-US")}
          </span>{" "}
          in The Hunt. Your profile is secured. See you soon.
        </p>
      ) : (
        <p className="mt-4 text-sm leading-relaxed text-silver-300">
          Your Hunt profile is secured. See you soon.
        </p>
      )}
      {profile.alias ? (
        <p className="mt-2 font-mono text-[0.55rem] tracking-[0.24em] text-silver-500 uppercase">
          Registered as {profile.alias}
        </p>
      ) : null}
      <p className="mt-6 font-mono text-[0.55rem] tracking-[0.24em] text-silver-500 uppercase">
        Opening your public galaxy
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* 6+7 — magic link → TOTP inside the Cipher Chamber                 */
/* ---------------------------------------------------------------- */

function MagicFlow() {
  const startJump = useGalaxyStore((s) => s.startJump);
  const [state, setState] = useState<
    | { phase: "validating" }
    | { phase: "setup"; data: TotpSetupData }
    | { phase: "verify"; challenge: string }
    | { phase: "failed"; message: string }
  >({ phase: "validating" });
  const requested = useRef(false);

  const beginSetup = useCallback(async (challenge: string) => {
    const response = await fetch("/api/auth/totp/setup/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge_token_hash: challenge }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      setState({
        phase: "failed",
        message: "Could not start authenticator setup. Request a new link.",
      });
      return;
    }
    setState({
      phase: "setup",
      data: {
        challenge: data.setup_challenge_token_hash,
        qr: data.qr_code_data_url,
        secret: data.secret,
        otpauthUrl: data.otpauth_url,
      },
    });
  }, []);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    (async () => {
      await Promise.resolve();

      // The arrival flow may have already validated this (single-use)
      // token while the visitor flew through the solar system.
      const handoff = takeMagicHandoff();
      if (handoff) {
        if (handoff.status === "totp_setup_required") {
          await beginSetup(handoff.challengeTokenHash);
        } else {
          setState({ phase: "verify", challenge: handoff.challengeTokenHash });
        }
        return;
      }

      const token = new URLSearchParams(window.location.search).get(
        "token_hash",
      );
      if (!token) {
        setState({
          phase: "failed",
          message: "This link is malformed.",
        });
        return;
      }
      try {
        const response = await fetch("/api/auth/magic/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token_hash: token }),
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          setState({
            phase: "failed",
            message: "This link is invalid or has expired.",
          });
          return;
        }
        if (data.status === "authenticated") {
          trackLandingEvent({
            slug: "auth.magic_link_authenticated",
            metadata: { flow: "user", placement: "cipher_chamber" },
          });
          // An explorer session, reached from a ?flow=member link — same
          // foreign-surface check ArrivalJump applies for the ?flow=user
          // path: only the browser that requested the light jumps in.
          if (!hasPendingHandoff()) {
            setLinkLanding({
              action: "signin",
              alias: data.alias ?? null,
              aliasSlug: data.alias_slug ?? null,
              waitlistNumber: data.waitlist_number ?? null,
            });
            useGalaxyStore.getState().enterCave("sealed");
            return;
          }
          window.localStorage.setItem(
            "vx_profile",
            JSON.stringify({
              alias: data.alias ?? null,
              aliasSlug: data.alias_slug ?? null,
              waitlistNumber: data.waitlist_number ?? null,
              welcomeLine: data.welcome_line ?? null,
            }),
          );
          window.dispatchEvent(new Event("vx-profile-changed"));
          startJump("public");
          return;
        }
        if (data.status === "totp_setup_required") {
          if (!hasPendingHandoff()) {
            setLinkLanding({
              action: "member",
              alias: null,
              waitlistNumber: null,
            });
            useGalaxyStore.getState().enterCave("sealed");
            return;
          }
          await beginSetup(data.totp_challenge_token_hash);
        } else {
          if (!hasPendingHandoff()) {
            setLinkLanding({
              action: "member",
              alias: null,
              waitlistNumber: null,
            });
            useGalaxyStore.getState().enterCave("sealed");
            return;
          }
          setState({
            phase: "verify",
            challenge: data.totp_challenge_token_hash,
          });
        }
      } catch {
        setState({ phase: "failed", message: "The chamber did not answer." });
      }
    })();
  }, [beginSetup, startJump]);

  if (state.phase === "validating") {
    return (
      <div
        className="h-[420px] animate-pulse"
        aria-busy="true"
        aria-label="Loading the Solar Gate"
      >
        <Skeleton className="h-2 w-24 rounded-full bg-white/10" />
        <Skeleton className="mt-5 h-7 w-52 rounded-md bg-white/10" />
        <Skeleton className="mt-9 h-14 w-full rounded-2xl bg-white/8" />
        <Skeleton className="mt-4 h-12 w-full rounded-full bg-white/8" />
        <Skeleton className="mt-8 h-px w-full bg-white/8" />
        <Skeleton className="mx-auto mt-7 h-2 w-32 rounded-full bg-white/8" />
        <Skeleton className="mt-4 h-11 w-full rounded-full bg-white/8" />
      </div>
    );
  }

  if (state.phase === "failed") {
    return (
      <div>
        <p className="micro-label">Cipher Chamber</p>
        <h2 className="font-display mt-3 text-2xl tracking-[0.1em] text-silver-50">
          The seal held.
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-silver-300">
          {state.message}
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            // Everyone requests a fresh link in the sign-in grove — the
            // backend still routes members through their TOTP flow.
            trackCtaClick("signin_gate_open", { placement: "magic_failed" });
            useGalaxyStore.getState().enterCave("signin");
          }}
          className="mt-5 min-h-0 px-6 py-3 text-[0.62rem] uppercase"
        >
          Request a new link
        </Button>
      </div>
    );
  }

  // TOTP itself is the real proof for members — it must be completed on
  // whatever device the visitor is holding, so THIS browser earned the
  // session. No sealed detour: straight into the star.
  const onTotpSuccess = (name: string | null, title: string | null) => {
    // The sun greets the member by their real name and platform title.
    if (name) window.localStorage.setItem("vx_member_name", name);
    if (title) window.localStorage.setItem("vx_member_title", title);
    startJump("sun");
  };

  if (state.phase === "setup") {
    return <TotpSetupPanel data={state.data} onSuccess={onTotpSuccess} />;
  }

  return (
    <TotpVerifyPanel
      challenge={state.challenge}
      onSuccess={onTotpSuccess}
      onLostAccess={(data) => {
        setMagicHandoff({
          status: "totp_setup_required",
          challengeTokenHash: data.challenge,
        });
        useGalaxyStore.getState().enterCave("organization-signin");
      }}
    />
  );
}
