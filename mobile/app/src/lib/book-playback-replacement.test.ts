import { expect, test } from "bun:test";

import { beginReplacement, clampBookPlaybackSeek, observeReplacementLoad } from "./book-playback-replacement";

test("an initially unloaded replacement becomes ready on its first loaded status", () => {
  const started = beginReplacement(1, 10, false);
  expect(started.observedUnload).toBe(true);
  expect(observeReplacementLoad(started, 10, 1, true).ready).toBe(true);
});

test("a loaded source replacement waits for an unload transition", () => {
  const started = beginReplacement(2, 20, true);
  expect(observeReplacementLoad(started, 20, 2, true).ready).toBe(false);
  const unloaded = observeReplacementLoad(started, 20, 2, false);
  expect(unloaded.ready).toBe(false);
  expect(observeReplacementLoad(unloaded.state, 20, 2, true).ready).toBe(true);
});

test("ignores status observations from an older request or replacement", () => {
  const current = beginReplacement(4, 40, false);
  expect(observeReplacementLoad(current, 30, 4, true).ready).toBe(false);
  expect(observeReplacementLoad(current, 40, 3, true).ready).toBe(false);
});

test("clamps a replacement seek to shortened loaded media", () => {
  expect(clampBookPlaybackSeek(500, 100)).toBe(100);
  expect(clampBookPlaybackSeek(-5, 100)).toBe(0);
});
