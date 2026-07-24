import { describe, expect, test } from "bun:test";
import { createPlaybackGeneration } from "./playback-generation";

describe("createPlaybackGeneration", () => {
  test("only the latest overlapping playback request remains current", () => {
    const guard = createPlaybackGeneration();
    const first = guard.begin();
    const second = guard.begin();

    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  test("explicit invalidation makes pending playback stale", () => {
    const guard = createPlaybackGeneration();
    const pending = guard.begin();

    guard.invalidate();

    expect(guard.isCurrent(pending)).toBe(false);
  });
});
