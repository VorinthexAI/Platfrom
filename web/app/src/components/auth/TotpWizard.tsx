"use client";

import { useState, type FormEvent } from "react";
import { Button, TextInput } from "@vorinthex/shared/ui/components";

/**
 * TOTP setup/verify UI shared by every MFA surface in the app — the
 * Cipher Chamber cave (emailed member links) and the founders-gate flow
 * (SunGalaxy) both drive the same backend challenge endpoints and want
 * identical wizard UI, just different surrounding chrome and different
 * "what happens next" behavior on success/recovery.
 */

export interface TotpSetupData {
  challenge: string;
  qr: string;
  secret: string;
  otpauthUrl: string;
}

/**
 * "Lost access to your MFA?" resets the active organization MFA secret and
 * lets the member set up a new authenticator. Shared by both wizards below.
 */
function MfaRecoveryBlock({
  challenge,
  onReset,
}: {
  challenge: string;
  onReset: (data: TotpSetupData) => void;
}) {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );

  async function requestRecovery() {
    if (status === "sending") return;
    setStatus("sending");
    try {
      const response = await fetch("/api/auth/totp/reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge_token_hash: challenge }),
      });
      const result = await response.json();
      if (
        !response.ok ||
        !result.ok ||
        typeof result.setup_challenge_token_hash !== "string" ||
        typeof result.secret !== "string" ||
        typeof result.otpauth_url !== "string" ||
        typeof result.qr_code_data_url !== "string"
      ) {
        setStatus("error");
        return;
      }
      onReset({
        challenge: result.setup_challenge_token_hash,
        secret: result.secret,
        otpauthUrl: result.otpauth_url,
        qr: result.qr_code_data_url,
      });
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="mt-5 border-t border-white/8 pt-5 text-center">
      <p className="text-[0.68rem] text-silver-500">Lost access to your MFA?</p>
      <Button
        type="button"
        variant="secondary"
        loading={status === "sending"}
        onClick={requestRecovery}
        className="mt-4 w-full px-5 py-3 text-[0.62rem] uppercase"
      >
        Request recovery
      </Button>
      {status === "sent" || status === "error" ? (
        <p aria-live="polite" className="mt-3 text-xs text-silver-500">
          {status === "sent"
            ? "MFA was reset. Set up a new authenticator above."
            : "Could not reset MFA. Try again."}
        </p>
      ) : null}
    </div>
  );
}

export function TotpSetupPanel({
  data,
  eyebrow = "Solar Gate",
  onSuccess,
}: {
  data: TotpSetupData;
  eyebrow?: string;
  onSuccess: (name: string | null, title: string | null) => void;
}) {
  const [setupData, setSetupData] = useState(data);
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
          challenge_token_hash: setupData.challenge,
          codes: [codeA, codeB],
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        setError(result.error ?? "Codes did not match, try the next two.");
        setStatus("error");
        return;
      }
      onSuccess(
        typeof result.name === "string" ? result.name : null,
        typeof result.title === "string" ? result.title : null,
      );
    } catch {
      setError("The chamber did not answer, try again.");
      setStatus("error");
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <p className="micro-label">{eyebrow}</p>
      <h2 className="font-display mt-3 text-xl tracking-[0.1em] text-silver-50">
        Forge your cipher.
      </h2>
      <div className="mt-4 flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={setupData.qr}
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
            {setupData.secret}
          </p>
        </div>
      </div>
      <a
        href={setupData.otpauthUrl}
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
        className="mt-5 w-full px-5 py-3.5 text-xs uppercase"
      >
        Verify
      </Button>
      {status === "error" ? (
        <p aria-live="polite" className="mt-3 text-xs text-silver-500">
          {error}
        </p>
      ) : null}
      <MfaRecoveryBlock
        challenge={setupData.challenge}
        onReset={(nextData) => {
          setSetupData(nextData);
          setCodeA("");
          setCodeB("");
          setError("");
          setStatus("idle");
        }}
      />
    </form>
  );
}

export function TotpVerifyPanel({
  challenge,
  eyebrow = "Solar Gate",
  onSuccess,
  onLostAccess,
}: {
  challenge: string;
  eyebrow?: string;
  onSuccess: (name: string | null, title: string | null) => void;
  /** Recovery issues a fresh setup challenge — the caller decides where that goes next. */
  onLostAccess: (data: TotpSetupData) => void;
}) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");

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
      onSuccess(
        typeof result.name === "string" ? result.name : null,
        typeof result.title === "string" ? result.title : null,
      );
    } catch {
      setStatus("error");
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <p className="micro-label">{eyebrow}</p>
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
        className="mt-4 w-full px-5 py-3.5 text-xs uppercase"
      >
        Verify
      </Button>
      {status === "error" ? (
        <p aria-live="polite" className="mt-3 text-xs text-silver-500">
          Invalid code, try the next one.
        </p>
      ) : null}
      <MfaRecoveryBlock challenge={challenge} onReset={onLostAccess} />
    </form>
  );
}
