const TOKEN_HASH = /^[a-f0-9]{64}$/;
const TOTP_CODE = /^\d{6}$/;
const MAX_REQUEST_BYTES = 1_024;
const MAX_RESPONSE_BYTES = 64 * 1_024;
const BACKEND_TIMEOUT_MS = 8_000;

export type FounderAuthAction =
  | "gate"
  | "magic"
  | "reset"
  | "session"
  | "setup-complete"
  | "setup-start"
  | "verify";

const ACTIONS: Record<FounderAuthAction, { method: "GET" | "POST"; path: string; cookies?: boolean }> = {
  gate: { method: "POST", path: "/auth/founders-gate" },
  magic: { method: "POST", path: "/auth/magic/validate" },
  reset: { method: "POST", path: "/auth/totp/reset/request" },
  session: { method: "GET", path: "/founders/me", cookies: true },
  "setup-complete": { method: "POST", path: "/auth/totp/setup/complete" },
  "setup-start": { method: "POST", path: "/auth/totp/setup/start" },
  verify: { method: "POST", path: "/auth/totp/verify" },
};

function noStoreJson(body: unknown, status: number, cookies: string[] = []) {
  const headers = new Headers({
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Type": "application/json",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnly(record: Record<string, unknown>, keys: string[]) {
  return Object.keys(record).length === keys.length && keys.every((key) => key in record);
}

function validEmail(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validateBody(action: Exclude<FounderAuthAction, "session">, value: unknown) {
  if (!isRecord(value)) return false;
  if (action === "gate") return hasOnly(value, ["email"]) && validEmail(value.email);
  if (action === "magic") return hasOnly(value, ["token_hash"]) && typeof value.token_hash === "string" && TOKEN_HASH.test(value.token_hash);
  if (action === "setup-start" || action === "reset") return hasOnly(value, ["challenge_token_hash"]) && typeof value.challenge_token_hash === "string" && TOKEN_HASH.test(value.challenge_token_hash);
  if (action === "verify") {
    return hasOnly(value, ["challenge_token_hash", "code"])
      && typeof value.challenge_token_hash === "string" && TOKEN_HASH.test(value.challenge_token_hash)
      && typeof value.code === "string" && TOTP_CODE.test(value.code);
  }
  return hasOnly(value, ["challenge_token_hash", "codes"])
    && typeof value.challenge_token_hash === "string" && TOKEN_HASH.test(value.challenge_token_hash)
    && Array.isArray(value.codes) && value.codes.length === 2
    && value.codes.every((code) => typeof code === "string" && TOTP_CODE.test(code));
}

async function readRequestBody(request: Request, action: Exclude<FounderAuthAction, "session">) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return undefined;
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) return undefined;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) return undefined;
  let body: unknown;
  try { body = JSON.parse(text); } catch { return undefined; }
  if (!validateBody(action, body)) return undefined;
  if (action === "gate") return { email: (body as { email: string }).email.trim().toLowerCase() };
  return body;
}

async function readResponseJson(response: Response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) return undefined;
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) return undefined;
  try {
    const body: unknown = JSON.parse(text);
    return isRecord(body) ? body : undefined;
  } catch {
    return undefined;
  }
}

function backendUrl(path: string) {
  const base = process.env.BACKEND_API_URL ?? "http://localhost:3001";
  return `${base.replace(/\/$/, "")}/api/v1${path}`;
}

export async function handleFounderAuth(request: Request, action: FounderAuthAction) {
  const config = ACTIONS[action];
  if (request.method !== config.method) return noStoreJson({ error: "Invalid request." }, 405);
  if (new URL(request.url).search) return noStoreJson({ error: "Invalid request." }, 400);

  const body = action === "session" ? undefined : await readRequestBody(request, action);
  if (action !== "session" && !body) return noStoreJson({ error: "Invalid request." }, 400);

  try {
    const backendApiKey = process.env.BACKEND_API_KEY;
    if (!backendApiKey) return noStoreJson({ error: "Authentication service unavailable." }, 503);
    const headers = new Headers({
      Accept: "application/json",
      "X-Vorinthex-API-Key": backendApiKey,
    });
    if (body) headers.set("Content-Type", "application/json");
    if (config.cookies) {
      const cookie = request.headers.get("cookie");
      if (cookie) headers.set("Cookie", cookie);
    }

    const response = await fetch(backendUrl(config.path), {
      method: config.method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      credentials: "omit",
      redirect: "manual",
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
    const payload = await readResponseJson(response);
    if (!payload) return noStoreJson({ error: "Authentication service unavailable." }, 502);
    const clientPayload = action === "gate" && response.status === 202 ? { ok: true } : payload;
    return noStoreJson(clientPayload, response.status, response.headers.getSetCookie());
  } catch {
    return noStoreJson({ error: "Authentication service unavailable." }, 502);
  }
}
