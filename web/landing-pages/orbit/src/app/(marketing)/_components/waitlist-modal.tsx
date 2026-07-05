"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";

import { Button, ModalTitle, TextInput } from "@vorinthex/shared/ui";

import { ModalShell } from "./modal-shell";

export function WaitlistModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done">("idle");

  function handleClose(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setTimeout(() => {
        setStatus("idle");
        setEmail("");
      }, 200);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email.includes("@")) return;
    setStatus("submitting");
    await new Promise((resolve) => setTimeout(resolve, 500));
    setStatus("done");
  }

  return (
    <ModalShell open={open} onOpenChange={handleClose} ariaLabel="Join the waitlist">
      {status === "done" ? (
        <div className="text-center">
          <p className="cui-label">You&apos;re on the list</p>
          <ModalTitle asChild>
            <h2 className="mt-3 text-2xl font-normal text-foreground">
              We&apos;ll be in touch.
            </h2>
          </ModalTitle>
          <p className="mt-3 text-sm leading-6 text-muted">
            We&apos;re onboarding a small group first. You&apos;ll get an email the
            moment your orbit is ready.
          </p>
          <Button className="mt-8 w-full" onClick={() => handleClose(false)} variant="secondary">
            Done
          </Button>
        </div>
      ) : (
        <>
          <p className="cui-label">Join the waitlist</p>
          <ModalTitle asChild>
            <h2 className="mt-3 text-2xl font-normal text-foreground">
              Be first into orbit.
            </h2>
          </ModalTitle>
          <p className="mt-3 text-sm leading-6 text-muted">
            No credit card. No spam. Just early access when we open the
            doors.
          </p>

          <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
            <TextInput
              aria-label="Email"
              autoComplete="email"
              inputMode="email"
              onChange={(event: ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)}
              placeholder="you@company.com"
              required
              value={email}
            />
            <Button
              disabled={status === "submitting"}
              loading={status === "submitting"}
              type="submit"
              variant="primary"
            >
              Join Waitlist for Free
            </Button>
          </form>
        </>
      )}
    </ModalShell>
  );
}
