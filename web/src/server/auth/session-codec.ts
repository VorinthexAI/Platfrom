import "server-only";

/**
 * The minimal, non-sensitive shape stored in the `vx_session` cookie so that
 * `src/proxy.ts` can do an *optimistic* auth check (no network round-trip)
 * per neural-map.md §4.3. The backend's own session store is the source of
 * truth — this cookie is a signed hint, not a credential the backend trusts
 * on its own (every real request still round-trips through backendFetch,
 * which forwards the cookie so the backend can authoritatively validate it).
 */
export type SessionCookiePayload = {
  sub: string;
  state: "mfa_required" | "authenticated";
  iat: number;
  exp: number;
};

export const SESSION_COOKIE_NAME = "vx_session";

/** §4.2 step 3: the partial (`mfa_required`) session must be short-lived. */
export const PARTIAL_SESSION_TTL_SECONDS = 5 * 60;
/** Full, MFA'd session lifetime for the locally-minted cookie's `exp` hint. */
export const FULL_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

// This repo has no session/JWT library installed (no `jose`, no
// `iron-session`). Rather than add a new dependency for what is explicitly
// documented as an *optimistic, non-authoritative* check, we sign the
// payload ourselves with HMAC-SHA256 via the platform Web Crypto API
// (`crypto.subtle`), which is available in both the Node.js runtime (what
// Proxy defaults to in Next 16) and the Edge runtime, so this module never
// has to care which one it's running in. This is deliberately NOT a JWT —
// just `base64url(payload).base64url(signature)` — since nothing outside
// this codebase ever needs to parse the token.
const SESSION_SECRET =
  process.env.SESSION_COOKIE_SECRET ??
  process.env.SESSION_SECRET ??
  "vorinthex-dev-insecure-session-secret-change-me";

let cachedKey: Promise<CryptoKey> | null = null;

function getSigningKey(): Promise<CryptoKey> {
  if (!cachedKey) {
    cachedKey = crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SESSION_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }
  return cachedKey;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(withPadding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encryptSessionCookie(
  payload: SessionCookiePayload,
): Promise<string> {
  const key = await getSigningKey();
  const body = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return `${body}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function decryptSessionCookie(
  cookie: string | undefined | null,
): Promise<SessionCookiePayload | null> {
  if (!cookie) return null;

  const [body, signature] = cookie.split(".");
  if (!body || !signature) return null;

  try {
    const key = await getSigningKey();
    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(signature),
      new TextEncoder().encode(body),
    );
    if (!isValid) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(body)),
    ) as SessionCookiePayload;

    if (
      typeof payload.exp !== "number" ||
      payload.exp * 1000 < Date.now() ||
      (payload.state !== "mfa_required" && payload.state !== "authenticated")
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function buildSessionPayload(
  sub: string,
  state: SessionCookiePayload["state"],
): SessionCookiePayload {
  const iat = Math.floor(Date.now() / 1000);
  const ttl =
    state === "authenticated"
      ? FULL_SESSION_TTL_SECONDS
      : PARTIAL_SESSION_TTL_SECONDS;
  return { sub, state, iat, exp: iat + ttl };
}
