import type { Metadata } from "next";
import Link from "next/link";

import { Card } from "@/shared/packages/ui";

import { RetryButton } from "./retry-button";

export const metadata: Metadata = {
  title: "Unsubscribe from updates",
  robots: {
    index: false,
    follow: false,
  },
};

type UnsubscribeResponse = {
  ok?: boolean;
  email?: string;
  is_subscribed_to_updates?: boolean;
};

type UnsubscribeState =
  | { status: "success" }
  | { status: "invalid" }
  | { status: "network-error" };

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

export default async function UpdatesUnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const tokenHash =
    typeof params.token_hash === "string" ? params.token_hash.trim() : "";
  const state = await unsubscribeFromUpdates(tokenHash);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-16 text-foreground sm:py-24">
      <div aria-hidden="true" className="vui-grid-field absolute inset-0" />
      <Card className="relative z-10 w-full max-w-md">
        <p className="vui-label">Email preferences</p>
        {state.status === "success" ? (
          <>
            <h1 className="mt-2 text-3xl font-normal">
              You are successfully unsubscribed from marketing emails.
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted">
              You may still receive account, security, payment, and
              transactional emails.
            </p>
            <Link className="vui-button vui-button-secondary mt-6 w-full" href="/">
              Return to Vorinthex AI
            </Link>
          </>
        ) : state.status === "network-error" ? (
          <>
            <h1 className="mt-2 text-3xl font-normal">Could not unsubscribe.</h1>
            <p className="mt-3 text-sm leading-6 text-muted">
              We could not reach the unsubscribe service. Try once more.
            </p>
            <RetryButton />
          </>
        ) : (
          <>
            <h1 className="mt-2 text-3xl font-normal">
              This unsubscribe link is invalid or expired.
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted">
              Use the newest unsubscribe link from the latest Vorinthex
              marketing email.
            </p>
            <Link className="vui-button vui-button-secondary mt-6 w-full" href="/">
              Return to Vorinthex AI
            </Link>
          </>
        )}
      </Card>
    </main>
  );
}

async function unsubscribeFromUpdates(
  tokenHash: string,
): Promise<UnsubscribeState> {
  if (!tokenHash) {
    return { status: "invalid" };
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
      `${getBackendUrl()}/updates/unsubscribe?token_hash=${encodeURIComponent(
        tokenHash,
      )}`,
      {
        cache: "no-store",
        headers,
        method: "GET",
      },
    );
  } catch {
    return { status: "network-error" };
  }

  if (!res.ok) {
    return { status: "invalid" };
  }

  const data = (await res.json().catch(() => null)) as
    | UnsubscribeResponse
    | null;

  if (data?.ok && data.is_subscribed_to_updates === false) {
    return { status: "success" };
  }

  return { status: "invalid" };
}
