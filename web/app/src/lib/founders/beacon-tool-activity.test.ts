import { describe, expect, test } from "bun:test";
import { mergeBeaconToolActivity, parseBeaconToolActivity } from "./use-beacon-stream";

const startedJson = JSON.stringify({
  invocationId: "tool-1",
  phase: "started",
  agent: { slug: "genesis", name: "Genesis" },
  tool: { slug: "agent.create", name: "Create agent" },
  action: { slug: "agent.create", name: "Create agent" },
});

describe("Beacon tool activity state", () => {
  test("parses only valid tool SSE events and trusts the event phase", () => {
    expect(parseBeaconToolActivity("tool.started", startedJson)).toMatchObject({ invocationId: "tool-1", phase: "started" });
    expect(parseBeaconToolActivity("response.delta", startedJson)).toBeNull();
    expect(parseBeaconToolActivity("tool.completed", "{}")).toBeNull();
  });

  test("updates a completed invocation in place and preserves ordering", () => {
    const started = parseBeaconToolActivity("tool.started", startedJson)!;
    const second = { ...started, invocationId: "tool-2" };
    const completed = { ...started, phase: "completed" as const, elapsedMs: 25 };
    const merged = mergeBeaconToolActivity([started, second], completed);
    expect(merged).toEqual([completed, second]);
  });
});
