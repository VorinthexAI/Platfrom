"use client";

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

export function SignInForm() {
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
      setFormError(result.message);
      return;
    }

    setSentTo(email);
  };

  if (sentTo) {
    return (
      <Card>
        <p className="cui-label">Check your email</p>
        <h1 className="mt-2 text-3xl font-normal">Sign-in link sent.</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Open the latest link sent to {sentTo}. It expires soon and can only be
          used once.
        </p>
        <Button className="mt-6 w-full" onClick={() => setSentTo(null)} variant="secondary">
          Use a different email
        </Button>
      </Card>
    );
  }

  return (
    <Card>
      <p className="cui-label">Sign in</p>
      <h1 className="mt-2 text-3xl font-normal">Sign in by email.</h1>
      <p className="mt-2 text-sm leading-6 text-muted">
        Enter your email. We&apos;ll send a secure sign-in link.
      </p>

      {formError ? (
        <Alert className="mt-4" role="alert" variant="danger">
          {formError}
        </Alert>
      ) : null}

      <form className="mt-6 flex flex-col gap-4" noValidate onSubmit={handleSubmit(onSubmit)}>
        <FormField className="flex flex-col gap-1.5">
          <label className="cui-label" htmlFor="signin-email">
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
            <ValidationMessage>{errors.email.message}</ValidationMessage>
          ) : null}
        </FormField>

        <Button disabled={isSubmitting} loading={isSubmitting} type="submit" variant="primary">
          Send sign-in link
        </Button>
      </form>
    </Card>
  );
}
