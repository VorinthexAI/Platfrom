"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSseParser } from "./sse";
import type { BeaconStatus } from "./types";

export interface BeaconUiState {
  response: string;
  status: BeaconStatus;
  error: string | null;
}

const IDLE_STATE: BeaconUiState = { response: "", status: "idle", error: null };

/**
 * Streams one ephemeral Beacon ask. Nothing is persisted client-side: the
 * response lives in local state and disappears on refresh. Only one request
 * can be active per hook instance; submitting again while streaming is a
 * no-op until cancelled.
 */
export function useBeaconStream() {
  const [state, setState] = useState<BeaconUiState>(IDLE_STATE);
  const controllerRef = useRef<AbortController | null>(null);
  const activeRef = useRef(false);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const cancel = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState((current) => ({ ...current, status: "cancelled", error: null }));
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    activeRef.current = false;
    setState(IDLE_STATE);
  }, []);

  const ask = useCallback(async (input: { organizationKey: string; scopeKey: string; message: string }) => {
    if (activeRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    activeRef.current = true;
    setState({ response: "", status: "connecting", error: null });
    try {
      const response = await fetch("/api/founders/beacon/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(input),
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        const message =
          (payload && typeof payload.error === "string" && payload.error) ||
          (response.status === 401 || response.status === 403
            ? "You are not authorized to ask Beacon here."
            : response.status === 429
              ? "Too many requests — give Beacon a moment."
              : "Beacon could not be reached.");
        setState({ response: "", status: "failed", error: message });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = createSseParser();
      let failed: string | null = null;
      let completed = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const event of parser.push(decoder.decode(value, { stream: true }))) {
          if (event.event === "response.started") {
            setState((current) => ({ ...current, status: "streaming" }));
          } else if (event.event === "response.delta") {
            let text = "";
            try {
              const data = JSON.parse(event.data) as { text?: unknown };
              text = typeof data.text === "string" ? data.text : "";
            } catch {
              text = "";
            }
            if (text) {
              setState((current) => ({
                response: current.response + text,
                status: "streaming",
                error: null,
              }));
            }
          } else if (event.event === "response.completed") {
            completed = true;
          } else if (event.event === "response.failed") {
            try {
              const data = JSON.parse(event.data) as { error?: unknown };
              failed = typeof data.error === "string" ? data.error : "Beacon could not complete the response.";
            } catch {
              failed = "Beacon could not complete the response.";
            }
          }
        }
      }

      if (!activeRef.current) return;
      if (failed) {
        setState((current) => ({ ...current, status: "failed", error: failed }));
      } else if (completed) {
        setState((current) => ({ ...current, status: "completed", error: null }));
      } else {
        setState((current) => ({ ...current, status: "failed", error: "The stream ended unexpectedly." }));
      }
    } catch (error) {
      if (controller.signal.aborted) return; // cancel() already set the state
      const message = error instanceof Error && error.name === "TimeoutError"
        ? "Beacon timed out."
        : "Beacon could not be reached.";
      setState((current) => ({ ...current, status: "failed", error: message }));
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
      activeRef.current = false;
    }
  }, []);

  return { ...state, ask, cancel, reset };
}
