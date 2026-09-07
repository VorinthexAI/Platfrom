"use client";

import { Button } from "@vorinthex/shared/ui/components";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { DownloadAppCta } from "@/components/core/DownloadAppCta";
import styles from "@/components/private/PrivateFallback.module.css";

const TOKEN_HASH = /^[a-f0-9]{64}$/;
type LinkState = "invalid" | "processing" | "success" | "expired";

export function MagicLinkCompletion({ tokenHash }: { tokenHash: string | null }) {
  const validTokenHash = tokenHash && TOKEN_HASH.test(tokenHash) ? tokenHash : null;
  const processedToken = useRef<string | null>(null);
  const [state, setState] = useState<LinkState>(validTokenHash ? "processing" : "invalid");
  const [message, setMessage] = useState(validTokenHash
    ? "Securing your session..."
    : tokenHash ? "This sign-in link is invalid or expired." : "This sign-in link is incomplete.");

  useEffect(() => {
    if (!validTokenHash || processedToken.current === validTokenHash) return;
    processedToken.current = validTokenHash;
    const visibleUrl = new URL(window.location.href);
    visibleUrl.searchParams.delete("token_hash");
    window.history.replaceState(window.history.state, "", `${visibleUrl.pathname}${visibleUrl.search}${visibleUrl.hash}`);
    void fetch("/api/auth/magic/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token_hash: validTokenHash }),
    }).then(async (response) => {
      const result = await response.json().catch(() => null) as { status?: string; error?: string } | null;
      if (!response.ok || result?.status !== "authenticated") throw new Error(result?.error ?? "This sign-in link is invalid or expired.");
      setState("success");
      setMessage("Your browser session is ready. For the full experience, continue in the Vorinthex app.");
    }).catch(() => {
      setState("expired");
      setMessage("This sign-in link is invalid, expired, or has already been used. Request a fresh link in the app.");
    });
  }, [validTokenHash]);

  const failed = state === "invalid" || state === "expired";
  return <main className={styles.page}>
    <section aria-live="polite" className={styles.card}>
      <p className={styles.eyebrow}>Vorinthex AI</p>
      <h1>{state === "processing" ? "Completing sign in" : state === "success" ? "You’re signed in" : "Link expired"}</h1>
      <p className={styles.copy}>{message}</p>
      <div className={styles.actions}>
        {state === "success" ? <Button asChild size="lg" variant="secondary"><Link href="/">Continue on web</Link></Button> : null}
        {failed ? <Button asChild size="lg" variant="secondary"><Link href="/">Return home</Link></Button> : null}
        {state !== "processing" ? <DownloadAppCta /> : null}
      </div>
      {failed ? <p className={styles.note}>Open Vorinthex and request a new secure sign-in link.</p> : null}
    </section>
  </main>;
}
