import { expect, test } from "bun:test";

import { formatGuideBody, formatGuideContent, normalizeGuideContent } from "./travel-guide-format";

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
  expect(formatGuideContent("**Arrival:**\nLand before dusk.")).toEqual([{ heading: "Arrival", body: "Land before dusk." }]);
});

test("parses generated markdown body formatting without displaying syntax", () => {
  expect(formatGuideBody("- Book **early**\n1. Try _ramen_\nRead [the guide](https://example.com) and `confirm`.")).toEqual([
    { marker: "\u2022", runs: [{ text: "Book " }, { text: "early", style: "strong" }] },
    { marker: "1.", runs: [{ text: "Try " }, { text: "ramen", style: "emphasis" }] },
    { runs: [{ text: "Read the guide and " }, { text: "confirm", style: "code" }, { text: "." }] },
  ]);
});
