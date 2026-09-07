"use client";

import { Button, TextInput } from "@vorinthex/shared/ui/components";
import { useEffect, useState, type FormEvent } from "react";

import styles from "@/components/admin/AdminAuth.module.css";

type Account = {
  applicationRole?: string;
  rootTeamMembership?: { role?: string; title?: string | null };
  rootTeam?: { name?: string };
  user?: { email?: string; name?: string | null };
};
type AdminState = { kind: "loading" } | { kind: "signed-out" } | { kind: "error" } | { kind: "authenticated"; account: Account };

export function mapAdminSession(status: number, payload: unknown): AdminState {
  if (status === 401 || status === 403) return { kind: "signed-out" };
  if (status === 200 && typeof payload === "object" && payload !== null && "user" in payload) {
    return { kind: "authenticated", account: payload as Account };
  }
  return { kind: "error" };
}

export function AdminClient() {
  const [state, setState] = useState<AdminState>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [requestState, setRequestState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  useEffect(() => {
    let active = true;
    void fetch("/api/admin/session", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => mapAdminSession(response.status, await response.json().catch(() => null)))
      .then((next) => { if (active) setState(next); })
      .catch(() => { if (active) setState({ kind: "error" }); });
    return () => { active = false; };
  }, []);

  async function requestGate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestState("sending");
    try {
      const response = await fetch("/api/admin/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setRequestState(response.status === 202 ? "sent" : "error");
    } catch {
      setRequestState("error");
    }
  }

  if (state.kind === "authenticated") {
    const name = state.account.user?.name?.trim() || state.account.user?.email || "Founder";
    return <main className={styles.page}><section className={styles.card}>
      <p className={styles.mark}>Founder administration / secure</p>
      <h1 className={styles.heading}>Hello, {name}.</h1>
      <p className={styles.copy}>The founder gate is open. Administrative controls will arrive here.</p>
      <div className={styles.panelRule} />
      <dl className={styles.details}>
        <dt>Team</dt><dd>{state.account.rootTeam?.name ?? "Vorinthex"}</dd>
        <dt>Role</dt><dd>{state.account.rootTeamMembership?.title || state.account.rootTeamMembership?.role || state.account.applicationRole || "Founder"}</dd>
      </dl>
    </section></main>;
  }

  const unavailable = state.kind === "error";
  return <main className={styles.page}><section aria-live="polite" className={styles.card}>
    <p className={styles.mark}>Founder administration</p>
    <h1 className={styles.heading}>{state.kind === "loading" ? "Checking access" : "Founder gate"}</h1>
    {state.kind === "loading" ? <p className={styles.copy}>Verifying this browser session...</p> : <>
      <p className={styles.copy}>Enter your founder email. If it is eligible, we’ll send a secure sign-in link. Check your inbox for the next step.</p>
      <form className={styles.form} onSubmit={requestGate}>
        <label className={styles.label} htmlFor="founder-email">Founder email</label>
        <TextInput autoComplete="email" id="founder-email" maxLength={254} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" required type="email" value={email} />
        <Button loading={requestState === "sending"} size="lg" type="submit" variant="primary">Request secure access</Button>
      </form>
      {requestState === "sent" ? <p className={styles.status}>Check your inbox. If this address can use the founder gate, a sign-in link is on its way.</p> : null}
      {requestState === "error" || unavailable ? <p className={styles.error}>Secure access is temporarily unavailable. Please try again.</p> : null}
    </>}
  </section></main>;
}
