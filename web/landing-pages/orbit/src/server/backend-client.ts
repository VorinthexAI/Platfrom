import "server-only";

import { cookies } from "next/headers";

// Mirrors shared/lib/api-client.ts's base-URL/version-path/header
// conventions, but built on native `fetch` instead of Axios: server-side
// call sites (route handlers, the DAL) need Next's `fetch` cache/cookie
// ergonomics, which an Axios instance doesn't participate in.
const API_BASE_URL =
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:4000";
const BACKEND_API_KEY =
  process.env.BACKEND_API_KEY ?? process.env.NEXT_PUBLIC_BACKEND_API_KEY;
const API_VERSION_PATH = "/api/v1";

function normalizeApiBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith(API_VERSION_PATH)
    ? trimmed
    : `${trimmed}${API_VERSION_PATH}`;
}

function buildUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizeApiBaseUrl(API_BASE_URL)}${normalizedPath}`;
}

/**
 * Forwards the incoming request's cookies to the backend (the backend owns
 * session validation; we just relay whatever `cxo_session` etc. the browser
 * sent us) and injects the server-only `x-orbit-api-key` header.
 */
async function buildHeaders(init: RequestInit | undefined): Promise<Headers> {
  const headers = new Headers(init?.headers);

  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  if (cookieHeader) headers.set("Cookie", cookieHeader);

  if (BACKEND_API_KEY) headers.set("x-orbit-api-key", BACKEND_API_KEY);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  return headers;
}

/**
 * Server-side fetch to the backend, `/api/v1`-prefixed, cookie-forwarding.
 * Defaults to a JSON `Content-Type` whenever a body is present — override
 * per-call for anything else (e.g. multipart).
 */
export async function backendFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = await buildHeaders(init);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(buildUrl(path), {
    ...init,
    headers,
    cache: "no-store",
  });
}

/**
 * Same request plumbing as `backendFetch`, kept as a separate named export
 * for streaming call sites — those callers read `response.body` as a
 * `ReadableStream` and should not have a JSON `Content-Type` assumed onto
 * their (often bodyless GET, or non-JSON POST) requests.
 */
export async function backendFetchStream(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = await buildHeaders(init);

  return fetch(buildUrl(path), {
    ...init,
    headers,
    cache: "no-store",
  });
}
