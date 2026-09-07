import { isIP } from "node:net";
import {
  isAllowedPolarCheckoutUrl,
  isCheckoutHandoffToken,
  type CheckoutResolution,
} from "./checkout-handoff-contract";

const MAX_REQUEST_BYTES = 128;
const MAX_RESPONSE_BYTES = 16_384;
const BACKEND_TIMEOUT_MS = 8_000;

const PRODUCT_NAMES = {
  "nova.weekly": "Weekly membership",
  "nova.monthly": "Monthly membership",
  "nova.monthly.discounted": "Monthly membership",
  "topup.small": "One-time Spark top-up",
} as const;

type ProductId = keyof typeof PRODUCT_NAMES;

function noStoreJson(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function parseTokenBody(request: Request): Promise<string | undefined> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return undefined;

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) return undefined;

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) return undefined;
  const body: unknown = (() => {
    try { return JSON.parse(text); } catch { return undefined; }
  })();
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  return Object.keys(record).length === 1 && isCheckoutHandoffToken(record.token)
    ? record.token
    : undefined;
}

function backendUrl(action: "resolve" | "continue") {
  const base = process.env.BACKEND_API_URL ?? "http://localhost:3001";
  return `${base.replace(/\/$/, "")}/api/v1/payments/checkout-handoffs/${action}`;
}

function customerIpAddress(request: Request) {
  const candidates = [
    request.headers.get("cf-connecting-ip"),
    request.headers.get("true-client-ip"),
    request.headers.get("x-real-ip"),
    ...(request.headers.get("x-forwarded-for")?.split(",") ?? []),
  ];
  return candidates.map((value) => value?.trim()).find((value): value is string => Boolean(value && isIP(value)));
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) return undefined;
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseResolution(payload: unknown): CheckoutResolution | undefined {
  if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data)) return undefined;
  const { product, expiresAt } = payload.data;
  if (!isRecord(product) || typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))) return undefined;

  const productId = product.productId;
  const type = product.type;
  const billingPeriod = product.billingPeriod;
  const priceCents = product.discountedPriceCents ?? product.priceCents;
  const referencePriceCents = product.discountedPriceCents === null ? null : product.priceCents;
  const microSparks = product.sparkGrantMicroSparks;
  if (
    typeof productId !== "string" || !(productId in PRODUCT_NAMES) ||
    (type !== "subscription" && type !== "one_time") ||
    (billingPeriod !== "week" && billingPeriod !== "month" && billingPeriod !== null) ||
    typeof priceCents !== "number" || !Number.isSafeInteger(priceCents) || priceCents <= 0 ||
    (referencePriceCents !== null && (typeof referencePriceCents !== "number" || !Number.isSafeInteger(referencePriceCents) || referencePriceCents <= priceCents)) ||
    product.currency !== "USD" || product.active !== true ||
    typeof microSparks !== "number" || !Number.isSafeInteger(microSparks) || microSparks <= 0 || microSparks % 1_000_000 !== 0 ||
    (type === "subscription") !== (billingPeriod !== null)
  ) return undefined;

  return {
    product: {
      name: PRODUCT_NAMES[productId as ProductId],
      type,
      priceCents,
      referencePriceCents,
      currency: "USD",
      billingPeriod,
      sparks: microSparks / 1_000_000,
    },
    expiresAt,
  };
}

function parseContinueUrl(payload: unknown): string | undefined {
  if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data)) return undefined;
  return isAllowedPolarCheckoutUrl(payload.data.url) ? payload.data.url : undefined;
}

export async function handleCheckoutHandoff(
  request: Request,
  action: "resolve" | "continue",
): Promise<Response> {
  const token = await parseTokenBody(request);
  if (!token) return noStoreJson({ error: "Invalid checkout request." }, 400);

  try {
    const customerIp = action === "continue" ? customerIpAddress(request) : undefined;
    const response = await fetch(backendUrl(action), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Vorinthex-API-Key": process.env.BACKEND_API_KEY ?? "",
        ...(customerIp ? { "X-Vorinthex-Customer-IP": customerIp } : {}),
      },
      body: JSON.stringify({ token }),
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
    if (!response.ok) {
      return noStoreJson(
        { error: "This checkout link is unavailable. Return to the app and try again." },
        response.status === 404 ? 404 : 502,
      );
    }

    const payload = await readBoundedJson(response);
    if (action === "resolve") {
      const data = parseResolution(payload);
      return data
        ? noStoreJson({ success: true, data }, 200)
        : noStoreJson({ error: "Checkout is temporarily unavailable." }, 502);
    }

    const url = parseContinueUrl(payload);
    return url
      ? noStoreJson({ success: true, data: { url } }, 200)
      : noStoreJson({ error: "Checkout is temporarily unavailable." }, 502);
  } catch {
    return noStoreJson({ error: "Checkout is temporarily unavailable." }, 502);
  }
}
