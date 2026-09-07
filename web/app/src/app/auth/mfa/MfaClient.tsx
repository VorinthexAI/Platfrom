"use client";

import { Button, TextInput, TotpSetup } from "@vorinthex/shared/ui/components";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import styles from "@/components/admin/AdminAuth.module.css";

const TOKEN_HASH = /^[a-f0-9]{64}$/;
const CODE = /^\d{6}$/;

type Setup = { challenge: string; otpauthUrl: string; qrCodeDataUrl: string; secret: string };
export type MfaState =
  | { kind: "authenticated" | "capturing" | "fallback" | "processing" | "invalid" }
  | { kind: "setup-required"; challenge: string }
  | { kind: "verify"; challenge: string }
  | { kind: "setup"; setup: Setup; firstCode?: string };
export type MfaEvent =
  | { type: "CAPTURED" }
  | { type: "INVALID" }
  | { type: "MAGIC"; payload: Record<string, unknown> }
  | { type: "SETUP"; payload: Record<string, unknown> }
  | { type: "FIRST_CODE"; code: string };

function setupFromPayload(payload: Record<string, unknown>): Setup | undefined {
  const challenge = payload.setup_challenge_token_hash;
  const otpauthUrl = payload.otpauth_url;
  const qrCodeDataUrl = payload.qr_code_data_url;
  const secret = payload.secret;
  return typeof challenge === "string" && TOKEN_HASH.test(challenge)
    && typeof otpauthUrl === "string" && otpauthUrl.startsWith("otpauth://")
    && typeof qrCodeDataUrl === "string" && qrCodeDataUrl.startsWith("data:image/")
    && typeof secret === "string" && secret.length > 0
    ? { challenge, otpauthUrl, qrCodeDataUrl, secret }
    : undefined;
}

export function transitionMfa(state: MfaState, event: MfaEvent): MfaState {
  if (event.type === "INVALID") return { kind: "invalid" };
  if (event.type === "CAPTURED") return { kind: "processing" };
  if (event.type === "FIRST_CODE") return state.kind === "setup" && CODE.test(event.code)
    ? { ...state, firstCode: event.code }
    : state;
  if (event.type === "SETUP") {
    const setup = setupFromPayload(event.payload);
    return setup ? { kind: "setup", setup } : { kind: "invalid" };
  }
  const status = event.payload.status;
  if (status === "authenticated") return { kind: "authenticated" };
  if (status === "totp_required" || status === "totp_setup_required") {
    const challenge = event.payload.totp_challenge_token_hash;
    return typeof challenge === "string" && TOKEN_HASH.test(challenge)
      ? { kind: status === "totp_required" ? "verify" : "setup-required", challenge }
      : { kind: "invalid" };
  }
  if (status === "totp_setup") {
    const setup = setupFromPayload(event.payload);
    return setup ? { kind: "setup", setup } : { kind: "invalid" };
  }
  return { kind: "invalid" };
}

async function post(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  return { response, payload };
}

export function removeTokenFromVisibleUrl(url: URL) {
  url.searchParams.delete("token_hash");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function MfaClient() {
  const [state, setState] = useState<MfaState>({ kind: "capturing" });
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [capturedToken, setCapturedToken] = useState<string | null>(null);
  const consumed = useRef(false);

  useEffect(() => {
    if (consumed.current) return;
    consumed.current = true;
    const url = new URL(window.location.href);
    const nextToken = url.searchParams.get("token_hash");
    window.history.replaceState(window.history.state, "", removeTokenFromVisibleUrl(url));
    if (!nextToken || !TOKEN_HASH.test(nextToken)) {
      void Promise.resolve().then(() => setState({ kind: "invalid" }));
      return;
    }
    void Promise.resolve().then(() => { setCapturedToken(nextToken); setState({ kind: "fallback" }); });
  }, []);

  const continueInBrowser = () => {
    const captured = capturedToken;
    setCapturedToken(null);
    if (!captured) return;
    setState({ kind: "processing" });
    void post("/api/auth/magic/validate", { token_hash: captured }).then(async ({ response, payload }) => {
      if (!response.ok || !payload) throw new Error();
      const next = transitionMfa({ kind: "processing" }, { type: "MAGIC", payload });
      if (next.kind === "authenticated") { window.location.replace("/admin"); return; }
      if (next.kind === "setup-required") {
        const started = await post("/api/auth/totp/setup/start", { challenge_token_hash: next.challenge });
        if (!started.response.ok || !started.payload) throw new Error();
        setState(transitionMfa({ kind: "processing" }, { type: "SETUP", payload: started.payload }));
        return;
      }
      setState(next);
    }).catch(() => setState({ kind: "invalid" }));
  };

  const requestReset = () => {
    if (state.kind !== "verify" || resetSent) return;
    setResetSent(true);
    void post("/api/auth/totp/reset/request", { challenge_token_hash: state.challenge }).catch(() => undefined);
  };

  if (state.kind === "fallback") return <main className={styles.page}><section className={styles.card} aria-live="polite">
    <p className={styles.mark}>Secure team access</p><h1 className={styles.heading}>Open your recovery link</h1><p className={styles.copy}>Continue in the app to recover your authenticator, or explicitly continue in this browser.</p>
    <div className={styles.form}><Button asChild size="lg" variant="primary"><a href={`vorinthexcore://auth/mfa?token_hash=${capturedToken}`}>Open app</a></Button><Button onClick={continueInBrowser} size="lg" variant="secondary">Continue in browser</Button><Button asChild size="lg" variant="ghost"><Link href="/#download">Download app</Link></Button></div>
  </section></main>;

  function updateCode(value: string) {
    setCode(value.replace(/\D/g, "").slice(0, 6));
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!CODE.test(code) || (state.kind !== "verify" && state.kind !== "setup")) return;
    if (state.kind === "setup" && !state.firstCode) {
      setState(transitionMfa(state, { type: "FIRST_CODE", code }));
      setCode("");
      return;
    }
    setSubmitting(true);
    setError(null);
    const body = state.kind === "verify"
      ? { challenge_token_hash: state.challenge, code }
      : { challenge_token_hash: state.setup.challenge, codes: [state.firstCode, code] };
    const path = state.kind === "verify" ? "/api/auth/totp/verify" : "/api/auth/totp/setup/complete";
    try {
      const { response } = await post(path, body);
      if (!response.ok) throw new Error();
      window.location.replace("/admin");
    } catch {
      setError("That code could not be verified. Check your authenticator and try again.");
      setCode("");
    } finally {
      setSubmitting(false);
    }
  }

  if (state.kind === "capturing" || state.kind === "processing" || state.kind === "authenticated" || state.kind === "setup-required") return <main className={styles.page}><section className={styles.card} aria-live="polite">
    <p className={styles.mark}>Team authentication</p><h1 className={styles.heading}>Securing access</h1><p className={styles.copy}>Consuming your one-time sign-in link...</p>
  </section></main>;
  if (state.kind === "invalid") return <main className={styles.page}><section className={styles.card}>
    <p className={styles.mark}>Team authentication</p><h1 className={styles.heading}>Link unavailable</h1><p className={styles.copy}>This secure link is invalid, expired, or has already been used.</p>
    <Button asChild size="lg" variant="secondary"><Link href="/admin">Request a fresh link</Link></Button>
  </section></main>;

  const settingUp = state.kind === "setup";
  const firstCollected = settingUp && Boolean(state.firstCode);
  const form = resetSent ? <div className={styles.form} aria-live="polite"><p className={styles.status}>Check your email for a recovery link. It expires in 15 minutes.</p></div> : <form className={styles.form} onSubmit={submit}>
    <label className={styles.label} htmlFor="authenticator-code">{firstCollected ? "Next authenticator code" : "Six-digit authenticator code"}</label>
    <TextInput autoComplete="one-time-code" autoFocus className={styles.codeInput} id="authenticator-code" inputMode="numeric" maxLength={6} onChange={(event) => updateCode(event.target.value)} pattern="[0-9]{6}" required value={code} />
    {firstCollected ? <p className={styles.status}>First code received. Wait for your authenticator to show the next code, then enter it to finish setup.</p> : null}
    {error ? <p className={styles.error}>{error}</p> : null}
    <Button disabled={!CODE.test(code)} loading={submitting} size="lg" type="submit" variant="primary">{settingUp ? firstCollected ? "Complete secure setup" : "Accept first code" : "Verify and continue"}</Button>
    {!settingUp ? <Button onClick={requestReset} size="lg" type="button" variant="secondary">Request reset</Button> : null}
  </form>;

  return <main className={styles.page}>{settingUp ? <section className={`${styles.card} ${styles.setupCard}`}>
    <p className={styles.mark}>Team authentication / enrollment</p>
    <TotpSetup accountLabel="this team" issuerLabel="Vorinthex" otpauthUri={state.setup.otpauthUrl} qrCodeImageSrc={state.setup.qrCodeDataUrl}>
      <p className={styles.manual}>Can’t scan? Enter this setup key manually:<span className={styles.secret}>{state.setup.secret}</span></p>
      {form}
    </TotpSetup>
  </section> : <section className={styles.card}>
    <p className={styles.mark}>Team authentication</p><h1 className={styles.heading}>Confirm it’s you</h1><p className={styles.copy}>Enter the current code from your authenticator app.</p>{form}
  </section>}</main>;
}
