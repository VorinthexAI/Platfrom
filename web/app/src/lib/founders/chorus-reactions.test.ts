import { describe, expect, test } from "bun:test";
import { CHORUS_REACTIONS, filterChorusReactions } from "./chorus-reactions";

describe("Chorus reactions", () => {
  test("contains no blank or duplicate reactions", () => {
    expect(CHORUS_REACTIONS.every(({ emoji, name }) => emoji.trim() && name.trim())).toBe(true);
    expect(new Set(CHORUS_REACTIONS.map(({ emoji }) => emoji)).size).toBe(CHORUS_REACTIONS.length);
  });

  test("searches by human-readable names and keywords", () => {
    expect(filterChorusReactions("rocket").map(({ emoji }) => emoji)).toContain("🚀");
    expect(filterChorusReactions("approve").map(({ emoji }) => emoji)).toContain("👍");
  });
});
