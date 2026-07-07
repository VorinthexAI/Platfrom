"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Button, TextInput } from "@vorinthex/shared/ui/components";
import { rollCenterCrystal } from "@/components/galaxy/BiomeLoot";
import { EruptAssembly } from "@/components/ui/EruptAssembly";
import { CloseIcon } from "@/components/ui/icons";
import { trackCtaClick, trackLandingEvent } from "@/lib/analytics";
import { takeMagicHandoff } from "@/lib/auth/magic-handoff";
import { CAVE_CONFIGS } from "@/lib/cave-config";
import { normalizeEmailInput, parseApiError } from "@/lib/email";
import { formatFragments } from "@/lib/format";
import { useFragmentsStore } from "@/lib/fragments/fragments-store";
import { caveLootIdentity, syncEntityUrl, useGalaxyStore } from "@/lib/galaxy-store";
import { galaxyPulseLine } from "@/lib/leaderboard/copy";
import { useLeaderboardStore } from "@/lib/leaderboard/leaderboard-store";
import { PRIVACY_COPY, TERMS_COPY } from "@/lib/legal-copy";
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
 *  5. members         — members email form (generic success, no probing)
 *  6. magic           — validates ?token_hash → TOTP setup (QR + 2 codes)
 *  7. magic           — returning member: single TOTP code
 *  8. success         — hyper jump into /galaxy/private or /galaxy/public
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
        ) : (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
            {/* the WHOLE card arrives like the emblem: shattered into grid
                shards, blasted out of the floor, fused in place — fresh on
                every entry */}
            <EruptAssembly
              key={`${caveKind}-${visitSeed}`}
              seed={visitSeed}
              className="pointer-events-auto w-full max-w-md"
            >
              <div
                className="chrome-border card-depth relative w-full rounded-3xl p-7 sm:p-9"
                style={{ background: "var(--gradient-panel)" }}
                data-scroll-safe
              >
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

                {caveKind === "join" ? <JoinFlow /> : null}
                {caveKind === "signin" ? <ExplorerSigninFlow /> : null}
                {caveKind === "members" ? <MembersFlow /> : null}
                {caveKind === "waitlist-verify" ? <WaitlistVerifyFlow /> : null}
                {caveKind === "magic" ? <MagicFlow /> : null}
                {caveKind === "privacy" ? <LegalFlow copy={PRIVACY_COPY} /> : null}
                {caveKind === "terms" ? <LegalFlow copy={TERMS_COPY} /> : null}
                {caveKind === "leaderboard" ? <LeaderboardFlow /> : null}
              </div>
            </EruptAssembly>
          </div>
        )
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* the uncharted rock — a slim drawer under the crystal               */
/* ---------------------------------------------------------------- */

/** The drawer waits below the fold this long before sliding into place. */
const ROCK_DRAWER_HOLD_SECONDS = 3;

/**
 * Slim bottom drawer for asteroid dives: held down for three seconds
 * (the eruption finishes, the crystal assembles), then one smooth slide
 * up — mirroring the planet drawer — with a tier-toned opener (one of
 * 500: 10 tiers × 50 unique lines), the vault's exact value, and the
 * standing order: claim it and keep exploring to climb the leaderboard.
 */
function RockDrawer() {
  const exitCave = useGalaxyStore((s) => s.exitCave);
  const visitSeed = useGalaxyStore((s) => s.visitSeed);
  const rockBiomeSeed = useGalaxyStore((s) => s.rockBiomeSeed);
  const lootClaimedIds = useFragmentsStore((s) => s.lootClaimedIds);
  const reducedMotion = useReducedMotion();

  const { biomeKey, lootSeed } = caveLootIdentity("rock", rockBiomeSeed, visitSeed);
  const roll = rollCenterCrystal(lootSeed);
  const tier = tierForValue(roll.value);
  const opener = crystalOpener(tier, lootSeed);
  const claimed = lootClaimedIds.includes(`loot-${biomeKey}-crystal`);
  const amount = formatFragments(roll.value);

  return (
    <motion.section
      role="dialog"
      aria-label="Asteroid vault"
      initial={reducedMotion ? { opacity: 0 } : { y: "130%" }}
      animate={
        reducedMotion
          ? { opacity: 1, transition: { delay: ROCK_DRAWER_HOLD_SECONDS, duration: 0.5 } }
          : {
              y: 0,
              transition: {
                delay: ROCK_DRAWER_HOLD_SECONDS,
                duration: 0.85,
                ease: [0.16, 1, 0.3, 1],
              },
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
              {claimed ? (
                <>Vault claimed. Keep exploring other asteroids to find more
                fragments and climb the leaderboard.</>
              ) : (
                <>
                  {opener}{" "}
                  <span className="text-silver-50">
                    Tap the crystal to claim {amount} Intelligence Fragments
                  </span>{" "}
                  — then keep exploring other asteroids to find more and
                  climb the leaderboard.
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
 * The live board: top ten collectors (never including you), your own
 * standalone row with a climbing/holding/falling read that re-rolls on
 * every SSE update, the galaxy totals, and the active-explorer pulse.
 * The chamber around it mounts every claimed piece in real time — new
 * finds toast in as they land.
 */
function LeaderboardFlow() {
  const connect = useLeaderboardStore((s) => s.connect);
  const disconnect = useLeaderboardStore((s) => s.disconnect);
  const rows = useLeaderboardStore((s) => s.rows);
  const fragmentsTotal = useLeaderboardStore((s) => s.fragmentsTotal);
  const activeExplorers = useLeaderboardStore((s) => s.activeExplorers);
  const myRank = useLeaderboardStore((s) => s.myRank);
  const standingTier = useLeaderboardStore((s) => s.standingTier);
  const standingText = useLeaderboardStore((s) => s.standingText);
  const updateNonce = useLeaderboardStore((s) => s.updateNonce);
  const balance = useFragmentsStore((s) => s.balance);
  const [alias, setAlias] = useState<string | null>(null);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  useEffect(() => {
    (async () => {
      await Promise.resolve();
      try {
        const raw = window.localStorage.getItem("vx_profile");
        const profile = raw ? (JSON.parse(raw) as { alias?: string | null }) : null;
        setAlias(profile?.alias ?? null);
      } catch {
        setAlias(null);
      }
    })();
  }, []);

  // Top ten OTHER explorers: the visitor never appears twice — their own
  // standing renders in the standalone row below.
  const visibleRows = rows
    .filter((row) => !alias || row.alias !== alias)
    .slice(0, 10);

  return (
    <div>
      <p className="micro-label">Galaxy Leaderboard</p>
      <h2 className="font-display mt-3 text-2xl tracking-[0.1em] text-silver-50">
        The great collectors.
      </h2>

      <div className="mt-4 space-y-1" data-scroll-safe>
        {visibleRows.length === 0 ? (
          <p className="py-4 text-center text-[0.72rem] text-silver-500">
            The board is still forming — be the first name on it.
          </p>
        ) : (
          visibleRows.map((row, index) => (
            <p
              key={row.userId}
              className="flex items-baseline gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-1.5 text-sm"
            >
              <span className="w-6 shrink-0 font-mono text-[0.6rem] tracking-[0.2em] text-silver-500">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-[0.82rem] text-silver-200">
                {row.alias ?? "Unnamed Explorer"}
              </span>
              <span className="shrink-0 font-mono text-[0.72rem] text-silver-50 tabular-nums">
                {formatFragments(row.total)}
              </span>
            </p>
          ))
        )}
      </div>

      {/* the visitor's own standing — always its own row */}
      <div className="mt-3 rounded-xl border border-white/15 bg-white/[0.05] px-3.5 py-2.5">
        <p className="font-mono text-[0.5rem] tracking-[0.26em] text-silver-500 uppercase">
          {STANDING_TITLES[standingTier]}
        </p>
        <p className="mt-1 flex items-baseline gap-3 text-sm">
          <span className="w-6 shrink-0 font-mono text-[0.6rem] tracking-[0.2em] text-silver-300">
            {myRank !== null && myRank <= rows.length ? myRank : "—"}
          </span>
          <span className="min-w-0 flex-1 truncate text-[0.82rem] text-silver-50">
            {alias ?? "You"}
          </span>
          <span className="shrink-0 font-mono text-[0.72rem] text-silver-50 tabular-nums">
            {formatFragments(balance)}
          </span>
        </p>
        <p className="mt-1.5 text-[0.7rem] leading-relaxed text-silver-300">
          {standingText ||
            "Claim fragments across the galaxy to take your place on the board."}
        </p>
      </div>

      <p className="mt-4 text-center font-mono text-[0.55rem] tracking-[0.22em] text-silver-300 uppercase">
        {formatFragments(fragmentsTotal)} total fragments claimed across the galaxy
      </p>
      <p className="mt-1.5 text-center text-[0.7rem] leading-relaxed text-silver-500">
        {galaxyPulseLine(activeExplorers, updateNonce * 48271 + 7)}
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* legal — privacy & terms, read by cavern light                      */
/* ---------------------------------------------------------------- */

function LegalFlow({
  copy,
}: {
  copy: { title: string; eyebrow: string; paragraphs: string[] };
}) {
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
        <p className="text-[0.7rem] text-silver-700">
          Questions? Reach us at hello@vorinthex.com.
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* 1+2 — join the waitlist inside the Reservation Vault              */
/* ---------------------------------------------------------------- */

function JoinFlow() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState("");
  const formStarted = useRef(false);
  const pendingClaim = useFragmentsStore((s) => s.pendingClaim);
  const markJoined = useFragmentsStore((s) => s.markJoined);
  const applyClaim = useFragmentsStore((s) => s.applyClaim);

  function updateEmail(value: string) {
    if (!formStarted.current) {
      formStarted.current = true;
      trackLandingEvent({
        slug: "waitlist.form_started",
        metadata: {
          form: "join",
          pending_collectible_id: pendingClaim?.id ?? null,
        },
      });
    }
    setEmail(value);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (status === "submitting") return;
    trackLandingEvent({
      slug: "waitlist.submit_clicked",
      metadata: {
        form: "join",
        pending_collectible_id: pendingClaim?.id ?? null,
      },
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
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          ...(pendingClaim ? { collectibleId: pendingClaim.id } : {}),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(
          parseApiError(data, "Could not join the waitlist. Try again."),
        );
        setStatus("error");
        return;
      }
      setEmail(normalizedEmail);
      markJoined();
      // The treasure is claimed for this explorer the moment they join —
      // the backend stores the node right away, before email verification.
      if (pendingClaim && data.claim?.ok) {
        applyClaim(pendingClaim, {
          fragmentsAwarded: data.claim.fragmentsAwarded,
          balance: data.claim.balance,
          globalTotal: data.claim.globalTotal,
        });
      }
      setStatus("sent");
    } catch {
      setError("Could not reach the Nexus. Try again.");
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div>
        <p className="micro-label">Reservation Vault</p>
        <h2 className="font-display mt-3 text-2xl tracking-[0.1em] text-silver-50">
          Check your inbox.
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-silver-300">
          Your spot is reserved, but not secured. Verify your email within
          12 hours to lock it in, or your place drifts back into the belt.
        </p>
        <p className="mt-4 font-mono text-[0.55rem] tracking-[0.22em] text-silver-500 uppercase">
          Sent to {email}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <p className="micro-label">Reservation Vault</p>
      <h2 className="font-display mt-3 text-2xl tracking-[0.1em] text-silver-50">
        Claim your place in the galaxy.
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-silver-500">
        This vault holds every reserved seat for Core. Leave your email and
        the Nexus will carve yours into the rock.
      </p>
      {pendingClaim ? (
        <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 font-mono text-[0.55rem] tracking-[0.2em] text-silver-300 uppercase">
          Claiming: {pendingClaim.name} · +
          {pendingClaim.fragments.toLocaleString("en-US")} fragments
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
        className="mt-4 w-full px-5 py-3.5 text-xs"
      >
        Join Waitlist
      </Button>
      <p aria-live="polite" className="mt-3 min-h-4 text-xs text-silver-500">
        {status === "error" ? error : ""}
      </p>
    </form>
  );
}

/* ---------------------------------------------------------------- */
/* 4 — explorer sign-in inside the Grove (waitlist profile)          */
/* ---------------------------------------------------------------- */

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
  const balance = useFragmentsStore((s) => s.balance);
  const claimedCount = useFragmentsStore((s) => s.claimedIds.length);
  const [profile, setProfile] = useState<StoredProfile | null | "loading">(
    "loading",
  );
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState("");
  const formStarted = useRef(false);

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
        <p className="micro-label">The Grove</p>
        <h2 className="font-display mt-3 text-2xl leading-snug tracking-[0.06em] text-silver-50">
          {profile.welcomeLine ??
            `Welcome back${profile.alias ? `, ${profile.alias}` : ""}.`}
        </h2>
        <div className="mt-5 space-y-2.5">
          {profile.waitlistNumber ? (
            <p className="flex items-baseline justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-silver-300">
              <span className="font-mono text-[0.55rem] tracking-[0.2em] text-silver-500 uppercase">
                Waitlist spot
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
            <span className="text-silver-50">{claimedCount}</span>
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
        <button
          type="button"
          onClick={() => {
            trackCtaClick("member_gate_open", { placement: "explorer_profile" });
            useGalaxyStore.getState().enterCave("members");
          }}
          className="mt-3 w-full text-center font-mono text-[0.55rem] tracking-[0.22em] text-silver-500 uppercase transition-colors hover:text-silver-100"
        >
          Member with vault access? Enter the Members Gate
        </button>
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
      const response = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const data = await response.json().catch(() => null);
      if (response.ok) {
        setEmail(normalizedEmail);
        setStatus("sent");
      } else {
        setError(
          parseApiError(data, "Could not send a sign-in link. Try again."),
        );
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
        <p className="micro-label">The Grove</p>
        <h2 className="font-display mt-3 text-2xl tracking-[0.1em] text-silver-50">
          Check your inbox.
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-silver-300">
          A sign-in light is on its way to {email}. Follow it to restore
          your spot and see everything you have collected.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <p className="micro-label">The Grove</p>
      <h2 className="font-display mt-3 text-2xl tracking-[0.1em] text-silver-50">
        Welcome back, explorer.
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-silver-500">
        Enter the email you joined with and the Grove will send a light to
        restore your spot, your alias, and your fragments on this device.
      </p>
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
        variant="secondary"
        loading={status === "submitting"}
        className="mt-4 w-full px-5 py-3.5 text-xs uppercase"
      >
        Sign in
      </Button>
      <p aria-live="polite" className="mt-3 min-h-4 text-xs text-silver-500">
        {status === "error" ? error : ""}
      </p>
      <button
        type="button"
        onClick={() => {
          trackCtaClick("member_gate_open", { placement: "signin_form" });
          useGalaxyStore.getState().enterCave("members");
        }}
        className="mt-2 w-full text-center font-mono text-[0.55rem] tracking-[0.22em] text-silver-500 uppercase transition-colors hover:text-silver-100"
      >
        Member with vault access? Enter the Members Gate
      </button>
    </form>
  );
}

/* ---------------------------------------------------------------- */
/* 5 — the Members Gate (magic link → TOTP → private galaxy)         */
/* ---------------------------------------------------------------- */

function MembersFlow() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (status === "submitting") return;
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
      const response = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const data = await response.json().catch(() => null);
      if (response.ok) {
        // Remember who asked, so /galaxy/private can greet them by name.
        window.localStorage.setItem("vx_member_email", normalizedEmail);
        setEmail(normalizedEmail);
        setStatus("sent");
      } else {
        setError(
          parseApiError(data, "Could not send a sign-in link. Try again."),
        );
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
        <p className="micro-label">Members Gate</p>
        <h2 className="font-display mt-3 text-2xl tracking-[0.1em] text-silver-50">
          A light is on its way.
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-silver-300">
          If this address belongs to a member, a sign-in link is heading to
          the inbox now. It burns out in 15 minutes and leads to your
          private galaxy.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <p className="micro-label">Members Gate</p>
      <h2 className="font-display mt-3 text-2xl tracking-[0.1em] text-silver-50">
        The private galaxy awaits.
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-silver-500">
        This gate opens only for approved members. Enter your email and the
        cipher light will find you.
      </p>
      <label className="mt-6 block">
        <span className="sr-only">Email address</span>
        <TextInput
          type="email"
          required
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Enter your email"
          className="w-full px-5 py-3.5 text-sm"
        />
      </label>
      <Button
        type="submit"
        variant="secondary"
        loading={status === "submitting"}
        className="mt-4 w-full px-5 py-3.5 text-xs uppercase"
      >
        Continue
      </Button>
      <p aria-live="polite" className="mt-3 min-h-4 text-xs text-silver-500">
        {status === "error" ? error : "Only available for approved members."}
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
          waitlistNumber: data.waitlistNumber,
          welcomeLine: data.welcomeLine,
        };
        window.localStorage.setItem("vx_profile", JSON.stringify(profile));
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
          The vault is matching this link against the waitlist ledger.
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
          same email and we will send a fresh one, your place is still
          held for now.
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
      <p className="micro-label">Spot secured</p>
      <h2 className="font-display mt-3 text-2xl leading-snug tracking-[0.06em] text-silver-50">
        {profile.welcomeLine ??
          `Welcome${profile.alias ? `, ${profile.alias}` : ""}. You have joined a very exclusive club.`}
      </h2>
      {profile.waitlistNumber ? (
        <p className="mt-4 text-sm leading-relaxed text-silver-300">
          You are{" "}
          <span className="text-silver-50">
            galaxy explorer #{profile.waitlistNumber.toLocaleString("en-US")}
          </span>{" "}
          on the waitlist. Your spot is secured. See you soon.
        </p>
      ) : (
        <p className="mt-4 text-sm leading-relaxed text-silver-300">
          Your spot is secured. See you soon.
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

interface TotpSetupData {
  challenge: string;
  qr: string;
  secret: string;
  otpauthUrl: string;
}

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
          message: "This sign-in link is malformed.",
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
            message: "This sign-in link is invalid or has expired.",
          });
          return;
        }
        if (data.status === "authenticated") {
          // An explorer session: same hyper jump as email verification.
          window.localStorage.setItem(
            "vx_profile",
            JSON.stringify({
              alias: data.alias ?? null,
              waitlistNumber: data.waitlist_number ?? null,
              welcomeLine: data.welcome_line ?? null,
            }),
          );
          trackLandingEvent({
            slug: "auth.magic_link_authenticated",
            metadata: { flow: "user", placement: "cipher_chamber" },
          });
          startJump("public");
          return;
        }
        if (data.status === "totp_setup_required") {
          await beginSetup(data.totp_challenge_token_hash);
        } else {
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
      <div>
        <p className="micro-label">Cipher Chamber</p>
        <h2 className="font-display mt-3 text-2xl tracking-[0.1em] text-silver-50">
          Unsealing…
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-silver-500">
          Verifying your sign-in light against the member ledger.
        </p>
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
            trackCtaClick("member_gate_open", { placement: "magic_failed" });
            useGalaxyStore.getState().enterCave("members");
          }}
          className="mt-5 min-h-0 px-6 py-3 text-[0.62rem] uppercase"
        >
          Request a new link
        </Button>
      </div>
    );
  }

  if (state.phase === "setup") {
    return <TotpSetupPanel data={state.data} onSuccess={() => startJump("private")} />;
  }

  return (
    <TotpVerifyPanel
      challenge={state.challenge}
      onSuccess={() => startJump("private")}
    />
  );
}

function TotpSetupPanel({
  data,
  onSuccess,
}: {
  data: TotpSetupData;
  onSuccess: () => void;
}) {
  const [codeA, setCodeA] = useState("");
  const [codeB, setCodeB] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (status === "submitting") return;
    setStatus("submitting");
    try {
      const response = await fetch("/api/auth/totp/setup/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge_token_hash: data.challenge,
          codes: [codeA, codeB],
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        setError(result.error ?? "Codes did not match, try the next two.");
        setStatus("error");
        return;
      }
      onSuccess();
    } catch {
      setError("The chamber did not answer, try again.");
      setStatus("error");
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <p className="micro-label">Cipher Chamber</p>
      <h2 className="font-display mt-3 text-xl tracking-[0.1em] text-silver-50">
        Forge your cipher.
      </h2>
      <p className="mt-2 text-[0.78rem] leading-relaxed text-silver-500">
        Members protect their vault with a one-time-code app (TOTP), a
        rotating six-digit cipher only your device can forge. Scan the code
        with any authenticator app, then prove it with two consecutive
        codes.
      </p>
      <div className="mt-4 flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={data.qr}
          alt="Authenticator QR code"
          width={124}
          height={124}
          className="rounded-xl border border-white/12 bg-white p-1.5"
        />
        <div className="min-w-0">
          <p className="font-mono text-[0.5rem] tracking-[0.2em] text-silver-500 uppercase">
            Manual secret
          </p>
          <p className="mt-1 font-mono text-[0.62rem] break-all text-silver-300">
            {data.secret}
          </p>
        </div>
      </div>
      <a
        href={data.otpauthUrl}
        className="vui-button vui-button-secondary mt-4 inline-flex min-h-0 w-full justify-center px-5 py-3 text-[0.62rem] uppercase"
      >
        On mobile? Tap here to open in your auth app
      </a>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label>
          <span className="font-mono text-[0.5rem] tracking-[0.2em] text-silver-500 uppercase">
            First code
          </span>
          <TextInput
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            value={codeA}
            onChange={(event) => setCodeA(event.target.value.replace(/\D/g, ""))}
            placeholder="000000"
            className="mt-1.5 w-full px-4 py-3 text-center font-mono text-sm tracking-[0.3em]"
          />
        </label>
        <label>
          <span className="font-mono text-[0.5rem] tracking-[0.2em] text-silver-500 uppercase">
            Next code
          </span>
          <TextInput
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            value={codeB}
            onChange={(event) => setCodeB(event.target.value.replace(/\D/g, ""))}
            placeholder="000000"
            className="mt-1.5 w-full px-4 py-3 text-center font-mono text-sm tracking-[0.3em]"
          />
        </label>
      </div>
      <Button
        type="submit"
        variant="primary"
        loading={status === "submitting"}
        disabled={codeA.length !== 6 || codeB.length !== 6}
        className="mt-5 w-full px-5 py-3.5 text-xs"
      >
        Complete the cipher
      </Button>
      <p aria-live="polite" className="mt-3 min-h-4 text-xs text-silver-500">
        {status === "error" ? error : ""}
      </p>
    </form>
  );
}

function TotpVerifyPanel({
  challenge,
  onSuccess,
}: {
  challenge: string;
  onSuccess: () => void;
}) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error" | "reset-sent">("idle");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (status === "submitting") return;
    setStatus("submitting");
    try {
      const response = await fetch("/api/auth/totp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge_token_hash: challenge, code }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        setStatus("error");
        return;
      }
      onSuccess();
    } catch {
      setStatus("error");
    }
  }

  async function requestReset() {
    const email = window.localStorage.getItem("vx_member_email");
    if (!email) {
      useGalaxyStore.getState().enterCave("members");
      return;
    }
    setStatus("submitting");
    try {
      await fetch("/api/auth/totp/reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setStatus("reset-sent");
    } catch {
      setStatus("error");
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <p className="micro-label">Cipher Chamber</p>
      <h2 className="font-display mt-3 text-2xl tracking-[0.1em] text-silver-50">
        Speak the cipher.
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-silver-500">
        Enter the current six-digit code from your authenticator app.
      </p>
      <label className="mt-5 block">
        <span className="sr-only">TOTP code</span>
        <TextInput
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          placeholder="000000"
          className="w-full px-4 py-3.5 text-center font-mono text-base tracking-[0.4em]"
        />
      </label>
      <Button
        type="submit"
        variant="primary"
        loading={status === "submitting"}
        disabled={code.length !== 6}
        className="mt-4 w-full px-5 py-3.5 text-xs"
      >
        Enter
      </Button>
      <button
        type="button"
        onClick={requestReset}
        className="mt-3 w-full text-center text-[0.68rem] text-silver-500 underline-offset-4 hover:text-silver-300 hover:underline"
      >
        Reset MFA
      </button>
      <p aria-live="polite" className="mt-3 min-h-4 text-xs text-silver-500">
        {status === "reset-sent"
          ? "Check your inbox for a new secure link to reset your authenticator."
          : status === "error"
            ? "Invalid code, try the next one."
            : ""}
      </p>
    </form>
  );
}
