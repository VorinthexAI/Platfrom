import { AxiosHeaders, CanceledError, create, isAxiosError, type AxiosInstance } from "axios";
import { captureSessionRequest, sessionEpoch, sessionIsEnding } from "./session-lifecycle";

import { extractSessionTokens, normalizeApiPath } from "./auth-helpers";
import { tokenVault } from "./token-vault";
import { consumeServerSentEvents, isAuthenticatedBearerRejection, parseServerSentEvent, type ServerSentEvent } from "./sse";
import { appKeyHeaders, selectedAppKeyHeaders, VORINTHEX_APP_KEY_HEADER } from "./app-request-headers";
import { createObservedHttpError, rejectObservedDomainError } from "./domain-error-observer";
import { getInstallationEventIdentifier, INSTALLATION_EVENT_IDENTIFIER_HEADER } from "./installation-event-identifier-vault";
import { getDeviceIdentifier, DEVICE_IDENTIFIER_HEADER } from "./device-identifier-vault";
import { ensureAppsReady } from "@/state/apps";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://vorinthex.com";
const BACKEND_API_KEY = process.env.EXPO_PUBLIC_BACKEND_API_KEY ?? "";
let unauthorizedListener: (() => void) | undefined;
const requestSessions = new WeakMap<object, { generation: number; authenticated: boolean; lifecycle: ReturnType<typeof captureSessionRequest> }>();

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
  const lifecycle = captureSessionRequest(config.signal as AbortSignal | undefined);
  try {
    const path = normalizeApiPath(config.url ?? "/");
    const publicRequest = /^\/auth\/(?!me(?:\/|$)|logout(?:\/|$))/.test(path) || /^\/(apps|products|costs|health)$/.test(path);
    if (sessionIsEnding() && !publicRequest) throw new CanceledError("canceled");
    await ensureAppsReady();
    const selectedAppHeaders = selectedAppKeyHeaders();
    const [eventIdentifier, device] = await Promise.all([getInstallationEventIdentifier(), getDeviceIdentifier()]);
    config.url = path;
    const { session, generation, invalidated } = await tokenVault.snapshot();
    if (invalidated) unauthorizedListener?.();
    lifecycle.assertCurrent();
    config.signal = lifecycle.signal;
    requestSessions.set(config, { generation, authenticated: Boolean(session), lifecycle });
    const headers = AxiosHeaders.from(config.headers);
    headers.set(INSTALLATION_EVENT_IDENTIFIER_HEADER, eventIdentifier);
    if (device) headers.set(DEVICE_IDENTIFIER_HEADER, device);
    if (!headers.has(VORINTHEX_APP_KEY_HEADER)) {
      for (const [name, value] of Object.entries(selectedAppHeaders)) headers.set(name, value);
    }
    if (BACKEND_API_KEY) headers.set("X-Vorinthex-API-Key", BACKEND_API_KEY);
    if (session) {
      if (session.accessExpiresAt > Date.now()) headers.set("Authorization", `Bearer ${session.accessToken}`);
      headers.set("X-Refresh-Token", session.refreshToken);
    }
    config.headers = headers;
    return config;
  } catch (error) { lifecycle.cleanup(); throw error; }
});

apiClient.interceptors.response.use(async (response) => {
  const tokens = extractSessionTokens(response.data, (name) => response.headers[name]);
  const requestSession = requestSessions.get(response.config);
  requestSession?.lifecycle.cleanup();
  requestSession?.lifecycle.assertCurrent();
  if (tokens && requestSession) await tokenVault.writeIfCurrent(tokens, requestSession.generation);
  requestSession?.lifecycle.assertCurrent();
  return response;
}, async (error: unknown) => {
  const owner = isAxiosError(error) && error.config ? requestSessions.get(error.config) : undefined;
  owner?.lifecycle.cleanup();
  if (owner && owner.lifecycle.owner !== sessionEpoch()) throw new CanceledError("canceled");
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
  if (owner && owner.lifecycle.owner !== sessionEpoch()) throw new CanceledError("canceled");
  return rejectObservedDomainError(error);
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

export async function postJson<TBody, TResponse>(path: string, body: TBody, options: { appKey?: string } = {}): Promise<TResponse> {
  return (await apiClient.post<TResponse>(path, body, options.appKey ? { headers: appKeyHeaders(options.appKey) } : undefined)).data;
}

export async function deleteRemoteAccount(session: { accessToken: string; refreshToken: string }) {
  const [eventIdentifier, device] = await Promise.all([getInstallationEventIdentifier(), getDeviceIdentifier()]);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${API_BASE_URL.replace(/\/$/, "")}/api/v1/auth/me/delete`, {
      method: "POST", signal: controller.signal, headers: {
        "Content-Type": "application/json", "X-Vorinthex-Session-Transport": "header",
        ...selectedAppKeyHeaders(), [INSTALLATION_EVENT_IDENTIFIER_HEADER]: eventIdentifier,
        ...(device ? { [DEVICE_IDENTIFIER_HEADER]: device } : {}),
        ...(BACKEND_API_KEY ? { "X-Vorinthex-API-Key": BACKEND_API_KEY } : {}),
        Authorization: `Bearer ${session.accessToken}`, "X-Refresh-Token": session.refreshToken,
      }, body: JSON.stringify({ confirmation: "DELETE MY ACCOUNT" }),
    });
    if (!response.ok) throw new Error("Account deletion could not be confirmed. Please try again.");
  } finally { clearTimeout(timeout); }
}

export async function patchJson<TBody, TResponse>(path: string, body: TBody): Promise<TResponse> {
  return (await apiClient.patch<TResponse>(path, body)).data;
}

async function authenticatedEventStream(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  onEvent: (event: ServerSentEvent) => void,
  signal?: AbortSignal,
  onOpen?: () => void,
) {
  const lifecycle = captureSessionRequest(signal);
  signal = lifecycle.signal;
  try {
  if (sessionIsEnding()) throw new CanceledError("canceled");
  await ensureAppsReady();
  const selectedAppHeaders = selectedAppKeyHeaders();
  const [eventIdentifier, device] = await Promise.all([getInstallationEventIdentifier(), getDeviceIdentifier()]);
  const { session, generation, invalidated } = await tokenVault.snapshot();
  if (invalidated) unauthorizedListener?.();
  lifecycle.assertCurrent();
  const headers: Record<string, string> = {
    "Accept": "text/event-stream",
    "Cache-Control": "no-cache",
    "Content-Type": "application/json",
    "X-Vorinthex-Session-Transport": "header",
    [INSTALLATION_EVENT_IDENTIFIER_HEADER]: eventIdentifier,
    ...(device ? { [DEVICE_IDENTIFIER_HEADER]: device } : {}),
    ...selectedAppHeaders,
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
    let headersHandled = false;
    const abort = () => request.abort();
    const processAvailable = () => {
      if (lifecycle.owner !== sessionEpoch()) return;
      if (processingError) return;
      if (request.readyState >= 2 && (request.status < 200 || request.status >= 300)) return;
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
    const processHeaders = () => {
      if (lifecycle.owner !== sessionEpoch()) return;
      if (headersHandled || request.readyState < 2) return;
      headersHandled = true;
      const tokens = extractSessionTokens(undefined, (name) => request.getResponseHeader(name));
      if (tokens) void tokenVault.writeIfCurrent(tokens, generation);
      if (request.status >= 200 && request.status < 300) onOpen?.();
    };
    request.open(method, `${API_BASE_URL.replace(/\/$/, "")}/api/v1${normalizeApiPath(path)}`, true);
    request.withCredentials = true;
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.onreadystatechange = processHeaders;
    request.onprogress = processAvailable;
    request.onerror = () => { cleanup(); reject(processingError ?? new Error("Streaming request failed.")); };
    request.onabort = () => { cleanup(); reject(processingError ?? new DOMException("Aborted", "AbortError")); };
    request.onload = () => { void (async () => {
      lifecycle.assertCurrent();
      if (request.status >= 200 && request.status < 300) processAvailable();
      if (processingError) throw processingError;
      const event = parseServerSentEvent(buffer);
      if (event) onEvent(event);
      const tokens = extractSessionTokens(undefined, (name) => request.getResponseHeader(name));
      if (tokens) await tokenVault.writeIfCurrent(tokens, generation);
      if (request.status < 200 || request.status >= 300) {
        if (isAuthenticatedBearerRejection(request.status, request.getResponseHeader("www-authenticate"), Boolean(session))
          && await tokenVault.clearIfCurrent(generation)) unauthorizedListener?.();
        throw createObservedHttpError(request.status, request.responseText);
      }
      cleanup();
      resolve();
    })().catch((error) => { cleanup(); reject(error); }); };
    signal?.addEventListener("abort", abort, { once: true });
    request.send(method === "POST" ? JSON.stringify(body) : null);
  });
  } finally { lifecycle.cleanup(); }
}

export function getEventStream(path: string, onEvent: (event: ServerSentEvent) => void, signal?: AbortSignal, onOpen?: () => void) {
  return authenticatedEventStream("GET", path, undefined, onEvent, signal, onOpen);
}

export function postEventStream(path: string, body: unknown, onEvent: (event: ServerSentEvent) => void, signal?: AbortSignal) {
  return authenticatedEventStream("POST", path, body, onEvent, signal);
}

export async function revokeRemoteSession(session: { accessToken: string; refreshToken: string }) {
  await apiClient.post("/auth/logout", {}, { headers: {
    Authorization: `Bearer ${session.accessToken}`,
    "X-Refresh-Token": session.refreshToken,
  } });
}

export async function cleanupRemoteSession(session: { accessToken: string; refreshToken: string }) {
  const selectedAppHeaders = selectedAppKeyHeaders();
  const [eventIdentifier, device] = await Promise.all([getInstallationEventIdentifier(), getDeviceIdentifier()]);
  const headers = {
    "Content-Type": "application/json",
    "X-Vorinthex-Session-Transport": "header",
    [INSTALLATION_EVENT_IDENTIFIER_HEADER]: eventIdentifier,
    ...(device ? { [DEVICE_IDENTIFIER_HEADER]: device } : {}),
    ...selectedAppHeaders,
    ...(BACKEND_API_KEY ? { "X-Vorinthex-API-Key": BACKEND_API_KEY } : {}),
    Authorization: `Bearer ${session.accessToken}`,
    "X-Refresh-Token": session.refreshToken,
  };
  const request = async (path: string, init: RequestInit) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_000);
    try {
      const response = await fetch(`${API_BASE_URL.replace(/\/$/, "")}/api/v1${path}`, { ...init, headers, signal: controller.signal });
      if (!response.ok) throw new Error(`Session cleanup failed with HTTP ${response.status}.`);
    } finally {
      clearTimeout(timeout);
    }
  };
  const cleanup = await Promise.allSettled([
    request("/auth/me/push-subscription", { method: "DELETE", body: "{}" }),
    request("/auth/logout", { method: "POST", body: "{}" }),
  ]);
  const failure = cleanup.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) throw failure.reason;
}
