import { expect, test } from "bun:test";
import { appendCursorItems, isNearScrollEnd } from "../../../../shared/lib/pagination";

test("appends cursor pages without duplicate items", () => {
  expect(appendCursorItems([{ key: "one", value: 1 }], [{ key: "one", value: 2 }, { key: "two", value: 2 }], ({ key }) => key)).toEqual([
    { key: "one", value: 2 }, { key: "two", value: 2 },
  ]);
});

test("detects when an infinite scroll is near its next page", () => {
  expect(isNearScrollEnd({ offset: 500, viewport: 500, content: 1_100 })).toBe(true);
  expect(isNearScrollEnd({ offset: 0, viewport: 500, content: 1_100 })).toBe(false);
});
