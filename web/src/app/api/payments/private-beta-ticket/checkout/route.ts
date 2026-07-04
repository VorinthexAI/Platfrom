import { NextResponse } from "next/server";

const ticketProductId = "private.beta.access.ticket";
const backendApiVersionPath = "/api/v1";

function getBackendUrl() {
  const configuredUrl =
    process.env.API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    "http://localhost:4000";
  const normalizedUrl = configuredUrl.replace(/\/+$/, "");

  return normalizedUrl.endsWith(backendApiVersionPath)
    ? normalizedUrl
    : `${normalizedUrl}${backendApiVersionPath}`;
}

function readCheckoutUrl(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const body = data as Record<string, unknown>;
  const checkoutUrl =
    body.checkout_url ?? body.checkoutUrl ?? body.url ?? body.redirect_url;

  return typeof checkoutUrl === "string" && checkoutUrl.startsWith("http")
    ? checkoutUrl
    : null;
}

export async function POST(request: Request) {
  const idempotencyKey = request.headers.get("Idempotency-Key");
  const body = (await request.json().catch(() => null)) as {
    email_hash?: unknown;
  } | null;
  const emailHash =
    typeof body?.email_hash === "string" ? body.email_hash.trim() : "";

  if (!idempotencyKey) {
    return NextResponse.json(
      {
        code: "PAYMENT_IDEMPOTENCY_KEY_REQUIRED",
        message: "Missing Idempotency-Key header.",
      },
      { status: 400 },
    );
  }

  if (!emailHash) {
    return NextResponse.json(
      {
        code: "PAYMENT_EMAIL_HASH_REQUIRED",
        message: "Missing email_hash.",
      },
      { status: 400 },
    );
  }

  let backendRes: Response;
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    };
    const backendApiKey =
      process.env.BACKEND_API_KEY ?? process.env.NEXT_PUBLIC_BACKEND_API_KEY;
    if (backendApiKey) {
      headers["x-vorinthex-api-key"] = backendApiKey;
    }

    backendRes = await fetch(`${getBackendUrl()}/payments/checkout`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email_hash: emailHash,
        product_id: ticketProductId,
      }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      {
        code: "PAYMENT_BACKEND_UNREACHABLE",
        message: "Couldn't start checkout. Try again.",
      },
      { status: 502 },
    );
  }

  const data = await backendRes.json().catch(() => null);

  if (!backendRes.ok) {
    return NextResponse.json(
      data ?? {
        code: "PAYMENT_CHECKOUT_FAILED",
        message: "Couldn't start checkout. Try again.",
      },
      { status: backendRes.status },
    );
  }

  const checkoutUrl = readCheckoutUrl(data);

  if (!checkoutUrl) {
    return NextResponse.json(
      {
        code: "PAYMENT_CHECKOUT_URL_MISSING",
        message: "Checkout was created, but no checkout URL was returned.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ checkoutUrl });
}
