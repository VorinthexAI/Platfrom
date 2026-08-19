import { expect, test } from "bun:test";
import { galleryMemoryTypedText, galleryMemoryTypingDuration, MEMORY_TYPING_MAX_MS, MEMORY_TYPING_MIN_MS, splitGalleryMemoryText } from "./gallery-memory-typing";

test("fits every non-empty memory typing run into two to three seconds", () => {
  expect(galleryMemoryTypingDuration("a")).toBeGreaterThanOrEqual(MEMORY_TYPING_MIN_MS);
  expect(galleryMemoryTypingDuration("a".repeat(10_000))).toBe(MEMORY_TYPING_MAX_MS);
  expect(galleryMemoryTypingDuration("")).toBe(0);
});

test("types monotonically and always completes the full text", () => {
  const text = "A complete memory across time.";
  const duration = galleryMemoryTypingDuration(text);
  expect(galleryMemoryTypedText(text, 0, duration)).toBe("");
  expect(galleryMemoryTypedText(text, duration / 2, duration).length).toBeGreaterThan(0);
  expect(galleryMemoryTypedText(text, duration, duration)).toBe(text);
  expect(galleryMemoryTypedText(text, duration + 1, duration)).toBe(text);
});

test("splits paragraph newlines while preserving readable line breaks", () => {
  expect(splitGalleryMemoryText("First line\ncontinues.\n\nSecond section.")).toEqual(["First line\ncontinues.", "Second section."]);
});
