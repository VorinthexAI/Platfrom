import { describe, expect, test } from "bun:test";
import { createFrameBatcher } from "./frame-batcher";

describe("createFrameBatcher", () => {
  test("coalesces queued values into one update per animation frame", () => {
    const frames: FrameRequestCallback[] = [];
    const applied: number[][] = [];
    const batcher = createFrameBatcher<number>((values) => applied.push(values), (callback) => {
      frames.push(callback);
      return frames.length;
    }, () => {});

    batcher.push(1);
    batcher.push(2);
    batcher.push(3);
    expect(frames).toHaveLength(1);
    expect(applied).toEqual([]);

    frames[0]!(0);
    expect(applied).toEqual([[1, 2, 3]]);
  });

  test("flushes terminal data synchronously and cancels stale work", () => {
    const frames: FrameRequestCallback[] = [];
    const cancelled: number[] = [];
    const applied: string[][] = [];
    const batcher = createFrameBatcher<string>((values) => applied.push(values), (callback) => {
      frames.push(callback);
      return frames.length;
    }, (handle) => cancelled.push(handle));

    batcher.push("token");
    batcher.push("done");
    batcher.flush();
    expect(cancelled).toEqual([1]);
    expect(applied).toEqual([["token", "done"]]);

    batcher.push("discarded");
    batcher.cancel();
    expect(cancelled).toEqual([1, 2]);
    expect(applied).toHaveLength(1);
  });
});
