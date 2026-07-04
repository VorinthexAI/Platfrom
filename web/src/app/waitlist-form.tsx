"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useForm, type FieldErrors } from "react-hook-form";
import { z } from "zod";

import { Button } from "@vorinthex/shared/ui";

import { joinWaitlistAction } from "./waitlist-actions";

const waitlistSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email to join the list.")
    .email("Enter a valid email address."),
});

type WaitlistFormValues = z.infer<typeof waitlistSchema>;

type ToastIntent = "success" | "error";

type ToastMessage = {
  id: string;
  intent: ToastIntent;
  message: string;
  title: string;
};

function createToastId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export type WaitlistJoinResult = {
  emailHash: string;
};

export function WaitlistForm({
  isWaitlistMember,
  onInvitedSignIn,
  onJoined,
}: {
  isWaitlistMember?: boolean;
  onInvitedSignIn?: () => void;
  onJoined?: (result: WaitlistJoinResult) => void;
}) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const {
    formState: { errors, isSubmitSuccessful },
    handleSubmit,
    register,
    reset,
  } = useForm<WaitlistFormValues>({
    criteriaMode: "all",
    mode: "onChange",
    resolver: zodResolver(waitlistSchema),
  });

  const emailError = errors.email?.message;

  const addToast = (toast: Omit<ToastMessage, "id">) => {
    setToasts((current) => [
      ...current.slice(-2),
      {
        ...toast,
        id: createToastId(),
      },
    ]);
  };

  const removeToast = (id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  };

  const onSubmit = async (values: WaitlistFormValues) => {
    const email = values.email.trim().toLowerCase();
    const result = await joinWaitlistAction({ email });
    if (!result.ok) {
      addToast({
        intent: "error",
        title: "Check the email.",
        message: result.message,
      });
      return;
    }

    addToast({
      intent: "success",
      title: "You are on the list.",
      message: "You are subscribed to private beta updates.",
    });
    onJoined?.({ emailHash: result.emailHash });
    reset();
  };

  const onInvalid = (formErrors: FieldErrors<WaitlistFormValues>) => {
    const messages = Object.values(formErrors)
      .map((error) => error?.message)
      .filter(Boolean);

    addToast({
      intent: "error",
      title: "Check the email.",
      message: messages.join(" ") || "Enter a valid email and try again.",
    });
  };

  useEffect(() => {
    if (!toasts.length) {
      return;
    }

    const timers = toasts.map((toast) =>
      window.setTimeout(() => removeToast(toast.id), 5200),
    );

    return () => timers.forEach(window.clearTimeout);
  }, [toasts]);

  useEffect(() => {
    if (!isSubmitSuccessful) {
      return;
    }

    const timer = window.setTimeout(() => {
      reset(undefined, { keepValues: false });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [isSubmitSuccessful, reset]);

  const describedBy = useMemo(
    () => (emailError ? "waitlist-email-error" : undefined),
    [emailError],
  );

  return (
    <>
      <form
        className="mt-8 w-full max-w-xl sm:mt-12"
        noValidate
        onSubmit={handleSubmit(onSubmit, onInvalid)}
      >
        {isWaitlistMember ? (
          <div className="mb-3 flex items-center gap-2 text-lg text-accent">
            <WaitlistCheckIcon />
            <span>You are on the waitlist.</span>
          </div>
        ) : (
          <>
            <p className="mb-2 text-sm text-muted">
              Join waitlist for free today.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="sr-only" htmlFor="waitlist-email">
                Email address
              </label>
              <input
                aria-describedby={describedBy}
                aria-invalid={Boolean(emailError)}
                autoComplete="email"
                className="vui-control min-h-12 flex-1 bg-surface px-4 text-[17px] aria-invalid:border-[var(--vui-color-danger)]"
                id="waitlist-email"
                inputMode="email"
                placeholder="you@example.com"
                type="text"
                {...register("email")}
              />
              <Button
                className="min-h-12 whitespace-nowrap"
                type="submit"
                variant="primary"
              >
                Join
              </Button>
            </div>
            <p
              className="mt-2 min-h-5 text-sm text-[var(--vui-color-danger)]"
              id="waitlist-email-error"
            >
              {emailError}
            </p>
          </>
        )}
        <button
          className="mt-1 inline-flex cursor-pointer items-center gap-2 text-sm text-muted transition-colors hover:text-foreground"
          onClick={onInvitedSignIn}
          type="button"
        >
          Already invited? Click here to sign in
          <span aria-hidden="true">-&gt;</span>
        </button>
      </form>

      <ToastStack onDismiss={removeToast} toasts={toasts} />
    </>
  );
}

function WaitlistCheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5 shrink-0"
      fill="none"
      focusable="false"
      viewBox="0 0 20 20"
    >
      <path
        d="m4.5 10.5 3.2 3.2 7.8-8.4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function ToastStack({
  onDismiss,
  toasts,
}: {
  onDismiss: (id: string) => void;
  toasts: ToastMessage[];
}) {
  const [canPortal, setCanPortal] = useState(false);
  const visibleToasts = [...toasts].reverse();

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setCanPortal(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  if (!canPortal) {
    return null;
  }

  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-8 z-[2147483647] flex justify-center px-4"
      role="status"
    >
      <div className="relative h-28 w-full max-w-[360px]">
        {visibleToasts.map((toast, index) => (
          <div
            aria-hidden={index > 0}
            className={`vui-toast absolute inset-x-0 bottom-0 border border-border bg-surface px-4 py-3 text-left ${
              index === 0 ? "pointer-events-auto" : "pointer-events-none"
            }`}
            data-stack-index={index}
            key={toast.id}
            style={{
              opacity: Math.max(0.56, 1 - index * 0.18),
              "--toast-scale": `${1 - index * 0.06}`,
              "--toast-y": `${index * 11}px`,
              zIndex: visibleToasts.length - index,
            } as CSSProperties}
          >
            <button
              aria-label="Dismiss notification"
              className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full text-xs text-muted transition-colors hover:text-foreground"
              onClick={() => onDismiss(toast.id)}
              type="button"
            >
              x
            </button>
            <div className="flex items-start gap-3 pr-8">
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  toast.intent === "success"
                    ? "bg-accent"
                    : "bg-[var(--vui-color-danger)]"
                }`}
              />
              <span>
                <span className="block text-sm font-medium">{toast.title}</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted">
                  {toast.message}
                </span>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
