"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";

import {
  Alert,
  Button,
  Checkbox,
  ModalTitle,
  TextInput,
} from "@vorinthex/shared/ui";

import { requestSignInEmailAction } from "@/app/(auth)/auth-actions";

import { ModalShell } from "./modal-shell";

export function SignInModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [sendLink, setSendLink] = useState(true);
  const [status, setStatus] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  function handleClose(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setTimeout(() => {
        setStatus("idle");
        setEmail("");
        setError(null);
      }, 200);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setStatus("submitting");
    const result = await requestSignInEmailAction({ email });
    if (!result.ok) {
      setError(result.message);
      setStatus("idle");
      return;
    }
    setStatus("done");
  }

  return (
    <ModalShell open={open} onOpenChange={handleClose} ariaLabel="Sign in">
      {status === "done" ? (
        <div className="text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-border">
            <OrbitGlyph />
          </div>
          <ModalTitle asChild>
            <h2 className="mt-4 text-2xl font-normal text-foreground">
              Check your email.
            </h2>
          </ModalTitle>
          <p className="mt-3 text-sm leading-6 text-muted">
            Open the sign-in link we sent to {email}. It expires soon and can
            only be used once.
          </p>
          <Button className="mt-8 w-full" onClick={() => handleClose(false)} variant="secondary">
            Done
          </Button>
        </div>
      ) : (
        <>
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-border">
            <OrbitGlyph />
          </div>
          <ModalTitle asChild>
            <h2 className="mt-4 text-center text-2xl font-normal text-foreground">
              Welcome back.
            </h2>
          </ModalTitle>
          <p className="mt-2 text-center text-sm leading-6 text-muted">
            Enter your email and we&rsquo;ll send you a sign-in link.
          </p>

          {error ? (
            <Alert className="mt-4" role="alert" variant="danger">
              {error}
            </Alert>
          ) : null}

          <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
            <TextInput
              aria-label="Email"
              autoComplete="email"
              inputMode="email"
              onChange={(event: ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)}
              placeholder="you@domain.com"
              required
              value={email}
            />

            <label className="flex items-center gap-2.5 text-sm text-foreground-secondary">
              <Checkbox checked={sendLink} onCheckedChange={(v) => setSendLink(v === true)} />
              Send me a sign-in link
            </label>

            <Button
              disabled={status === "submitting"}
              loading={status === "submitting"}
              type="submit"
              variant="primary"
            >
              Send Sign In Link
            </Button>
          </form>

          <p className="mt-5 text-center text-xs text-muted">
            No password. No hassle. Secured by magic link →
          </p>
        </>
      )}
    </ModalShell>
  );
}

function OrbitGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.4" />
      <ellipse cx="12" cy="12" rx="9.5" ry="4" stroke="currentColor" strokeWidth="1.2" transform="rotate(-18 12 12)" />
    </svg>
  );
}
