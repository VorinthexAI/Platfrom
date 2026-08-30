import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { getEventStream } from "./api-client";
import { publishAppEvent } from "./app-events";
import { publishBookChanged } from "./book-events";
import { createCoalescedRefresh } from "./async-refresh";
import { compassQueryKeys } from "./compass-query-keys";
import { contentQueryKeys } from "./content-query-cache";
import { galleryRefreshPlan, isCurrentContextGeneration, type GalleryRefreshFamily } from "./gallery-convergence";
import { eventStreamRetryDelay, invalidatesGalleryQueries } from "./sse";
import { ascendQueryKeys, signalQueryKeys } from "./workspace-query-cache";
import { subscribeUserSearchHistoryAppends, userSearchHistoryQueryKey } from "./user-search-history-events";
import { useAuthStore } from "@/state/auth";

export function AuthenticatedEventBridge() {
  const queryClient = useQueryClient();
  const status = useAuthStore((state) => state.status);
  const userKey = useAuthStore((state) => state.user?.key);
  const organizationKey = useAuthStore((state) => typeof state.organization?.key === "string" ? state.organization.key : "");
  const scopeKey = useAuthStore((state) => typeof state.scope?.key === "string" ? state.scope.key : "");
  const previousIdentity = useRef<string | null | undefined>(undefined);
  const streamGeneration = useRef(0);

  useEffect(() => {
    const identity = status === "authenticated" && userKey ? `${userKey}:${organizationKey}:${scopeKey}` : null;
    if (previousIdentity.current !== undefined && previousIdentity.current !== identity) queryClient.clear();
    previousIdentity.current = identity;
  }, [organizationKey, queryClient, scopeKey, status, userKey]);

  useEffect(() => subscribeUserSearchHistoryAppends((appendedUserKey) => {
    if (appendedUserKey === userKey) void queryClient.invalidateQueries({ queryKey: userSearchHistoryQueryKey(userKey), exact: true, refetchType: "none" });
  }), [queryClient, userKey]);

  useEffect(() => {
    if (status !== "authenticated" || !userKey || !organizationKey || !scopeKey) return;
    const generation = ++streamGeneration.current;
    const isCurrent = () => isCurrentContextGeneration(generation, streamGeneration.current);
    let active = AppState.currentState === "active";
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const root = ["gallery", organizationKey, scopeKey] as const;
    const compassContext = { organizationKey, scopeKey };
    const contentContext = { userKey, organizationKey, scopeKey };
    const invalidateCompassTrips = () => void queryClient.invalidateQueries({ queryKey: compassQueryKeys.trips(compassContext) });
    const invalidateCompassPlaceReferences = () => void queryClient.invalidateQueries({ queryKey: compassQueryKeys.places(compassContext) });
    const invalidateArchive = () => void queryClient.invalidateQueries({ queryKey: contentQueryKeys.all(contentContext), refetchType: "active" });
    const invalidateSignal = () => {
      void queryClient.invalidateQueries({ queryKey: signalQueryKeys.overviews(compassContext), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: signalQueryKeys.details(compassContext), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: signalQueryKeys.replyContexts(compassContext), refetchType: "active" });
    };
    const invalidateBooks = createCoalescedRefresh(
      () => queryClient.invalidateQueries({ queryKey: ascendQueryKeys.all(compassContext), refetchType: "active" }),
      isCurrent,
    );
    const inCurrentGallery = (queryKey: readonly unknown[]) => root.every((value, index) => queryKey[index] === value);
    const invalidateSharingSuffix = (suffixes: readonly string[]) => {
      void queryClient.invalidateQueries({ predicate: ({ queryKey }) => inCurrentGallery(queryKey) && queryKey[3] === "sharing" && suffixes.includes(String(queryKey.at(-1))), refetchType: "none" });
    };
    const invalidateGallery = (families: ReadonlySet<GalleryRefreshFamily>) => {
      if (families.has("root") || families.has("current") || families.has("access")) void queryClient.invalidateQueries({ queryKey: [...root, "overviews"], refetchType: "none" });
      if (families.has("root") || families.has("access")) void queryClient.invalidateQueries({ queryKey: [...root, "collections"], refetchType: "none" });
      if (families.has("members")) invalidateSharingSuffix(["members"]);
      if (families.has("collectionInvites") || families.has("incomingInvites")) invalidateSharingSuffix(["invites", "incoming-invites"]);
      if (families.has("shares")) invalidateSharingSuffix(["share-links"]);
      if (families.has("subjects")) void queryClient.invalidateQueries({ queryKey: [...root, "subjects"], refetchType: "none" });
      if (families.has("search")) void queryClient.invalidateQueries({ queryKey: [...root, "search"], refetchType: "none" });
      if (families.has("duplicates")) void queryClient.invalidateQueries({ queryKey: [...root, "duplicates"], refetchType: "none" });
      if (families.has("upload")) void queryClient.invalidateQueries({ queryKey: [...root, "uploads"], refetchType: "none" });
      if (families.has("highlights")) void queryClient.invalidateQueries({ queryKey: [...root, "highlights"], refetchType: "none" });
      if (families.has("memories")) void queryClient.invalidateQueries({ queryKey: [...root, "memories"], refetchType: "none" });
    };
    const invalidateUserHiddens = () => {
      void queryClient.invalidateQueries({ predicate: ({ queryKey }) => queryKey.at(-1) === "user-hiddens" && (queryKey[0] === "gallery" || queryKey[0] === "archive"), refetchType: "active" });
    };
    const connect = () => {
      if (!active || controller) return;
      controller = new AbortController();
      const currentController = controller;
      void getEventStream("/events/stream", (event) => {
        if (!isCurrent()) return;
        invalidateUserHiddens();
        if (event.event === "trip.changed") invalidateCompassTrips();
        if (event.event === "place.reference.changed") invalidateCompassPlaceReferences();
        if (event.event === "inbox.changed") {
          invalidateSignal();
          invalidateArchive();
          publishAppEvent({ type: "inbox.changed" });
        }
        if (event.event === "book.changed") {
          invalidateBooks();
          publishBookChanged();
        }
        if (event.event === "content.changed") {
          invalidateArchive();
          void queryClient.invalidateQueries({ queryKey: signalQueryKeys.overview(compassContext), refetchType: "active" });
          void queryClient.invalidateQueries({ queryKey: signalQueryKeys.replyContexts(compassContext), refetchType: "active" });
          invalidateCompassTrips();
          invalidateCompassPlaceReferences();
        }
        if (invalidatesGalleryQueries(event.event)) {
          const slug = event.event;
          invalidateGallery(galleryRefreshPlan(slug));
          publishAppEvent({ type: "gallery.changed", slug });
          invalidateCompassTrips();
        }
      }, currentController.signal, () => {
        if (!isCurrent()) return;
        attempt = 0;
        invalidateUserHiddens();
        invalidateArchive();
        invalidateGallery(galleryRefreshPlan("reconnect"));
        invalidateCompassTrips();
        invalidateCompassPlaceReferences();
        invalidateSignal();
        invalidateBooks();
        publishAppEvent({ type: "event-stream.connected" });
      }).catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
      }).finally(() => {
        if (!isCurrent() || controller !== currentController) return;
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
        invalidateGallery(galleryRefreshPlan("reconnect"));
        invalidateArchive();
        invalidateCompassTrips();
        invalidateCompassPlaceReferences();
        invalidateSignal();
        invalidateBooks();
        connect();
      }
    });

    connect();
    return () => {
      if (isCurrent()) streamGeneration.current += 1;
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
      const currentController = controller;
      controller = undefined;
      currentController?.abort();
      subscription.remove();
    };
  }, [organizationKey, queryClient, scopeKey, status, userKey]);

  return null;
}
