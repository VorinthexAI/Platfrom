import { describe, expect, test } from "bun:test";

import { applyEnhancement, resolveEnhancementTarget } from "./note-enhancement";

describe("note enhancement", () => {
  test("targets and replaces only selected text", () => {
    const original = "Keep this are teh broken words and keep this too.";
    const start = original.indexOf("this are");
    const target = resolveEnhancementTarget(original, { start, end: start + "this are teh broken words".length });
    expect(target.content).toBe("this are teh broken words");
    expect(applyEnhancement(original, "these are the corrected words", target.range)).toBe("Keep these are the corrected words and keep this too.");
  });

  test("targets and replaces the full note without a valid selection", () => {
    const target = resolveEnhancementTarget("This are teh note.", { start: 4, end: 4 });
    expect(target).toEqual({ content: "This are teh note.", range: undefined });
    expect(applyEnhancement(target.content, "This is the note.", target.range)).toBe("This is the note.");
  });
});
