import { describe, expect, test } from "bun:test";

import { highlightedSegments, mergeHighlightRanges, normalizeDocumentSearchText, searchDocumentPassages, searchDocumentPassagesLiteral } from "@vorinthex/shared/ui/document-search";

const passages = (text: string) => [{ id: "passage", text }];

describe("document search", () => {
  test("ranks an exact phrase above token matches", () => {
    const matches = searchDocumentPassages([{ id: "tokens", text: "brown then quick" }, { id: "phrase", text: "the quick brown fox" }], "quick brown");
    expect(matches.map(({ id }) => id)).toEqual(["phrase", "tokens"]);
    expect(matches[0]?.score).toBe(1);
  });

  test("normalizes case, diacritics, compatibility characters, and whitespace", () => {
    expect(normalizeDocumentSearchText("  CAFÉ\n  ﬁle  ")).toBe("cafe file");
    expect(searchDocumentPassages(passages("A CAFÉ\n\tfile"), "cafe file")).toHaveLength(1);
  });

  test("maps normalized matches to original UTF-16 ranges", () => {
    const match = searchDocumentPassages(passages("Say Café now"), "CAFE")[0];
    expect(match?.ranges).toEqual([{ start: 4, end: 8 }]);
    expect(match?.text.slice(match.ranges[0]!.start, match.ranges[0]!.end)).toBe("Café");
  });

  test("supports conservative one-character typos", () => {
    const match = searchDocumentPassages(passages("A searchable document"), "searachable")[0];
    expect(match?.score).toBeGreaterThan(0.55);
    expect(match?.ranges).toEqual([{ start: 2, end: 12 }]);
  });

  test("honors a configurable fuzzy threshold", () => {
    expect(searchDocumentPassages(passages("searchable"), "searachable", 0.9)).toEqual([]);
    expect(searchDocumentPassages(passages("searchable"), "searachable", 0.5)).toHaveLength(1);
  });

  test("rejects short fuzzy and unrelated low-score results", () => {
    expect(searchDocumentPassages(passages("cat catalog"), "cot")).toEqual([]);
    expect(searchDocumentPassages(passages("the weather is clear"), "document search")).toEqual([]);
  });

  test("returns every exact occurrence", () => {
    expect(searchDocumentPassages(passages("Test, test, TEST"), "test")[0]?.ranges).toEqual([{ start: 0, end: 4 }, { start: 6, end: 10 }, { start: 12, end: 16 }]);
  });

  test("caps highlight and passage output for large documents", () => {
    expect(searchDocumentPassages(passages(Array.from({ length: 150 }, () => "test").join(" ")), "test")[0]?.ranges).toHaveLength(100);
    expect(searchDocumentPassages(Array.from({ length: 150 }, (_, index) => ({ id: String(index), text: "test" })), "test")).toHaveLength(100);
  });

  test("merges overlapping but not merely adjacent ranges", () => {
    expect(mergeHighlightRanges([{ start: 3, end: 7 }, { start: 1, end: 4 }, { start: 7, end: 9 }])).toEqual([{ start: 1, end: 7 }, { start: 7, end: 9 }]);
    expect(searchDocumentPassages(passages("banana"), "ana")[0]?.ranges).toEqual([{ start: 1, end: 6 }]);
  });

  test("creates renderable highlighted and plain segments", () => {
    expect(highlightedSegments("one two three", [{ start: 4, end: 7 }])).toEqual([
      { start: 0, end: 4, text: "one ", highlighted: false },
      { start: 4, end: 7, text: "two", highlighted: true },
      { start: 7, end: 13, text: " three", highlighted: false },
    ]);
  });

  test("keeps passage order as the deterministic score tie-break", () => {
    const input = [{ id: "first", text: "match here" }, { id: "second", text: "another match" }];
    expect(searchDocumentPassages(input, "match").map(({ id }) => id)).toEqual(["first", "second"]);
  });

  test("returns no matches for an empty normalized query", () => {
    expect(searchDocumentPassages(passages("anything"), " \n ")).toEqual([]);
  });

  test("performs instant regex-safe Control-F matching without fuzzy results", () => {
    const matches = searchDocumentPassagesLiteral(passages("Thanks, THANKS, and thanks. Special [text]."), "thanks");
    expect(matches[0]?.ranges).toEqual([{ start: 0, end: 6 }, { start: 8, end: 14 }, { start: 20, end: 26 }]);
    expect(searchDocumentPassagesLiteral(passages("A searchable document"), "searachable")).toEqual([]);
    expect(searchDocumentPassagesLiteral(passages("Special [text]."), "[text]")[0]?.ranges).toEqual([{ start: 8, end: 14 }]);
  });

  test("returns every literal occurrence without fuzzy-search result caps", () => {
    const manyPassages = Array.from({ length: 120 }, (_, index) => ({ id: String(index), text: "match ".repeat(120) }));
    const matches = searchDocumentPassagesLiteral(manyPassages, "match");
    expect(matches).toHaveLength(120);
    expect(matches[0]?.ranges).toHaveLength(120);
  });

  test("keeps literal occurrence ranges distinct", () => {
    expect(searchDocumentPassagesLiteral(passages("aaa"), "aa")[0]?.ranges).toEqual([{ start: 0, end: 2 }]);
  });
});
