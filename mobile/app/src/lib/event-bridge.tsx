import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { getEventStream } from "./api-client";
import { publishAppEvent } from "./app-events";
import { eventStreamRetryDelay, invalidatesGalleryQueries } from "./sse";
import { useAuthStore } from "@/state/auth";

export function AuthenticatedEventBridge() {
  const queryClient = useQueryClient();
  const status = useAuthStore((state) => state.status);
  const userKey = useAuthStore((state) => state.user?.key);
  const previousIdentity = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const identity = status === "authenticated" ? userKey ?? null : null;
    if (previousIdentity.current !== undefined && previousIdentity.current !== identity) queryClient.clear();
    previousIdentity.current = identity;
  }, [queryClient, status, userKey]);

  useEffect(() => {
    if (status !== "authenticated" || !userKey) return;
    let active = AppState.currentState === "active";
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const invalidateGallery = () => {
      void queryClient.invalidateQueries({ queryKey: ["gallery"] });
    };
    const connect = () => {
      if (!active || controller) return;
      controller = new AbortController();
      const currentController = controller;
      void getEventStream("/events/stream", (event) => {
        if (invalidatesGalleryQueries(event.event)) {
          invalidateGallery();
          publishAppEvent({ type: "collection.changed", data: event.data });
        }
      }, currentController.signal, () => {
        attempt = 0;
        invalidateGallery();
        publishAppEvent({ type: "event-stream.connected" });
      }).catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
      }).finally(() => {
        if (controller !== currentController) return;
        controller = undefined;
        if (!active) return;
        retryTimer = setTimeout(connect, eventStreamRetryDelay(attempt++));
      });
    };
    const subscription = AppState.addEventListener("change", (nextState) => {
      const wasActive = active;
      active = nextState === "active";
      if (!active) {
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = undefined;
        const currentController = controller;
        controller = undefined;
        currentController?.abort();
        return;
      }
      if (!wasActive) {
        attempt = 0;
        invalidateGallery();
        connect();
      }
    });

    connect();
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
      const currentController = controller;
      controller = undefined;
      currentController?.abort();
      subscription.remove();
    };
  }, [queryClient, status, userKey]);

  return null;
}
