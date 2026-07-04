"use client";

import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type FormEvent } from "react";

import { Alert, Button, TextInput } from "@/shared/packages/ui";
import { TotpSetup } from "@/shared/packages/ui/components/totp-setup/totp-setup.web";

import { confirmMfaEnrollmentAction } from "./actions";
import type { EnrollmentPayload } from "../enrollment-cookie";

export function MfaSetupForm({ enrollment }: { enrollment: EnrollmentPayload }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const result = await confirmMfaEnrollmentAction(code);

    if (!result.ok) {
      setError(result.message);
      setIsSubmitting(false);
      return;
    }

    router.push("/console/home");
  };

  return (
    <TotpSetup
      accountLabel={enrollment.accountLabel}
      issuerLabel={enrollment.issuerLabel}
      otpauthUri={enrollment.otpauthUri}
      qrCodeImageSrc={enrollment.qrCodeImageSrc}
    >
      {error ? (
        <Alert
          className="mb-4 border border-[var(--vui-color-danger)] bg-[var(--vui-color-danger)]/10 px-4 py-3 text-sm text-[var(--vui-color-danger)]"
          role="alert"
        >
          {error}
        </Alert>
      ) : null}

      <form className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
        <div className="flex flex-col gap-1.5">
          <label className="vui-label" htmlFor="mfa-setup-code">
            Confirm the code from your app
          </label>
          <TextInput
            autoComplete="one-time-code"
            className="text-center text-2xl tracking-[0.4em]"
            id="mfa-setup-code"
            inputMode="numeric"
            maxLength={6}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
            }
            pattern="[0-9]*"
            placeholder="000000"
            value={code}
          />
        </div>

        <Button disabled={code.length !== 6 || isSubmitting} type="submit" variant="primary">
          {isSubmitting ? "Confirming…" : "Confirm and continue"}
        </Button>
      </form>
    </TotpSetup>
  );
}
