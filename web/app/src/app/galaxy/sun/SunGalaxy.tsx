"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, TextInput } from "@vorinthex/shared/ui/components";
import { TotpSetupPanel, TotpVerifyPanel, type TotpSetupData } from "@/components/auth/TotpWizard";
import { CloseIcon } from "@/components/ui/icons";
import { normalizeEmailInput } from "@/lib/email";

type FoundersGatePhase =
  | { kind: "gate" }
  | { kind: "setup"; data: TotpSetupData }
  | { kind: "verify"; challenge: string }
  | { kind: "welcome"; name: string | null; title: string | null };

/** A returning, already-verified member — skip straight past the gate. */
function returningMemberWelcome(): { name: string | null; title: string | null } | null {
  const storedName = window.localStorage.getItem("vx_member_name")?.trim() || null;
  const storedTitle = window.localStorage.getItem("vx_member_title")?.trim() || null;
  if (!storedName && !storedTitle) return null;
  if (storedName) return { name: storedName.split(/\s+/)[0] ?? null, title: storedTitle };
  const email = window.localStorage.getItem("vx_member_email");
  const handle = email?.split("@")[0]?.split(".")[0] ?? "";
  return { name: handle ? handle.charAt(0).toUpperCase() + handle.slice(1) : null, title: storedTitle };
}

/**
 * Inside the star — the Nexus. One continuous chamber for the whole
 * founders-gate journey: email gate, MFA setup or verification, then the
 * CEO's welcome, all in place with no further navigation or hyperjump —
 * the long-press into the sun is the only jump this visit gets.
 */
export function SunGalaxy() {
  const router = useRouter();
  const [phase, setPhase] = useState<FoundersGatePhase>({ kind: "gate" });
  const [email, setEmail] = useState("");
  const [gateStatus, setGateStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [gateError, setGateError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const welcome = returningMemberWelcome();
      if (welcome) setPhase({ kind: "welcome", ...welcome });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function onTotpSuccess(name: string | null, title: string | null) {
    // The sun greets the member by their real name and platform title.
    if (name) window.localStorage.setItem("vx_member_name", name);
    if (title) window.localStorage.setItem("vx_member_title", title);
    setPhase({ kind: "welcome", name, title });
  }

  async function submitFoundersGate(event: FormEvent) {
    event.preventDefault();
    if (gateStatus === "submitting") return;
    let normalizedEmail: string;
    try {
      normalizedEmail = normalizeEmailInput(email);
    } catch {
      setGateError("Use a valid email address.");
      setGateStatus("error");
      return;
    }
    setGateStatus("submitting");
    setGateError("");
    try {
      // Look the email up against the root organization: only a founder
      // identity gets a challenge back, and setup vs. verify depends on
      // whether they already have an authenticator registered.
      const response = await fetch("/api/auth/founders-gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const data = await response.json();
      if (
        !response.ok ||
        !data.ok ||
        typeof data.totp_challenge_token_hash !== "string" ||
        (data.status !== "totp_setup_required" && data.status !== "totp_required")
      ) {
        setGateError(data.error ?? "Founder identity not found.");
        setGateStatus("error");
        return;
      }
      window.localStorage.setItem("vx_member_email", normalizedEmail);
      if (typeof data.name === "string") window.localStorage.setItem("vx_member_name", data.name);
      if (typeof data.title === "string") window.localStorage.setItem("vx_member_title", data.title);

      if (data.status === "totp_required") {
        setPhase({ kind: "verify", challenge: data.totp_challenge_token_hash });
        return;
      }

      const setupResponse = await fetch("/api/auth/totp/setup/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge_token_hash: data.totp_challenge_token_hash }),
      });
      const setupData = await setupResponse.json();
      if (!setupResponse.ok || !setupData.ok) {
        setGateError("Could not start authenticator setup. Try again.");
        setGateStatus("error");
        return;
      }
      setPhase({
        kind: "setup",
        data: {
          challenge: setupData.setup_challenge_token_hash,
          qr: setupData.qr_code_data_url,
          secret: setupData.secret,
          otpauthUrl: setupData.otpauth_url,
        },
      });
    } catch {
      setGateError("The Founders Gate did not answer. Try again.");
      setGateStatus("error");
    }
  }

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden px-4 py-14 sm:py-16">
      {/* Wide solar chamber, framed like a biome interior instead of a close crop. */}
      <div aria-hidden className="sun-chamber absolute inset-0">
        <div className="sun-convection sun-convection-slow" />
        <div className="sun-convection sun-convection-fast" />
        <div className="sun-dome" />
        <div className="sun-floor" />
        <div className="sun-horizon" />
        <div className="sun-core" />
        <div className="sun-pulse" />
        <div className="sun-flare sun-flare-a" />
        <div className="sun-flare sun-flare-b" />
        <div className="sun-flare sun-flare-c" />
        <div className="sun-wall sun-wall-left" />
        <div className="sun-wall sun-wall-right" />
        <div className="sun-ejecta">
          {Array.from({ length: 14 }, (_, index) => (
            <span key={index} className={`sun-stone sun-stone-${index + 1}`} />
          ))}
        </div>
        <div className="sun-grain" />
        <div className="sun-vignette" />
      </div>

      <section
        className="chrome-border card-depth relative z-10 w-full max-w-lg rounded-3xl p-7 text-center sm:p-10"
        style={{ background: "var(--gradient-panel)" }}
      >
        <button
          type="button"
          onClick={() => router.push("/")}
          aria-label="Close"
          className="absolute top-4 right-4 rounded-full border border-white/10 p-2 text-silver-500 transition-colors hover:border-white/25 hover:text-silver-100"
        >
          <CloseIcon width={12} height={12} />
        </button>

        {phase.kind === "gate" ? (
          <form onSubmit={submitFoundersGate}>
            <p className="micro-label">Founders Gate</p>
            <h1 className="font-display mt-4 text-3xl leading-snug tracking-[0.1em] text-silver-50">
              Enter the Nexus.
            </h1>
            <p className="mt-5 text-sm leading-relaxed text-silver-300">
              Founder access uses your organization MFA. Enter your email to
              open setup or verification.
            </p>
            <label className="mt-6 block">
              <span className="sr-only">Founder email</span>
              <TextInput
                type="email"
                required
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Founder email"
                className="w-full px-5 py-3.5 text-sm"
              />
            </label>
            <Button
              type="submit"
              variant="primary"
              loading={gateStatus === "submitting"}
              className="mt-4 w-full px-5 py-3.5 text-xs uppercase"
            >
              Continue
            </Button>
            <p aria-live="polite" className="mt-3 min-h-4 text-xs text-silver-500">
              {gateStatus === "error" ? gateError : ""}
            </p>
          </form>
        ) : null}

        {phase.kind === "setup" ? (
          <TotpSetupPanel
            eyebrow="Founders Gate"
            data={phase.data}
            onSuccess={onTotpSuccess}
          />
        ) : null}

        {phase.kind === "verify" ? (
          <TotpVerifyPanel
            eyebrow="Founders Gate"
            challenge={phase.challenge}
            onSuccess={onTotpSuccess}
            onLostAccess={(data) => setPhase({ kind: "setup", data })}
          />
        ) : null}

        {phase.kind === "welcome" ? (
          <>
            <p className="micro-label">The Inner Galaxy</p>
            <h1 className="font-display mt-4 text-3xl leading-snug tracking-[0.1em] text-silver-50">
              {phase.name ? `Welcome ${phase.name},` : "Welcome,"}
            </h1>
            {phase.title ? (
              <p className="mt-6 font-mono text-[0.62rem] tracking-[0.26em] text-silver-300 uppercase">
                {phase.title} of Vorinthex AI | The Nexus of Intelligence
              </p>
            ) : null}
            <p className="mt-6 text-sm leading-relaxed text-silver-300">
              Welcome to the inner galaxy of Vorinthex AI. Looking forward to
              working together to form this product as the next generation
              AI-native platform - enabling anyone to use AI in their
              day-to-day life.
            </p>
            <p className="mt-6 font-mono text-[0.6rem] tracking-[0.24em] text-silver-500 uppercase">
              - Your CEO, Oscar
            </p>
          </>
        ) : null}
      </section>

      <style jsx>{`
        .sun-chamber {
          perspective: 980px;
          transform-style: preserve-3d;
          background:
            radial-gradient(
              120% 88% at 50% 118%,
              #7a2d05 0%,
              #4a1503 30%,
              #1c0701 66%,
              #0a0301 100%
            ),
            linear-gradient(
              180deg,
              #100301 0%,
              #351007 42%,
              #110401 100%
            );
        }
        .sun-dome,
        .sun-floor,
        .sun-horizon,
        .sun-wall,
        .sun-convection,
        .sun-pulse,
        .sun-ejecta {
          position: absolute;
          left: 50%;
          pointer-events: none;
          transform-style: preserve-3d;
        }
        .sun-convection {
          inset: -18%;
          left: -18%;
          width: 136%;
          opacity: 0.5;
          mix-blend-mode: screen;
          background:
            radial-gradient(
              circle at 16% 24%,
              rgba(255, 203, 118, 0.38) 0 2.5%,
              transparent 7%
            ),
            radial-gradient(
              circle at 42% 16%,
              rgba(255, 144, 50, 0.28) 0 3.4%,
              transparent 8%
            ),
            radial-gradient(
              circle at 70% 28%,
              rgba(255, 213, 142, 0.3) 0 3%,
              transparent 8.5%
            ),
            radial-gradient(
              circle at 86% 56%,
              rgba(223, 83, 18, 0.25) 0 4%,
              transparent 9%
            ),
            radial-gradient(
              circle at 25% 68%,
              rgba(255, 172, 72, 0.27) 0 4.6%,
              transparent 10%
            ),
            radial-gradient(
              circle at 55% 82%,
              rgba(255, 221, 151, 0.25) 0 3.2%,
              transparent 8.5%
            ),
            repeating-radial-gradient(
              ellipse at 50% 52%,
              rgba(255, 194, 101, 0.16) 0 2px,
              rgba(107, 25, 5, 0.04) 2px 22px,
              transparent 22px 44px
            );
          filter: blur(10px) saturate(1.18);
          animation: sun-convection-drift 21s linear infinite,
            sun-heartbeat 3.8s ease-in-out infinite;
        }
        .sun-convection-fast {
          inset: -26%;
          left: -26%;
          width: 152%;
          opacity: 0.3;
          background-size:
            64% 64%,
            54% 54%,
            70% 70%,
            58% 58%,
            62% 62%,
            74% 74%,
            auto;
          filter: blur(18px) saturate(1.4);
          animation: sun-convection-drift 12s linear infinite reverse,
            sun-heartbeat 3.8s ease-in-out infinite;
        }
        .sun-dome {
          top: 4%;
          width: min(1260px, 138vw);
          height: min(560px, 54vh);
          border-radius: 50%;
          background:
            radial-gradient(
              72% 100% at 50% 100%,
              rgba(255, 205, 118, 0.24) 0%,
              rgba(213, 78, 14, 0.17) 48%,
              transparent 74%
            ),
            repeating-radial-gradient(
              ellipse at 50% 100%,
              rgba(255, 220, 154, 0.2) 0 1px,
              transparent 1px 34px
            );
          opacity: 0.78;
          transform: translateX(-50%) rotateX(56deg) translateZ(-135px);
        }
        .sun-floor {
          bottom: -18%;
          width: min(1320px, 150vw);
          height: min(720px, 64vh);
          border-radius: 50%;
          background:
            radial-gradient(
              62% 62% at 50% 42%,
              rgba(255, 204, 122, 0.34) 0%,
              rgba(232, 92, 22, 0.21) 38%,
              rgba(88, 25, 5, 0.22) 68%,
              transparent 82%
            ),
            repeating-radial-gradient(
              ellipse at 50% 44%,
              rgba(255, 230, 176, 0.22) 0 1px,
              transparent 1px 38px
            );
          filter: blur(0.2px);
          transform: translateX(-50%) rotateX(68deg) translateZ(-85px);
        }
        .sun-horizon {
          top: 45%;
          width: min(1180px, 136vw);
          height: min(260px, 28vh);
          border-radius: 50%;
          background: radial-gradient(
            64% 56% at 50% 50%,
            rgba(255, 213, 139, 0.34) 0%,
            rgba(243, 117, 38, 0.18) 42%,
            transparent 72%
          );
          filter: blur(18px);
          opacity: 0.82;
          transform: translateX(-50%) translateZ(-170px);
        }
        .sun-core {
          position: absolute;
          left: 50%;
          top: 50%;
          width: min(980px, 118vw);
          height: min(760px, 86vh);
          background: radial-gradient(
            56% 48% at 50% 52%,
            rgba(255, 219, 150, 0.38) 0%,
            rgba(255, 155, 64, 0.26) 30%,
            rgba(214, 92, 22, 0.13) 56%,
            transparent 78%
          );
          transform: translate3d(-50%, -50%, -260px);
          animation: sun-breathe 3.8s ease-in-out infinite;
        }
        .sun-pulse {
          top: 50%;
          width: min(1120px, 124vw);
          height: min(820px, 88vh);
          border-radius: 50%;
          background:
            radial-gradient(
              44% 38% at 50% 50%,
              rgba(255, 232, 175, 0.32) 0%,
              rgba(255, 156, 57, 0.2) 32%,
              transparent 68%
            ),
            radial-gradient(
              70% 58% at 50% 54%,
              transparent 45%,
              rgba(255, 184, 82, 0.16) 58%,
              transparent 76%
            );
          filter: blur(6px);
          opacity: 0.8;
          transform: translate3d(-50%, -50%, -220px);
          animation: sun-pulse-ring 3.8s ease-in-out infinite;
        }
        .sun-flare {
          position: absolute;
          inset: -48%;
          mix-blend-mode: screen;
          filter: blur(54px);
          opacity: 0.42;
        }
        .sun-flare-a {
          background: radial-gradient(
            34% 28% at 22% 26%,
            rgba(255, 158, 66, 0.38) 0%,
            transparent 70%
          );
          animation: sun-drift-a 17s ease-in-out infinite;
        }
        .sun-flare-b {
          background: radial-gradient(
            34% 28% at 80% 31%,
            rgba(255, 122, 32, 0.32) 0%,
            transparent 70%
          );
          animation: sun-drift-b 23s ease-in-out infinite;
        }
        .sun-flare-c {
          background: radial-gradient(
            44% 32% at 52% 88%,
            rgba(255, 189, 96, 0.34) 0%,
            transparent 72%
          );
          animation: sun-drift-c 14s ease-in-out infinite;
        }
        .sun-wall {
          top: 11%;
          width: min(430px, 38vw);
          height: 82%;
          background:
            radial-gradient(
              76% 70% at 50% 50%,
              rgba(255, 183, 82, 0.2) 0%,
              rgba(152, 44, 8, 0.14) 52%,
              transparent 78%
            ),
            repeating-linear-gradient(
              96deg,
              rgba(255, 214, 142, 0.14) 0 1px,
              transparent 1px 32px
            );
          filter: blur(1px);
          opacity: 0.58;
        }
        .sun-wall-left {
          transform: translateX(calc(-50% - min(480px, 43vw))) rotateY(-62deg)
            translateZ(-120px);
        }
        .sun-wall-right {
          transform: translateX(calc(-50% + min(480px, 43vw))) rotateY(62deg)
            translateZ(-120px);
        }
        .sun-ejecta {
          inset: 0;
          left: 0;
          overflow: hidden;
          transform: none;
        }
        .sun-stone {
          position: absolute;
          left: 50%;
          top: 57%;
          width: var(--stone-size);
          height: var(--stone-size);
          border-radius: 38% 52% 44% 58%;
          background:
            radial-gradient(
              circle at 34% 28%,
              rgba(255, 230, 172, 0.95) 0 8%,
              rgba(255, 158, 62, 0.88) 24%,
              rgba(115, 31, 7, 0.92) 58%,
              rgba(24, 7, 2, 0.96) 100%
            );
          box-shadow:
            0 0 calc(var(--stone-size) * 1.8) rgba(255, 171, 77, 0.8),
            0 0 calc(var(--stone-size) * 4) rgba(233, 91, 19, 0.34);
          opacity: 0;
          filter: saturate(1.2);
          transform: translate(-50%, -50%) rotate(0deg) scale(0.35);
          animation: sun-stone-flight var(--stone-duration) ease-out infinite;
          animation-delay: var(--stone-delay);
        }
        .sun-stone::after {
          content: "";
          position: absolute;
          right: 72%;
          top: 44%;
          width: calc(var(--stone-size) * 5.2);
          height: calc(var(--stone-size) * 0.55);
          border-radius: 999px;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 120, 35, 0.18),
            rgba(255, 210, 132, 0.54)
          );
          filter: blur(3px);
          transform: rotate(calc(var(--stone-angle) * -1));
          transform-origin: 100% 50%;
        }
        .sun-stone-1 {
          --stone-size: 18px;
          --stone-x: -42vw;
          --stone-y: -34vh;
          --stone-angle: -34deg;
          --stone-duration: 4.4s;
          --stone-delay: -0.2s;
        }
        .sun-stone-2 {
          --stone-size: 9px;
          --stone-x: 28vw;
          --stone-y: -42vh;
          --stone-angle: 38deg;
          --stone-duration: 3.2s;
          --stone-delay: -1.1s;
        }
        .sun-stone-3 {
          --stone-size: 13px;
          --stone-x: 44vw;
          --stone-y: -16vh;
          --stone-angle: 16deg;
          --stone-duration: 5.1s;
          --stone-delay: -2.6s;
        }
        .sun-stone-4 {
          --stone-size: 7px;
          --stone-x: -32vw;
          --stone-y: -12vh;
          --stone-angle: -18deg;
          --stone-duration: 3.5s;
          --stone-delay: -1.8s;
        }
        .sun-stone-5 {
          --stone-size: 22px;
          --stone-x: 18vw;
          --stone-y: 28vh;
          --stone-angle: 58deg;
          --stone-duration: 5.6s;
          --stone-delay: -3.2s;
        }
        .sun-stone-6 {
          --stone-size: 11px;
          --stone-x: -48vw;
          --stone-y: 18vh;
          --stone-angle: -58deg;
          --stone-duration: 4.8s;
          --stone-delay: -2.1s;
        }
        .sun-stone-7 {
          --stone-size: 15px;
          --stone-x: 6vw;
          --stone-y: -48vh;
          --stone-angle: 4deg;
          --stone-duration: 4.2s;
          --stone-delay: -3.8s;
        }
        .sun-stone-8 {
          --stone-size: 8px;
          --stone-x: 52vw;
          --stone-y: 18vh;
          --stone-angle: 68deg;
          --stone-duration: 3.7s;
          --stone-delay: -0.8s;
        }
        .sun-stone-9 {
          --stone-size: 12px;
          --stone-x: -12vw;
          --stone-y: 36vh;
          --stone-angle: -88deg;
          --stone-duration: 4.9s;
          --stone-delay: -4.1s;
        }
        .sun-stone-10 {
          --stone-size: 6px;
          --stone-x: -54vw;
          --stone-y: -6vh;
          --stone-angle: -72deg;
          --stone-duration: 3.1s;
          --stone-delay: -2.9s;
        }
        .sun-stone-11 {
          --stone-size: 16px;
          --stone-x: 38vw;
          --stone-y: 34vh;
          --stone-angle: 82deg;
          --stone-duration: 5.3s;
          --stone-delay: -1.5s;
        }
        .sun-stone-12 {
          --stone-size: 10px;
          --stone-x: -22vw;
          --stone-y: -44vh;
          --stone-angle: -12deg;
          --stone-duration: 3.9s;
          --stone-delay: -3.4s;
        }
        .sun-stone-13 {
          --stone-size: 20px;
          --stone-x: 0vw;
          --stone-y: 44vh;
          --stone-angle: 94deg;
          --stone-duration: 5.8s;
          --stone-delay: -4.7s;
        }
        .sun-stone-14 {
          --stone-size: 7px;
          --stone-x: 48vw;
          --stone-y: -32vh;
          --stone-angle: 48deg;
          --stone-duration: 3.4s;
          --stone-delay: -2.3s;
        }
        .sun-grain {
          position: absolute;
          inset: 0;
          opacity: 0.2;
          mix-blend-mode: screen;
          background-image:
            radial-gradient(
              rgba(255, 228, 177, 0.64) 0.8px,
              transparent 0.8px
            ),
            radial-gradient(rgba(255, 147, 64, 0.5) 0.6px, transparent 0.6px),
            linear-gradient(
              118deg,
              transparent 0 42%,
              rgba(255, 176, 82, 0.08) 43% 44%,
              transparent 45% 100%
            );
          background-size:
            46px 46px,
            29px 29px,
            180px 180px;
          background-position:
            0 0,
            13px 19px,
            0 0;
          animation: sun-grain-drift 14s linear infinite;
        }
        .sun-vignette {
          position: absolute;
          inset: 0;
          background: radial-gradient(
            92% 82% at 50% 52%,
            transparent 48%,
            rgba(8, 3, 1, 0.5) 84%,
            rgba(4, 1, 0, 0.85) 100%
          );
        }
        @keyframes sun-breathe {
          0%,
          100% {
            transform: translate3d(-50%, -50%, -260px) scale(0.98);
            opacity: 0.74;
          }
          36% {
            transform: translate3d(-50%, -50%, -260px) scale(1.08);
            opacity: 1;
          }
          47% {
            transform: translate3d(-50%, -50%, -260px) scale(1.02);
            opacity: 0.86;
          }
          58% {
            transform: translate3d(-50%, -50%, -260px) scale(1.05);
            opacity: 0.96;
          }
        }
        @keyframes sun-heartbeat {
          0%,
          100% {
            opacity: 0.38;
            filter: blur(14px) saturate(1.05);
          }
          36% {
            opacity: 0.72;
            filter: blur(8px) saturate(1.55);
          }
          58% {
            opacity: 0.58;
            filter: blur(10px) saturate(1.35);
          }
        }
        @keyframes sun-pulse-ring {
          0%,
          100% {
            transform: translate3d(-50%, -50%, -220px) scale(0.78);
            opacity: 0.18;
          }
          38% {
            transform: translate3d(-50%, -50%, -220px) scale(1.04);
            opacity: 0.74;
          }
          62% {
            transform: translate3d(-50%, -50%, -220px) scale(1.26);
            opacity: 0.22;
          }
        }
        @keyframes sun-convection-drift {
          0% {
            transform: translate3d(0, 0, -190px) rotate(0deg) scale(1);
          }
          50% {
            transform: translate3d(2%, -1%, -190px) rotate(7deg) scale(1.06);
          }
          100% {
            transform: translate3d(0, 0, -190px) rotate(0deg) scale(1);
          }
        }
        @keyframes sun-stone-flight {
          0% {
            opacity: 0;
            transform: translate(-50%, -50%) rotate(0deg) scale(0.18);
          }
          9% {
            opacity: 0.98;
          }
          74% {
            opacity: 0.74;
          }
          100% {
            opacity: 0;
            transform: translate(
                calc(-50% + var(--stone-x)),
                calc(-50% + var(--stone-y))
              )
              rotate(680deg) scale(1);
          }
        }
        @keyframes sun-grain-drift {
          0% {
            background-position:
              0 0,
              13px 19px,
              0 0;
          }
          100% {
            background-position:
              46px 46px,
              -16px 48px,
              180px 180px;
          }
        }
        @keyframes sun-drift-a {
          0%,
          100% {
            transform: translate3d(0, 0, 0) scale(1);
          }
          50% {
            transform: translate3d(6%, 4%, 0) scale(1.12);
          }
        }
        @keyframes sun-drift-b {
          0%,
          100% {
            transform: translate3d(0, 0, 0) scale(1.05);
          }
          50% {
            transform: translate3d(-5%, 6%, 0) scale(0.94);
          }
        }
        @keyframes sun-drift-c {
          0%,
          100% {
            transform: translate3d(0, 0, 0) scale(1);
          }
          50% {
            transform: translate3d(3%, -5%, 0) scale(1.1);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .sun-core,
          .sun-flare,
          .sun-convection,
          .sun-pulse,
          .sun-stone,
          .sun-grain {
            animation: none;
          }
          .sun-stone {
            opacity: 0;
          }
        }
      `}</style>
    </main>
  );
}
