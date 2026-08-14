import { AxiosHeaders, create, isAxiosError, type AxiosInstance } from "axios";

import { extractSessionTokens, normalizeApiPath } from "./auth-helpers";
import { tokenVault } from "./token-vault";
import { consumeServerSentEvents, parseServerSentEvent, type ServerSentEvent } from "./sse";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://vorinthex.com";
const BACKEND_API_KEY = process.env.EXPO_PUBLIC_BACKEND_API_KEY ?? "";
let unauthorizedListener: (() => void) | undefined;
const requestSessions = new WeakMap<object, { generation: number; authenticated: boolean }>();

export const apiClient: AxiosInstance = create({
  baseURL: `${API_BASE_URL.replace(/\/$/, "")}/api/v1`,
  timeout: 15_000,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    "X-Vorinthex-Session-Transport": "header",
  },
});

apiClient.interceptors.request.use(async (config) => {
  config.url = normalizeApiPath(config.url ?? "/");
  const { session, generation, invalidated } = await tokenVault.snapshot();
  if (invalidated) unauthorizedListener?.();
  requestSessions.set(config, { generation, authenticated: Boolean(session) });
  const headers = AxiosHeaders.from(config.headers);
  if (BACKEND_API_KEY) headers.set("X-Vorinthex-API-Key", BACKEND_API_KEY);
  if (session) {
    if (session.accessExpiresAt > Date.now()) headers.set("Authorization", `Bearer ${session.accessToken}`);
    headers.set("X-Refresh-Token", session.refreshToken);
  }
  config.headers = headers;
  return config;
});

apiClient.interceptors.response.use(async (response) => {
  const tokens = extractSessionTokens(response.data, (name) => response.headers[name]);
  const requestSession = requestSessions.get(response.config);
  if (tokens && requestSession) await tokenVault.writeIfCurrent(tokens, requestSession.generation);
  return response;
}, async (error: unknown) => {
  if (isAxiosError(error) && error.response) {
    const requestSession = error.config ? requestSessions.get(error.config) : undefined;
    const tokens = extractSessionTokens(error.response.data, (name) => error.response?.headers[name]);
    if (tokens && requestSession) await tokenVault.writeIfCurrent(tokens, requestSession.generation);
    if (error.response.status === 401
      && String(error.response.headers["www-authenticate"] ?? "").includes("Bearer")
      && requestSession?.authenticated) {
      const cleared = await tokenVault.clearIfCurrent(requestSession.generation);
      if (cleared) unauthorizedListener?.();
    }
  }
  return Promise.reject(error);
});

export function onUnauthorized(listener: () => void) {
  unauthorizedListener = listener;
  return () => {
    if (unauthorizedListener === listener) unauthorizedListener = undefined;
  };
}

export async function getJson<T>(path: string): Promise<T> {
  return (await apiClient.get<T>(path)).data;
}

export async function postJson<TBody, TResponse>(path: string, body: TBody): Promise<TResponse> {
  return (await apiClient.post<TResponse>(path, body)).data;
}

export async function patchJson<TBody, TResponse>(path: string, body: TBody): Promise<TResponse> {
  return (await apiClient.patch<TResponse>(path, body)).data;
}

export async function postEventStream(path: string, body: unknown, onEvent: (event: ServerSentEvent) => void, signal?: AbortSignal) {
  const { session, generation, invalidated } = await tokenVault.snapshot();
  if (invalidated) unauthorizedListener?.();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Vorinthex-Session-Transport": "header",
    ...(BACKEND_API_KEY ? { "X-Vorinthex-API-Key": BACKEND_API_KEY } : {}),
    ...(session?.accessExpiresAt && session.accessExpiresAt > Date.now() ? { Authorization: `Bearer ${session.accessToken}` } : {}),
    ...(session?.refreshToken ? { "X-Refresh-Token": session.refreshToken } : {}),
  };
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const request = new XMLHttpRequest();
    let processed = 0;
    let buffer = "";
    let processingError: unknown;
    const abort = () => request.abort();
    const processAvailable = () => {
      if (processingError) return;
      try {
        const available = request.responseText.slice(processed);
        processed = request.responseText.length;
        buffer = consumeServerSentEvents(buffer + available, onEvent);
      } catch (error) {
        processingError = error;
        request.abort();
      }
    };
    const cleanup = () => signal?.removeEventListener("abort", abort);
    request.open("POST", `${API_BASE_URL.replace(/\/$/, "")}/api/v1${normalizeApiPath(path)}`, true);
    request.withCredentials = true;
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.onprogress = processAvailable;
    request.onerror = () => { cleanup(); reject(processingError ?? new Error("Streaming request failed.")); };
    request.onabort = () => { cleanup(); reject(processingError ?? new DOMException("Aborted", "AbortError")); };
    request.onload = () => { void (async () => {
      processAvailable();
      if (processingError) throw processingError;
      const event = parseServerSentEvent(buffer);
      if (event) onEvent(event);
      const tokens = extractSessionTokens(undefined, (name) => request.getResponseHeader(name));
      if (tokens) await tokenVault.writeIfCurrent(tokens, generation);
      if (request.status < 200 || request.status >= 300) {
        if (request.status === 401 && session && await tokenVault.clearIfCurrent(generation)) unauthorizedListener?.();
        throw new Error(`Streaming request failed with status ${request.status}.`);
      }
      cleanup();
      resolve();
    })().catch((error) => { cleanup(); reject(error); }); };
    signal?.addEventListener("abort", abort, { once: true });
    request.send(JSON.stringify(body));
  });
}

export async function revokeRemoteSession(session: { accessToken: string; refreshToken: string }) {
  await apiClient.post("/auth/logout", {}, { headers: {
    Authorization: `Bearer ${session.accessToken}`,
    "X-Refresh-Token": session.refreshToken,
  } });
}
