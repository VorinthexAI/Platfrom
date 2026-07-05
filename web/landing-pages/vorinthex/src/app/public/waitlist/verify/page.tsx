import type { Metadata } from "next";
import Link from "next/link";

import { Card } from "@vorinthex/shared/ui";

export const metadata: Metadata = {
  title: "Verify waitlist email",
  robots: {
    index: false,
    follow: false,
  },
};

type VerifyWaitlistResponse = {
  ok: boolean;
  email?: string;
  is_verified?: boolean;
};

type VerificationState =
  | { status: "missing" }
  | { status: "verified"; email: string }
  | { status: "invalid" }
  | { status: "error" };

const apiVersionPath = "/api/v1";

function getBackendUrl() {
  const configuredUrl =
    process.env.API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    "http://localhost:4000";
  const normalizedUrl = configuredUrl.replace(/\/+$/, "");

  return normalizedUrl.endsWith(apiVersionPath)
    ? normalizedUrl
    : `${normalizedUrl}${apiVersionPath}`;
}

export default async function WaitlistVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const tokenHash =
    typeof params.token_hash === "string" ? params.token_hash.trim() : "";
  const state = await verifyWaitlistToken(tokenHash);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-16 text-foreground sm:py-24">
      <div aria-hidden="true" className="vui-grid-field absolute inset-0" />
      <Card className="relative z-10 w-full max-w-md">
        <p className="vui-label">Waitlist verification</p>
        {state.status === "verified" ? (
          <>
            <h1 className="mt-2 text-3xl font-normal">Email verified.</h1>
            <p className="mt-3 text-sm leading-6 text-muted">
              {state.email} is verified for the Vorinthex AI waitlist.
            </p>
          </>
        ) : state.status === "missing" ? (
          <>
            <h1 className="mt-2 text-3xl font-normal">Verification link missing.</h1>
            <p className="mt-3 text-sm leading-6 text-muted">
              This verification link is missing its token. Open the latest link
              from your email.
            </p>
          </>
        ) : state.status === "invalid" ? (
          <>
            <h1 className="mt-2 text-3xl font-normal">Link expired.</h1>
            <p className="mt-3 text-sm leading-6 text-muted">
              This waitlist verification link is invalid or expired. Join the
              waitlist again to receive a fresh link.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-2 text-3xl font-normal">Could not verify.</h1>
            <p className="mt-3 text-sm leading-6 text-muted">
              The verification service could not be reached. Try the email link
              again in a moment.
            </p>
          </>
        )}

        <Link className="vui-button vui-button-primary mt-6 w-full" href="/">
          Return to Vorinthex AI
        </Link>
      </Card>
    </main>
  );
}

async function verifyWaitlistToken(
  tokenHash: string,
): Promise<VerificationState> {
  if (!tokenHash) {
    return { status: "missing" };
  }

  let res: Response;
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    const backendApiKey =
      process.env.BACKEND_API_KEY ?? process.env.NEXT_PUBLIC_BACKEND_API_KEY;
    if (backendApiKey) {
      headers["x-vorinthex-api-key"] = backendApiKey;
    }

    res = await fetch(
      `${getBackendUrl()}/waitlist/verify?token_hash=${encodeURIComponent(
        tokenHash,
      )}`,
      {
        cache: "no-store",
        headers,
        method: "GET",
      },
    );
  } catch {
    return { status: "error" };
  }

  if (res.status === 401) {
    return { status: "invalid" };
  }

  if (!res.ok) {
    return { status: "error" };
  }

  const data = (await res.json().catch(() => null)) as
    | VerifyWaitlistResponse
    | null;

  if (data?.ok && data.is_verified && data.email) {
    return { status: "verified", email: data.email };
  }

  return { status: "error" };
}
