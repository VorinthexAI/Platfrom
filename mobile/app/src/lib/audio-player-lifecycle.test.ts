import { expect, test } from "bun:test";

import { pauseOwnedPlayer } from "./audio-player-lifecycle";

test("does not call a player after its owner is inactive", () => {
  let pauses = 0;
  pauseOwnedPlayer({ pause: () => { pauses += 1; } }, false);
  expect(pauses).toBe(0);
});

test("ignores only Expo Audio released-player lifecycle errors", () => {
  expect(() => pauseOwnedPlayer({ pause: () => { throw new Error("Cannot use shared object that was already released"); } })).not.toThrow();
  expect(() => pauseOwnedPlayer({ pause: () => { throw new Error("audio service unavailable"); } })).toThrow("audio service unavailable");
});
