"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent } from "react";

import { Alert, Button, Card, TextInput } from "@vorinthex/shared/ui";
import { verifyTotpAction } from "@/app/(auth)/auth-actions";

export function VerifyTotpForm({
  challengeTokenHash,
}: {
  challengeTokenHash: string;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submitCode = async (candidate: string) => {
    if (candidate.length !== 6 || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const result = await verifyTotpAction({ challengeTokenHash, code: candidate });
    if (result.ok) {
      router.push("/console/home");
      return;
    }

    setError(
      result.expired
        ? "This verification session expired. Request a new sign-in email."
        : result.message,
    );
    setCode("");
    setIsSubmitting(false);
  };

  return (
    <Card>
      <p className="vui-label">Two-factor verification</p>
      <h1 className="mt-2 text-3xl font-normal">Enter your code.</h1>
      <p className="mt-2 text-sm leading-6 text-muted">
        Type the 6-digit code from your authenticator app. We will verify it as
        soon as the code is complete.
      </p>

      {error ? (
        <Alert
          className="mt-6 border border-[var(--vui-color-danger)] bg-[var(--vui-color-danger)]/10 px-4 py-3 text-sm text-[var(--vui-color-danger)]"
          role="alert"
        >
          {error}
        </Alert>
      ) : null}

      <div className="mt-6 flex flex-col gap-4">
        <label className="vui-label" htmlFor="totp-code">
          6-digit code
        </label>
        <TextInput
          autoComplete="one-time-code"
          autoFocus
          className="text-center text-2xl tracking-[0.4em]"
          id="totp-code"
          inputMode="numeric"
          maxLength={6}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const nextCode = event.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(nextCode);
            if (nextCode.length === 6) {
              void submitCode(nextCode);
            }
          }}
          pattern="[0-9]*"
          placeholder="000000"
          value={code}
        />
        <Button
          disabled={code.length !== 6 || isSubmitting}
          onClick={() => void submitCode(code)}
          variant="primary"
        >
          {isSubmitting ? "Verifying..." : "Verify"}
        </Button>
        <Link className="vui-button vui-button-secondary" href="/auth/totp/reset">
          Request reset link
        </Link>
      </div>
    </Card>
  );
}
