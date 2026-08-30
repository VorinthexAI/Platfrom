import { expect, test } from "bun:test";
import { createCoalescedRefresh } from "./async-refresh";

test("coalesces notifications during a refresh into one trailing refresh", async () => {
  let calls = 0;
  let releaseFirst!: () => void;
  const firstRefresh = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const trigger = createCoalescedRefresh(async () => {
    calls += 1;
    if (calls === 1) await firstRefresh;
  });

  const running = trigger();
  trigger();
  trigger();
  expect(calls).toBe(1);

  releaseFirst();
  await running;
  expect(calls).toBe(2);
});

test("stops trailing refreshes when the subscriber is inactive", async () => {
  let active = true;
  let calls = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const trigger = createCoalescedRefresh(async () => {
    calls += 1;
    await blocked;
  }, () => active);

  const running = trigger();
  trigger();
  active = false;
  release();
  await running;
  expect(calls).toBe(1);
});
