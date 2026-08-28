import { expect, test } from "bun:test";

import {
  activeTranscriptPhrase,
  buildTranscriptPhrases,
} from "./book-transcript";

test("builds duration-weighted transcript phrases", () => {
  const phrases = buildTranscriptPhrases(
    "A short opening. This second sentence is meaningfully longer than the first one! Final thought?",
  );
  expect(phrases.map(({ text }) => text)).toEqual([
    "A short opening.",
    "This second sentence is meaningfully longer than the first one!",
    "Final thought?",
  ]);
  expect(phrases[0]?.startRatio).toBe(0);
  expect(phrases.at(-1)?.endRatio).toBe(1);
  expect(activeTranscriptPhrase(phrases, 0)).toBe(0);
  expect(activeTranscriptPhrase(phrases, 1)).toBe(2);
});

test("preserves generated paragraph blocks and converts escaped newlines", () => {
  const phrases = buildTranscriptPhrases("First paragraph has two sentences. They stay together.\\n\\nSecond paragraph stays separate.");
  expect(phrases.map(({ text }) => text)).toEqual([
    "First paragraph has two sentences. They stay together.",
    "Second paragraph stays separate.",
  ]);
});
