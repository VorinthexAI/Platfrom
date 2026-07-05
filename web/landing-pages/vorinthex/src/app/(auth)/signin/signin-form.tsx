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
} from "@vorinthex/shared/ui";

import { requestSignInEmailAction } from "../auth-actions";

const signInSchema = z.object({
  email: z.string().trim().min(1, "Enter your email.").email("Enter a valid email address."),
});

type SignInValues = z.infer<typeof signInSchema>;

export function SignInForm({ enrolled = false }: { enrolled?: boolean }) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
  } = useForm<SignInValues>({
    mode: "onBlur",
    resolver: zodResolver(signInSchema),
  });

  const onSubmit = async (values: SignInValues) => {
    setFormError(null);
    const email = values.email.trim().toLowerCase();
    const result = await requestSignInEmailAction({ email });
    if (!result.ok) {
      setFormError(
        result.action === "join_waitlist"
          ? "This email is not on the private access list yet. Join the waitlist first."
          : result.message,
      );
      return;
    }

    setSentTo(email);
  };

  if (sentTo) {
    return (
      <Card>
        <p className="vui-label">Check your email</p>
        <h1 className="mt-2 text-3xl font-normal">Sign-in link sent.</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Open the latest link sent to {sentTo}. It expires soon and can only be
          used once.
        </p>
        <p className="mt-3 text-sm leading-6 text-muted">
          In development, check Mailpit for the message.
        </p>
        <Button className="mt-6 w-full" onClick={() => setSentTo(null)} variant="secondary">
          Use a different email
        </Button>
      </Card>
    );
  }

  return (
    <Card>
      <p className="vui-label">Private access</p>
      <h1 className="mt-2 text-3xl font-normal">Sign in by email.</h1>
      <p className="mt-2 text-sm leading-6 text-muted">
        Enter your invite email. We will send a secure magic link, then ask for
        your authenticator code if MFA is already enabled.
      </p>

      {enrolled ? (
        <Alert className="mt-4 border border-border bg-secondary px-4 py-3 text-sm text-muted">
          Authenticator setup complete. Sign in to enter the app.
        </Alert>
      ) : null}

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
          <label className="vui-label" htmlFor="signin-email">
            Email
          </label>
          <TextInput
            aria-invalid={Boolean(errors.email)}
            autoComplete="email"
            id="signin-email"
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
          {isSubmitting ? "Sending link..." : "Send sign-in link"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        Need access?{" "}
        <Link className="text-accent underline underline-offset-4" href="/">
          Join the waitlist
        </Link>
      </p>
    </Card>
  );
}
