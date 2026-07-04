"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  Alert,
  Button,
  Card,
  FormField,
  TextInput,
  ValidationMessage,
} from "@/shared/packages/ui";
import { requestMfaResetAction } from "@/app/(auth)/auth-actions";

const resetSchema = z.object({
  email: z.string().trim().min(1, "Enter your email.").email("Enter a valid email address."),
});

type ResetValues = z.infer<typeof resetSchema>;

export function ResetTotpForm() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
  } = useForm<ResetValues>({
    mode: "onBlur",
    resolver: zodResolver(resetSchema),
  });

  const onSubmit = async (values: ResetValues) => {
    setFormError(null);
    const result = await requestMfaResetAction({ email: values.email });
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <Card>
        <p className="vui-label">Reset link requested</p>
        <h1 className="mt-2 text-3xl font-normal">Check your email.</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          If an account exists for that address, a reset link has been sent.
          Open the latest email and finish setup within 15 minutes.
        </p>
        <p className="mt-3 text-sm leading-6 text-muted">
          In development, check Mailpit for the message.
        </p>
        <Link className="vui-button vui-button-secondary mt-6 w-full" href="/signin">
          Back to sign in
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <p className="vui-label">Authenticator reset</p>
      <h1 className="mt-2 text-3xl font-normal">Request reset link.</h1>
      <p className="mt-2 text-sm leading-6 text-muted">
        Enter your email and we will send a reset link if the account exists.
        We never reveal whether an address is registered.
      </p>

      {formError ? (
        <Alert
          className="mt-4 border border-[var(--vui-color-danger)] bg-[var(--vui-color-danger)]/10 px-4 py-3 text-sm text-[var(--vui-color-danger)]"
          role="alert"
        >
          {formError}
        </Alert>
      ) : null}

      <form className="mt-6 flex flex-col gap-4" noValidate onSubmit={handleSubmit(onSubmit)}>
        <FormField className="flex flex-col gap-1.5">
          <label className="vui-label" htmlFor="reset-email">
            Email
          </label>
          <TextInput
            aria-invalid={Boolean(errors.email)}
            autoComplete="email"
            id="reset-email"
            inputMode="email"
            placeholder="you@example.com"
            {...register("email")}
          />
          {errors.email ? (
            <ValidationMessage className="text-sm text-[var(--vui-color-danger)]">
              {errors.email.message}
            </ValidationMessage>
          ) : null}
        </FormField>

        <Button disabled={isSubmitting} type="submit" variant="primary">
          {isSubmitting ? "Sending reset link..." : "Send reset link"}
        </Button>
        <Link className="vui-button vui-button-secondary" href="/signin">
          Back to sign in
        </Link>
      </form>
    </Card>
  );
}
