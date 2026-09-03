import { expect, test } from "bun:test";
import { BottomSheetFocusCoordinator } from "./bottom-sheet-focus";

test("restarts the 300ms focus cycle when a visible sheet quickly reopens", () => {
  let now = 0;
  let nextTimer = 0;
  const timers = new Map<number, { callback: () => void; deadline: number }>();
  const coordinator = new BottomSheetFocusCoordinator({
    clearTimeout: (timer) => { timers.delete(timer as unknown as number); },
    now: () => now,
    setTimeout: (callback, delay) => {
      const timer = ++nextTimer;
      timers.set(timer, { callback, deadline: now + delay });
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
  });
  const advance = (milliseconds: number) => {
    now += milliseconds;
    for (const [key, timer] of [...timers]) if (timer.deadline <= now) { timers.delete(key); timer.callback(); }
  };
  const sheet = Symbol("sheet");
  let focusCount = 0;
  coordinator.registerInput(sheet, "profile-name", Symbol("input"), { focus: () => { focusCount += 1; }, isEligible: () => true });
  coordinator.activate(sheet, "profile-name");
  advance(300);
  expect(focusCount).toBe(1);

  advance(100);
  coordinator.restart(sheet, "profile-name");
  advance(299);
  expect(focusCount).toBe(1);
  advance(1);
  expect(focusCount).toBe(2);
});
