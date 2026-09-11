import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { transitionAppOpenEvent, type AppOpenEventState } from "./app-open-event-state";

function transition(state: AppOpenEventState, nextState: "active" | "background" | "inactive" | "unknown" | "extension") {
  return transitionAppOpenEvent(state, nextState);
}

describe("app open event lifecycle", () => {
  test("records the first active state exactly once", () => {
    const initial = { opened: false, backgrounded: false };
    const opened = transition(initial, "active");
    expect(opened.record).toBe(true);
    expect(transition(opened.state, "active").record).toBe(false);
  });

  test("waits for active when initially inactive", () => {
    const inactive = transition({ opened: false, backgrounded: false }, "inactive");
    expect(inactive.record).toBe(false);
    expect(transition(inactive.state, "active").record).toBe(true);
  });

  test("ignores transient inactive states after opening", () => {
    const opened = transition({ opened: false, backgrounded: false }, "active");
    const inactive = transition(opened.state, "inactive");
    expect(transition(inactive.state, "active").record).toBe(false);
  });

  test("records once after every background-to-active cycle", () => {
    const opened = transition({ opened: false, backgrounded: false }, "active");
    const backgrounded = transition(opened.state, "background");
    const inactive = transition(backgrounded.state, "inactive");
    const reopened = transition(inactive.state, "active");
    expect(reopened.record).toBe(true);
    expect(transition(reopened.state, "active").record).toBe(false);
  });

  test("mounts the analytics bridge globally and records app.opened", () => {
    const bridge = readFileSync(new URL("./app-open-events.tsx", import.meta.url), "utf8");
    const provider = readFileSync(new URL("./query-client.tsx", import.meta.url), "utf8");
    expect(bridge).toContain('recordAnalyticsEvent("app.opened")');
    expect(bridge).toContain("useLayoutEffect(() => {");
    expect(bridge).toContain("handleState(AppState.currentState)");
    expect(bridge).toContain('AppState.addEventListener("change", handleState)');
    expect(provider).toContain("<AppOpenEventBridge />");
    expect(bridge).toContain('requestAgentGreeting("returning")');
    expect(bridge).toContain("if (firstOpen && auth.status");
    expect(bridge).toContain('auth.user?.isOnboarded === true');
  });
});
