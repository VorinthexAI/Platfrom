import { expect, test } from "bun:test";
import { mapWithConcurrency } from "./bounded-concurrency";

test("maps in input order without exceeding the requested concurrency", async () => {
  let active = 0; let maximum = 0;
  const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (value) => {
    active += 1; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1; return value * 2;
  });
  expect(maximum).toBe(3); expect(results).toEqual([2, 4, 6, 8, 10, 12, 14]);
});
