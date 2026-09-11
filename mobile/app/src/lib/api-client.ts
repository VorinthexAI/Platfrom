import { AxiosHeaders, create, isAxiosError, type AxiosInstance } from "axios";

import { extractSessionTokens, normalizeApiPath } from "./auth-helpers";
import { tokenVault } from "./token-vault";
import { consumeServerSentEvents, isAuthenticatedBearerRejection, parseServerSentEvent, type ServerSentEvent } from "./sse";
import { selectedAppKeyHeaders } from "./app-request-headers";
import { createObservedHttpError, rejectObservedDomainError } from "./domain-error-observer";
import { getInstallationEventIdentifier, INSTALLATION_EVENT_IDENTIFIER_HEADER } from "./installation-event-identifier-vault";
import { getDeviceIdentifier, DEVICE_IDENTIFIER_HEADER } from "./device-identifier-vault";
import { ensureAppsReady } from "@/state/apps";

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
  await ensureAppsReady();
  const [eventIdentifier, device] = await Promise.all([getInstallationEventIdentifier(), getDeviceIdentifier()]);
  config.url = normalizeApiPath(config.url ?? "/");
  const { session, generation, invalidated } = await tokenVault.snapshot();
  if (invalidated) unauthorizedListener?.();
  requestSessions.set(config, { generation, authenticated: Boolean(session) });
  const headers = AxiosHeaders.from(config.headers);
  headers.set(INSTALLATION_EVENT_IDENTIFIER_HEADER, eventIdentifier);
  if (device) headers.set(DEVICE_IDENTIFIER_HEADER, device);
  for (const [name, value] of Object.entries(selectedAppKeyHeaders())) headers.set(name, value);
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

export async function postJson<TBody, TResponse>(path: string, body: TBody): Promise<TResponse> {
  return (await apiClient.post<TResponse>(path, body)).data;
}

export async function deleteRemoteAccount(session: { accessToken: string; refreshToken: string }) {
  await apiClient.post("/auth/me/delete", { confirmation: "DELETE MY ACCOUNT" }, { headers: {
    Authorization: `Bearer ${session.accessToken}`,
    "X-Refresh-Token": session.refreshToken,
  } });
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
  await ensureAppsReady();
  const [eventIdentifier, device] = await Promise.all([getInstallationEventIdentifier(), getDeviceIdentifier()]);
  const { session, generation, invalidated } = await tokenVault.snapshot();
  if (invalidated) unauthorizedListener?.();
  const headers: Record<string, string> = {
    "Accept": "text/event-stream",
    "Cache-Control": "no-cache",
    "Content-Type": "application/json",
    "X-Vorinthex-Session-Transport": "header",
    [INSTALLATION_EVENT_IDENTIFIER_HEADER]: eventIdentifier,
    ...(device ? { [DEVICE_IDENTIFIER_HEADER]: device } : {}),
    ...selectedAppKeyHeaders(),
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
  const [eventIdentifier, device] = await Promise.all([getInstallationEventIdentifier(), getDeviceIdentifier()]);
  const headers = {
    "Content-Type": "application/json",
    "X-Vorinthex-Session-Transport": "header",
    [INSTALLATION_EVENT_IDENTIFIER_HEADER]: eventIdentifier,
    ...(device ? { [DEVICE_IDENTIFIER_HEADER]: device } : {}),
    ...selectedAppKeyHeaders(),
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
  let failure: unknown;
  try {
    await request("/auth/me/push-subscription", { method: "DELETE", body: "{}" });
  } catch (error) {
    failure = error;
  }
  try {
    await request("/auth/logout", { method: "POST", body: "{}" });
  } catch (error) {
    failure ??= error;
  }
  if (failure) throw failure;
}
