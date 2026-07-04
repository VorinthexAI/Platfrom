"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type FormEvent } from "react";

import { Alert, Button, Card, TextInput } from "@vorinthex/shared/ui";
import { completeTotpSetupAction } from "@/app/(auth)/auth-actions";
import { TotpSetup } from "@vorinthex/shared/ui";

export function SetupTotpForm({
  otpauthUrl,
  qrCodeDataUrl,
  secret,
  setupChallengeTokenHash,
}: {
  otpauthUrl: string;
  qrCodeDataUrl: string;
  secret: string;
  setupChallengeTokenHash: string;
}) {
  const router = useRouter();
  const [firstCode, setFirstCode] = useState("");
  const [secondCode, setSecondCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const result = await completeTotpSetupAction({
      setupChallengeTokenHash,
      codes: [firstCode, secondCode],
    });

    if (!result.ok) {
      setError(result.message);
      setFirstCode("");
      setSecondCode("");
      setIsSubmitting(false);
      return;
    }

    router.push("/console/home");
  };

  const canSubmit =
    firstCode.length === 6 && secondCode.length === 6 && !isSubmitting;

  return (
    <Card className="max-w-lg">
      <TotpSetup
        issuerLabel="Vorinthex AI"
        otpauthUri={otpauthUrl}
        qrCodeImageSrc={qrCodeDataUrl}
      >
        <a
          className="break-all text-xs leading-5 text-muted underline underline-offset-4"
          href={otpauthUrl}
        >
          {otpauthUrl}
        </a>
        <div className="rounded-[16px] border border-border bg-background px-3 py-2 text-xs leading-5 text-muted">
          Manual setup secret: <span className="text-foreground">{secret}</span>
        </div>

        {error ? (
          <Alert
            className="border border-[var(--vui-color-danger)] bg-[var(--vui-color-danger)]/10 px-4 py-3 text-sm text-[var(--vui-color-danger)]"
            role="alert"
          >
            {error}
          </Alert>
        ) : null}

        <form className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
          <div className="flex flex-col gap-1.5">
            <label className="vui-label" htmlFor="totp-first-code">
              First 6-digit code
            </label>
            <TextInput
              autoComplete="one-time-code"
              className="text-center text-2xl tracking-[0.4em]"
              id="totp-first-code"
              inputMode="numeric"
              maxLength={6}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setFirstCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              pattern="[0-9]*"
              placeholder="000000"
              value={firstCode}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="vui-label" htmlFor="totp-second-code">
              Next 6-digit code
            </label>
            <TextInput
              autoComplete="one-time-code"
              className="text-center text-2xl tracking-[0.4em]"
              id="totp-second-code"
              inputMode="numeric"
              maxLength={6}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setSecondCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              pattern="[0-9]*"
              placeholder="000000"
              value={secondCode}
            />
          </div>

          <Button disabled={!canSubmit} type="submit" variant="primary">
            {isSubmitting ? "Verifying..." : "Verify setup"}
          </Button>
          <Link className="vui-button vui-button-secondary" href="/auth/totp/reset">
            Request reset link
          </Link>
        </form>
      </TotpSetup>
    </Card>
  );
}
