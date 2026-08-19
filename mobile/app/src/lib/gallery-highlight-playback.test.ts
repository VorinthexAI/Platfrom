import { expect, test } from "bun:test";
import { HIGHLIGHT_SLIDE_DURATION_MS, initialHighlightPlaybackState, reduceHighlightPlayback } from "./gallery-highlight-playback";

test("shows each highlight slide for three seconds", () => {
  expect(HIGHLIGHT_SLIDE_DURATION_MS).toBe(3_000);
});

test("autoplays loaded slides and advances while retaining overflow time", () => {
  const loaded = reduceHighlightPlayback(initialHighlightPlaybackState, { type: "load", slideCount: 3, autoplay: true });
  expect(loaded).toEqual({ index: 0, playing: true, progressMs: 0 });
  expect(reduceHighlightPlayback(loaded, { type: "tick", elapsedMs: HIGHLIGHT_SLIDE_DURATION_MS + 250, slideCount: 3 })).toEqual({ index: 1, playing: true, progressMs: 250 });
});

test("stops at the final slide and never plays an empty highlight", () => {
  expect(reduceHighlightPlayback(initialHighlightPlaybackState, { type: "load", slideCount: 0, autoplay: true })).toEqual(initialHighlightPlaybackState);
  expect(reduceHighlightPlayback({ index: 1, playing: true, progressMs: 4_900 }, { type: "tick", elapsedMs: 100, slideCount: 2 })).toEqual({ index: 1, playing: false, progressMs: HIGHLIGHT_SLIDE_DURATION_MS });
});

test("pause, play, previous, and next preserve deterministic progress", () => {
  const active = { index: 1, playing: true, progressMs: 800 };
  expect(reduceHighlightPlayback(active, { type: "pause" })).toEqual({ ...active, playing: false });
  expect(reduceHighlightPlayback({ ...active, playing: false }, { type: "play", slideCount: 3 })).toEqual(active);
  expect(reduceHighlightPlayback(active, { type: "previous" })).toEqual({ index: 0, playing: true, progressMs: 0 });
  expect(reduceHighlightPlayback(active, { type: "next", slideCount: 3 })).toEqual({ index: 2, playing: true, progressMs: 0 });
  expect(reduceHighlightPlayback({ index: 2, playing: false, progressMs: HIGHLIGHT_SLIDE_DURATION_MS }, { type: "play", slideCount: 3 })).toEqual({ index: 0, playing: true, progressMs: 0 });
});
