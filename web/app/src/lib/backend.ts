import "server-only";

/**
 * Server-side bridge to the platform backend (Bun/Hono, ArangoDB). All
 * calls happen from Next route handlers with the API key attached — the
 * key never reaches the browser. When the backend isn't configured (local
 * frontend-only development), callers fall back to their local stubs so
 * the landing page stays fully explorable.
 */

const BASE_URL = (
  process.env.BACKEND_API_URL
  ?? process.env.API_BASE_URL
  ?? process.env.NEXT_PUBLIC_API_BASE_URL
)?.replace(/\/$/, "");
const API_KEY = process.env.BACKEND_API_KEY;

export function backendConfigured(): boolean {
  return Boolean(BASE_URL && API_KEY);
}

export interface BackendResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
}

export async function backendFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<BackendResult<T>> {
  if (!BASE_URL || !API_KEY) {
    return { ok: false, status: 503, data: null };
  }
  try {
    const response = await fetch(`${BASE_URL}/api/v1${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-vorinthex-api-key": API_KEY,
        ...init.headers,
      },
      cache: "no-store",
    });
    const data = (await response.json().catch(() => null)) as T | null;
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 502, data: null };
  }
}

/** Raw streaming fetch (SSE proxy) — returns the upstream Response or null. */
export async function backendStream(path: string): Promise<Response | null> {
  if (!BASE_URL || !API_KEY) return null;
  try {
    const response = await fetch(`${BASE_URL}/api/v1${path}`, {
      headers: {
        Accept: "text/event-stream",
        "x-vorinthex-api-key": API_KEY,
      },
      cache: "no-store",
    });
    if (!response.ok || !response.body) return null;
    return response;
  } catch {
    return null;
  }
}
