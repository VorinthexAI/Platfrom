"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import {
  Alert,
  Button,
  Card,
  FormField,
  PasswordInput,
  TextInput,
  ValidationMessage,
} from "@vorinthex/shared/ui";

import { signupAction } from "./actions";
import { signupSchema, type SignupInput } from "./schema";

export function SignupForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
  } = useForm<SignupInput>({
    mode: "onBlur",
    resolver: zodResolver(signupSchema),
  });

  const onSubmit = async (values: SignupInput) => {
    setFormError(null);
    const result = await signupAction(values);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    router.push("/signup/mfa-setup");
  };

  return (
    <Card>
      <p className="vui-label">Create your account</p>
      <h1 className="mt-2 text-3xl font-normal">Sign up</h1>
      <p className="mt-2 text-sm text-muted">
        We&apos;ll set up two-factor authentication next, so your account is
        protected from the start.
      </p>

      {formError ? (
        <Alert
          className="mt-6 border border-[var(--vui-color-danger)] bg-[var(--vui-color-danger)]/10 px-4 py-3 text-sm text-[var(--vui-color-danger)]"
          role="alert"
        >
          {formError}
        </Alert>
      ) : null}

      <form className="mt-6 flex flex-col gap-4" noValidate onSubmit={handleSubmit(onSubmit)}>
        <FormField className="flex flex-col gap-1.5">
          <label className="vui-label" htmlFor="signup-email">
            Email
          </label>
          <TextInput
            aria-invalid={Boolean(errors.email)}
            autoComplete="email"
            id="signup-email"
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

        <FormField className="flex flex-col gap-1.5">
          <label className="vui-label" htmlFor="signup-password">
            Password
          </label>
          <PasswordInput
            aria-invalid={Boolean(errors.password)}
            autoComplete="new-password"
            id="signup-password"
            {...register("password")}
          />
          {errors.password ? (
            <ValidationMessage className="text-sm text-[var(--vui-color-danger)]">
              {errors.password.message}
            </ValidationMessage>
          ) : null}
        </FormField>

        <Button disabled={isSubmitting} type="submit" variant="primary">
          {isSubmitting ? "Creating account…" : "Continue"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <a className="text-accent underline underline-offset-4" href="/signin">
          Sign in
        </a>
      </p>
    </Card>
  );
}
