import { expect, test } from "bun:test";

import { advanceStreamingRichText, parseRichText, type StreamingRichTextState } from "./rich-text-parser";

test("preserves exact source and only advances the stable Markdown prefix", () => {
  const chunks = [
    "# Res",
    "ults\n\nFirst **paragraph**.",
    "\n\n- one",
    "\n- two\n\n| Name | Value |\n| --- | --- |",
    "\n| Rain | 2 |\n\n```ts\nconst value = 2;",
    "\n```",
  ];
  let source = "";
  let state: StreamingRichTextState | undefined;
  let previousStable = "";
  for (const chunk of chunks) {
    const previousSegments = state?.stableSegments ?? [];
    source += chunk;
    state = advanceStreamingRichText(state, source);
    expect(state.stable + state.tail).toBe(source);
    expect(state.stable.startsWith(previousStable)).toBe(true);
    expect(state.stableSegments.map(({ content }) => content).join("")).toBe(state.stable);
    previousSegments.forEach((segment, index) => expect(state!.stableSegments[index]).toBe(segment));
    previousStable = state.stable;
  }
  expect(parseRichText(state!.stable + state!.tail)).toEqual(parseRichText(source));
  expect(state!.stable).toContain("# Results");
  expect(state!.tail).toContain("```ts");
});

test("resets safely when authoritative content replaces the streamed source", () => {
  const streamed = advanceStreamingRichText(undefined, "First paragraph.\n\nSecond");
  expect(streamed.stable).toBe("First paragraph.\n\n");
  expect(advanceStreamingRichText(streamed, "Corrected response.")).toEqual({ source: "Corrected response.", stable: "", stableSegments: [], tail: "Corrected response." });
});

test("normalizes mounted stream state retained across a component refresh", () => {
  const legacy = { source: "Stable.\n\nTail", stable: "Stable.\n\n", tail: "Tail" } as unknown as StreamingRichTextState;
  const normalized = advanceStreamingRichText(legacy, legacy.source);
  expect(normalized.stableSegments).toEqual([{ key: 0, content: "Stable.\n\n" }]);
  expect(normalized.stable + normalized.tail).toBe(legacy.source);
});
