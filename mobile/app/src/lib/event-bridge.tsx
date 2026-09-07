import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { getEventStream } from "./api-client";
import { publishAppEvent } from "./app-events";
import { appSearchQueryRoot } from "./app-search-client";
import { publishBookChanged } from "./book-events";
import { createCoalescedRefresh } from "./async-refresh";
import { billingSummaryQueryKey } from "./billing-client";
import { compassQueryKeys } from "./compass-query-keys";
import { conversationQueryKeys } from "./conversation-cache";
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
  const teamKey = useAuthStore((state) => typeof state.team?.key === "string" ? state.team.key : "");
  const scopeKey = useAuthStore((state) => typeof state.scope?.key === "string" ? state.scope.key : "");
  const previousIdentity = useRef<{ teamKey: string; scopeKey: string; userKey: string } | null | undefined>(undefined);
  const streamGeneration = useRef(0);

  useEffect(() => {
    const identity = status === "authenticated" && userKey ? { userKey, teamKey, scopeKey } : null;
    const previous = previousIdentity.current;
    const changed = previous !== undefined && (previous?.userKey !== identity?.userKey || previous?.teamKey !== identity?.teamKey || previous?.scopeKey !== identity?.scopeKey);
    if (changed && previous && identity && previous.userKey === identity.userKey && previous.teamKey === identity.teamKey) {
      void queryClient.cancelQueries({ predicate: ({ queryKey }) => queryKey[0] !== "scope-list" });
      queryClient.removeQueries({ predicate: ({ queryKey }) => queryKey[0] !== "scope-list" });
    } else if (changed) queryClient.clear();
    previousIdentity.current = identity;
  }, [teamKey, queryClient, scopeKey, status, userKey]);

  useEffect(() => subscribeUserSearchHistoryAppends((appendedUserKey) => {
    if (appendedUserKey === userKey) void queryClient.invalidateQueries({ queryKey: userSearchHistoryQueryKey(userKey), exact: true, refetchType: "none" });
  }), [queryClient, userKey]);

  useEffect(() => {
    if (status !== "authenticated" || !userKey || !teamKey || !scopeKey) return;
    const generation = ++streamGeneration.current;
    const isCurrent = () => isCurrentContextGeneration(generation, streamGeneration.current);
    let active = AppState.currentState === "active";
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const root = ["gallery", teamKey, scopeKey] as const;
    const compassContext = { teamKey, scopeKey };
    const contentContext = { userKey, teamKey, scopeKey };
    const conversationContext = { userKey, teamKey, scopeKey };
    const invalidateBilling = () => void queryClient.invalidateQueries({ queryKey: billingSummaryQueryKey(userKey), exact: true, refetchType: "active" });
    const invalidateCompassTrips = () => void queryClient.invalidateQueries({ queryKey: compassQueryKeys.trips(compassContext) });
    const invalidateAppSearch = () => void queryClient.invalidateQueries({ queryKey: appSearchQueryRoot, refetchType: "active" });
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
    const invalidateGallery = (families: ReadonlySet<GalleryRefreshFamily>) => {
      if (families.has("root") || families.has("current")) void queryClient.invalidateQueries({ queryKey: [...root, "overviews"], refetchType: "none" });
      if (families.has("root")) void queryClient.invalidateQueries({ queryKey: [...root, "collections"], refetchType: "none" });
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
        invalidateAppSearch();
        invalidateUserHiddens();
        if (event.event === "referral.reward.created") invalidateBilling();
        if (event.event === "trip.changed") invalidateCompassTrips();
        if (event.event === "place.reference.changed") invalidateCompassPlaceReferences();
        if (event.event === "inbox.changed") {
          invalidateSignal();
          invalidateArchive();
          publishAppEvent({ type: "inbox.changed" });
        }
        if (event.event === "conversation.changed") {
          void queryClient.invalidateQueries({ queryKey: conversationQueryKeys.all(conversationContext), refetchType: "active" });
          publishAppEvent({ type: "conversation.changed" });
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
        invalidateAppSearch();
        invalidateUserHiddens();
        invalidateArchive();
        invalidateGallery(galleryRefreshPlan("reconnect"));
        invalidateCompassTrips();
        invalidateCompassPlaceReferences();
        invalidateSignal();
        invalidateBooks();
        invalidateBilling();
        void queryClient.invalidateQueries({ queryKey: conversationQueryKeys.all(conversationContext), refetchType: "active" });
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
        invalidateAppSearch();
        invalidateGallery(galleryRefreshPlan("reconnect"));
        invalidateArchive();
        invalidateCompassTrips();
        invalidateCompassPlaceReferences();
        invalidateSignal();
        invalidateBooks();
        invalidateBilling();
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
  }, [teamKey, queryClient, scopeKey, status, userKey]);

  return null;
}
