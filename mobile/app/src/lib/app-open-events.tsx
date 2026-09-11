import { useLayoutEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { transitionAppOpenEvent, type AppOpenEventState } from "./app-open-event-state";
import { recordAnalyticsEvent } from "./onboarding-events";
import { useAuthStore } from "@/state/auth";
import { useUiStore } from "@/state/ui";

export function AppOpenEventBridge() {
  useLayoutEffect(() => {
    let state: AppOpenEventState = { opened: false, backgrounded: false };
    const handleState = (nextState: AppStateStatus) => {
      const firstOpen = !state.opened;
      const transition = transitionAppOpenEvent(state, nextState);
      state = transition.state;
      if (transition.record) {
        void recordAnalyticsEvent("app.opened").catch(() => undefined);
        const auth = useAuthStore.getState();
        if (firstOpen && auth.status === "authenticated" && auth.user?.isOnboarded === true) useUiStore.getState().requestAgentGreeting("returning");
      }
    };

    handleState(AppState.currentState);
    const subscription = AppState.addEventListener("change", handleState);
    return () => subscription.remove();
  }, []);

  return null;
}
