import type { Metadata } from "next";
import Link from "next/link";

import { Card } from "@vorinthex/shared/ui";

import { VerifyTotpForm } from "./verify-totp-form";

export const metadata: Metadata = {
  title: "Verify authenticator code",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function TotpVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const challengeTokenHash =
    typeof params.challenge === "string" ? params.challenge.trim() : "";

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-16 text-foreground sm:py-24">
      <div aria-hidden="true" className="vui-grid-field absolute inset-0" />
      <div className="relative z-10 w-full max-w-md">
        {challengeTokenHash ? (
          <VerifyTotpForm challengeTokenHash={challengeTokenHash} />
        ) : (
          <Card>
            <p className="vui-label">Two-factor verification</p>
            <h1 className="mt-2 text-3xl font-normal">Session expired.</h1>
            <p className="mt-3 text-sm leading-6 text-muted">
              This verification session expired. Request a new sign-in email.
            </p>
            <Link className="vui-button vui-button-primary mt-6 w-full" href="/signin">
              Request a new sign-in email
            </Link>
          </Card>
        )}
      </div>
    </main>
  );
}
