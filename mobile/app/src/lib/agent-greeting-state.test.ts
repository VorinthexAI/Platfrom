import { beforeEach, expect, test } from "bun:test";
import { useUiStore } from "@/state/ui";

beforeEach(() => useUiStore.setState({ agentGreetingRequest: undefined, agentGreetingSequence: 0 }));

test("claims each greeting request exactly once", () => {
  useUiStore.getState().requestAgentGreeting("returning");
  const request = useUiStore.getState().agentGreetingRequest;
  expect(request).toEqual({ id: 1, occasion: "returning" });
  expect(useUiStore.getState().consumeAgentGreeting(request!.id)).toEqual(request);
  expect(useUiStore.getState().consumeAgentGreeting(request!.id)).toBeUndefined();
});

test("keeps greeting request identifiers monotonic after consumption", () => {
  useUiStore.getState().requestAgentGreeting("returning");
  useUiStore.getState().consumeAgentGreeting(1);
  useUiStore.getState().requestAgentGreeting("onboarding");
  expect(useUiStore.getState().agentGreetingRequest).toEqual({ id: 2, occasion: "onboarding" });
});
