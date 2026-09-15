import { useLayoutEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { transitionAppOpenEvent, type AppOpenEventState } from "./app-open-event-state";
import { recordAnalyticsEvent } from "./onboarding-events";
import { useAuthStore } from "@/state/auth";
import { useUiStore } from "@/state/ui";

let coldSessionGreetingRequested = false;

export function AppOpenEventBridge() {
  useLayoutEffect(() => {
    let state: AppOpenEventState = { opened: false, backgrounded: false };
    const handleState = (nextState: AppStateStatus) => {
      const transition = transitionAppOpenEvent(state, nextState);
      state = transition.state;
      if (transition.record) {
        void recordAnalyticsEvent("app.opened").catch(() => undefined);
      }
    };

    const requestAuthenticatedGreeting = () => {
      const auth = useAuthStore.getState();
      if (coldSessionGreetingRequested || auth.status !== "authenticated" || auth.user?.isOnboarded !== true) return;
      coldSessionGreetingRequested = true;
      useUiStore.getState().requestAgentGreeting("returning", "restore-or-greet");
    };

    handleState(AppState.currentState);
    requestAuthenticatedGreeting();
    const subscription = AppState.addEventListener("change", handleState);
    const unsubscribeAuth = useAuthStore.subscribe((current, previous) => {
      if (previous.status !== "authenticated" && current.status === "authenticated") requestAuthenticatedGreeting();
    });
    return () => { subscription.remove(); unsubscribeAuth(); };
  }, []);

  return null;
}
