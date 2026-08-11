"use client";

import { useEffect, useRef, useState } from "react";

const TOKEN_HASH = /^[a-f0-9]{64}$/;

export function MagicLinkCompletion({ tokenHash }: { tokenHash: string | null }) {
  const validTokenHash = tokenHash && TOKEN_HASH.test(tokenHash) ? tokenHash : null;
  const processedToken = useRef<string | null>(null);
  const [message, setMessage] = useState(validTokenHash
    ? "Securing your session..."
    : tokenHash ? "This sign-in link is invalid or expired." : "This sign-in link is incomplete.");

  useEffect(() => {
    if (!validTokenHash || processedToken.current === validTokenHash) return;
    processedToken.current = validTokenHash;
    void fetch("/api/auth/magic/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token_hash: validTokenHash }),
    }).then(async (response) => {
      const result = await response.json().catch(() => null) as { status?: string; error?: string } | null;
      if (!response.ok || result?.status !== "authenticated") {
        throw new Error(result?.error ?? "This sign-in link is invalid or expired.");
      }
      setMessage("Sign in complete. Redirecting...");
      window.setTimeout(() => window.location.replace("/"), 500);
    }).catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : "This sign-in link is invalid or expired.");
    });
  }, [validTokenHash]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#030507] px-6 text-center text-[#dde2e5]">
      <section aria-live="polite" className="w-full max-w-md rounded-[28px] border border-white/10 bg-white/[0.03] px-8 py-12 shadow-2xl shadow-black/40">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#7b858c]">Vorinthex AI</p>
        <h1 className="mt-4 font-sans text-3xl font-light tracking-tight">Complete sign in</h1>
        <p className="mt-4 font-sans text-sm leading-6 text-[#aeb6bc]">{message}</p>
      </section>
    </main>
  );
}
