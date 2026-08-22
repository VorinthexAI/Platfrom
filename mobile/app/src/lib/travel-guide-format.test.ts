import { expect, test } from "bun:test";

import { formatGuideContent, normalizeGuideContent } from "./travel-guide-format";

test("normalizes guide line endings and single escaped newlines without corrupting escaped slashes", () => {
  expect(normalizeGuideContent("First\r\nSecond\rThird\\nFourth")).toBe("First\nSecond\nThird\nFourth");
  expect(normalizeGuideContent(String.raw`Keep \\n as text`)).toBe(String.raw`Keep \\n as text`);
});

test("formats markdown and plain guide headings while preserving body newlines", () => {
  expect(formatGuideContent("# Arrival\\nLand before dusk.\\nCheck in early.\\n\\nFood:\\nBook the market.")).toEqual([
    { heading: "Arrival", body: "Land before dusk.\nCheck in early." },
    { heading: "Food", body: "Book the market." },
  ]);
  expect(formatGuideContent("A short unformatted guide.")).toEqual([{ body: "A short unformatted guide." }]);
});
