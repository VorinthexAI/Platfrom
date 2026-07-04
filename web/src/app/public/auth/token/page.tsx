import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Card } from "@/shared/packages/ui";
import { validateMagicLinkAction } from "@/app/(auth)/auth-actions";

export const metadata: Metadata = {
  title: "Verify sign-in link",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AuthTokenPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const tokenHash =
    typeof params.token_hash === "string" ? params.token_hash.trim() : "";
  const result = await validateMagicLinkAction(tokenHash);

  if (result.ok) {
    const query = `challenge=${encodeURIComponent(result.challengeTokenHash)}`;
    if (result.status === "totp_required") {
      redirect(`/auth/totp/verify?${query}`);
    }
    redirect(`/auth/totp/setup?${query}`);
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-16 text-foreground sm:py-24">
      <div aria-hidden="true" className="vui-grid-field absolute inset-0" />
      <Card className="relative z-10 w-full max-w-md">
        <p className="vui-label">Magic link sign-in</p>
        <h1 className="mt-2 text-3xl font-normal">Link invalid or expired.</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          {result.message}
        </p>
        <Link className="vui-button vui-button-primary mt-6 w-full" href="/signin">
          Request a new sign-in email
        </Link>
      </Card>
    </main>
  );
}
