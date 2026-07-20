"use client";

import { useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Button, TextInput } from "@vorinthex/shared/ui/components";
import { TotpSetupPanel, TotpVerifyPanel, type TotpSetupData } from "@/components/auth/TotpWizard";
import { CloseIcon } from "@/components/ui/icons";
import { normalizeEmailInput } from "@/lib/email";

const SunSurface = dynamic(() => import("./SunSurface"), { ssr: false });

type FoundersGatePhase =
  | { kind: "gate" }
  | { kind: "setup"; data: TotpSetupData }
  | { kind: "verify"; challenge: string };

/**
 * The Nexus — inside the star. One continuous chamber for the whole
 * founders-gate journey: email gate followed by MFA setup or verification,
 * all in one centered card floating over the sun's own burning surface.
 * Authenticated founders continue directly to the founders interface.
 */
export function NexusGate() {
  const router = useRouter();
  const [phase, setPhase] = useState<FoundersGatePhase>({ kind: "gate" });
  const [email, setEmail] = useState("");
  const [gateStatus, setGateStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [gateError, setGateError] = useState("");

  function onTotpSuccess(name: string | null, title: string | null) {
    if (name) window.localStorage.setItem("vx_member_name", name);
    if (title) window.localStorage.setItem("vx_member_title", title);
    window.location.replace("/nexus");
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
    <main className="relative min-h-svh overflow-hidden bg-[#1c0701]">
      {/* Painted fallback in the sun's own palette: shows while the WebGL
          surface loads, and stays if WebGL is unavailable. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 46%, #7a2d05 0%, #4a1503 44%, #1c0701 78%, #0a0301 100%)",
        }}
      />
      <SunSurface />
      {/* Soft darkening toward the edges so the card reads against the
          brightest convection cells. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(92% 82% at 50% 50%, transparent 46%, rgba(10, 3, 1, 0.42) 82%, rgba(5, 1, 0, 0.66) 100%)",
        }}
      />

      <div className="relative z-10 flex min-h-svh items-center justify-center px-4 py-8">
        <section
          className="chrome-border card-depth relative max-h-[calc(100svh-3rem)] w-full max-w-md overflow-y-auto rounded-3xl p-7 sm:p-9"
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
              <h1 className="font-display mt-3 text-2xl tracking-[0.1em] text-silver-50">
                Enter the Nexus.
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-silver-500">
                Enter your email to continue.
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
        </section>
      </div>
    </main>
  );
}
