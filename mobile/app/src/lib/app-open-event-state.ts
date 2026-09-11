export type AppLifecycleState = "active" | "background" | "inactive" | "unknown" | "extension";

export type AppOpenEventState = {
  opened: boolean;
  backgrounded: boolean;
};

export function transitionAppOpenEvent(state: AppOpenEventState, nextState: AppLifecycleState) {
  if (nextState === "background") {
    return { state: { ...state, backgrounded: true }, record: false };
  }
  if (nextState === "active" && (!state.opened || state.backgrounded)) {
    return { state: { opened: true, backgrounded: false }, record: true };
  }
  return { state, record: false };
}
