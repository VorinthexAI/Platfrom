import { expect, test } from "bun:test";

import { BottomSheetFocusCoordinator } from "../../../../shared/packages/ui/components/bottom-sheet/bottom-sheet-focus";

class FakeClock {
  private nextId = 1;
  private time = 0;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  now = () => this.time;
  setTimeout = (callback: () => void, delay: number) => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + delay, callback });
    return id as ReturnType<typeof setTimeout>;
  };
  clearTimeout = (timer: ReturnType<typeof setTimeout>) => {
    this.timers.delete(timer as number);
  };

  advance(milliseconds: number) {
    const target = this.time + milliseconds;
    while (true) {
      const next = [...this.timers.entries()].sort((left, right) => left[1].at - right[1].at)[0];
      if (!next || next[1].at > target) break;
      this.time = next[1].at;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.time = target;
  }
}

function setup() {
  const clock = new FakeClock();
  return { clock, coordinator: new BottomSheetFocusCoordinator(clock) };
}

test("focuses the first eligible registered input after 300ms", () => {
  const { clock, coordinator } = setup();
  const sheet = Symbol("sheet");
  const focused: string[] = [];
  coordinator.activate(sheet, "page");
  coordinator.registerInput(sheet, "page", Symbol(), { focus: () => focused.push("disabled"), isEligible: () => false });
  coordinator.registerInput(sheet, "page", Symbol(), { focus: () => focused.push("first"), isEligible: () => true });
  coordinator.registerInput(sheet, "page", Symbol(), { focus: () => focused.push("second"), isEligible: () => true });

  clock.advance(299);
  expect(focused).toEqual([]);
  clock.advance(1);
  expect(focused).toEqual(["first"]);
});

test("only focuses the topmost stacked sheet and resumes the uncovered sheet", () => {
  const { clock, coordinator } = setup();
  const lower = Symbol("lower");
  const upper = Symbol("upper");
  const focused: string[] = [];
  coordinator.activate(lower, "lower");
  coordinator.registerInput(lower, "lower", Symbol(), { focus: () => focused.push("lower"), isEligible: () => true });
  coordinator.activate(upper, "upper");
  coordinator.registerInput(upper, "upper", Symbol(), { focus: () => focused.push("upper"), isEligible: () => true });

  clock.advance(300);
  expect(focused).toEqual(["upper"]);
  coordinator.deactivate(upper);
  expect(focused).toEqual(["upper", "lower"]);
});

test("cancels pending focus when a sheet closes", () => {
  const { clock, coordinator } = setup();
  const sheet = Symbol("sheet");
  let focusCount = 0;
  coordinator.activate(sheet, "page");
  coordinator.registerInput(sheet, "page", Symbol(), { focus: () => focusCount++, isEligible: () => true });
  coordinator.deactivate(sheet);
  clock.advance(300);
  expect(focusCount).toBe(0);
});

test("an explicit focus claims the cycle before the timer", () => {
  const { clock, coordinator } = setup();
  const sheet = Symbol("sheet");
  let focusCount = 0;
  coordinator.activate(sheet, "page");
  coordinator.registerInput(sheet, "page", Symbol(), { focus: () => focusCount++, isEligible: () => true });
  coordinator.claim(sheet, "page");
  clock.advance(300);
  expect(focusCount).toBe(0);
});

test("focuses an eligible input that registers after the deadline", () => {
  const { clock, coordinator } = setup();
  const sheet = Symbol("sheet");
  let focusCount = 0;
  coordinator.activate(sheet, "page");
  clock.advance(500);
  coordinator.registerInput(sheet, "page", Symbol(), { focus: () => focusCount++, isEligible: () => true });
  expect(focusCount).toBe(1);
});

test("focuses an input that becomes eligible after the deadline", () => {
  const { clock, coordinator } = setup();
  const sheet = Symbol("sheet");
  const input = Symbol("input");
  let eligible = false;
  let focusCount = 0;
  coordinator.activate(sheet, "page");
  coordinator.registerInput(sheet, "page", input, { focus: () => focusCount++, isEligible: () => eligible });
  clock.advance(300);
  expect(focusCount).toBe(0);
  eligible = true;
  coordinator.registerInput(sheet, "page", input, { focus: () => focusCount++, isEligible: () => eligible });
  expect(focusCount).toBe(1);
});

test("focusKey resets and cancels the previous focus cycle", () => {
  const { clock, coordinator } = setup();
  const sheet = Symbol("sheet");
  let focusCount = 0;
  coordinator.activate(sheet, "first");
  const input = Symbol();
  coordinator.registerInput(sheet, "first", input, { focus: () => focusCount++, isEligible: () => true });
  clock.advance(100);
  coordinator.registerInput(sheet, "second", input, { focus: () => focusCount++, isEligible: () => true });
  clock.advance(200);
  expect(focusCount).toBe(0);
  clock.advance(100);
  expect(focusCount).toBe(1);
});
