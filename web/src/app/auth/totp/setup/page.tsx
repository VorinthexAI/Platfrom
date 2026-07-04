import type { Metadata } from "next";
import Link from "next/link";

import { Card } from "@/shared/packages/ui";
import { startTotpSetup } from "@/app/(auth)/auth-actions";

import { SetupTotpForm } from "./setup-totp-form";

export const metadata: Metadata = {
  title: "Set up authenticator",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function TotpSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const challengeTokenHash =
    typeof params.challenge === "string" ? params.challenge.trim() : "";
  const setup = await startTotpSetup(challengeTokenHash);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-16 text-foreground sm:py-24">
      <div aria-hidden="true" className="vui-grid-field absolute inset-0" />
      <div className="relative z-10 w-full max-w-lg">
        {setup.ok ? (
          <SetupTotpForm
            otpauthUrl={setup.otpauthUrl}
            qrCodeDataUrl={setup.qrCodeDataUrl}
            secret={setup.secret}
            setupChallengeTokenHash={setup.setupChallengeTokenHash}
          />
        ) : (
          <Card>
            <p className="vui-label">Two-factor setup</p>
            <h1 className="mt-2 text-3xl font-normal">Setup unavailable.</h1>
            <p className="mt-3 text-sm leading-6 text-muted">{setup.message}</p>
            <div className="mt-6 flex flex-col gap-3">
              <Link className="vui-button vui-button-primary" href="/signin">
                Request a new sign-in email
              </Link>
              <Link className="vui-button vui-button-secondary" href="/auth/totp/reset">
                Request reset link
              </Link>
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}
