import { describe, expect, test } from "bun:test";

import type { ConversationRetrieval } from "./conversation-client";
import { appSearchResultIdentity, filterConversationRetrievalResults, formatConversationRetrievalSummary, mergeConversationRetrievalResults, RETRIEVAL_LABELS, validConversationRetrievalIdentities } from "./conversation-retrievals";

const retrieval = (groups: ConversationRetrieval["groups"], query = "find it"): ConversationRetrieval => ({ query, limit: 10, minimumScore: 0.55, groups });

describe("conversation retrieval presentation", () => {
  test("merges duplicate collection/key pairs across invocations and preserves first presentation order", () => {
    const first = retrieval([{ collectionSlug: "books", results: [{ key: "book-1", label: "First label" }] }, { collectionSlug: "inboxes", results: [{ key: "inbox-1", destinationKey: "connector-1", label: "Inbox" }] }, { collectionSlug: "images", results: [{ key: "image-1", label: "Photo" }] }]);
    const second = retrieval([{ collectionSlug: "books", results: [{ key: "book-1", label: "Changed label" }, { key: "book-2", label: "Second" }] }]);
    expect(mergeConversationRetrievalResults([first, second]).map(({ collectionSlug, key, label }) => ({ collectionSlug, key, label }))).toEqual([
      { collectionSlug: "books", key: "book-1", label: "First label" },
      { collectionSlug: "inboxes", key: "inbox-1", label: "Inbox" },
      { collectionSlug: "images", key: "image-1", label: "Photo" },
      { collectionSlug: "books", key: "book-2", label: "Second" },
    ]);
    expect(mergeConversationRetrievalResults([first])[1]).toHaveProperty("destinationKey", "connector-1");
  });

  test("formats deterministic one, two, and many-part summaries with audio book wording", () => {
    const one = mergeConversationRetrievalResults([retrieval([{ collectionSlug: "books", results: [{ key: "1", label: "One" }] }])]);
    const two = mergeConversationRetrievalResults([retrieval([{ collectionSlug: "books", results: [{ key: "1", label: "One" }] }, { collectionSlug: "images", results: [{ key: "2", label: "Two" }, { key: "3", label: "Three" }] }])]);
    const many = mergeConversationRetrievalResults([retrieval([{ collectionSlug: "books", results: [{ key: "1", label: "One" }] }, { collectionSlug: "images", results: [{ key: "2", label: "Two" }, { key: "3", label: "Three" }] }, { collectionSlug: "documents", results: [{ key: "4", label: "Four" }, { key: "5", label: "Five" }, { key: "6", label: "Six" }] }])]);
    expect(formatConversationRetrievalSummary(one)).toBe("Found 1 audio book");
    expect(formatConversationRetrievalSummary(two)).toBe("Found 1 audio book & 2 images");
    expect(formatConversationRetrievalSummary(many)).toBe("Found 1 audio book, 2 images & 3 documents");
    expect(Object.values(RETRIEVAL_LABELS).flatMap(({ singular, plural }) => [singular, plural])).not.toContain("book");
    expect(Object.values(RETRIEVAL_LABELS).flatMap(({ singular, plural }) => [singular, plural])).not.toContain("books");
  });

  test("intersects stored identities with current key and countryCode identities", () => {
    const stored = retrieval([{ collectionSlug: "countries", results: [{ key: "SE", label: "Sweden" }, { key: "NO", label: "Norway" }] }, { collectionSlug: "documents", results: [{ key: "doc-1", label: "Current" }, { key: "doc-2", label: "Deleted" }] }]);
    const output = { query: "find it", groups: [{ collectionSlug: "countries" as const, results: [{ countryCode: "SE" }] }, { collectionSlug: "documents" as const, results: [{ key: "doc-1" }] }] };
    const valid = validConversationRetrievalIdentities(stored, output);
    expect(appSearchResultIdentity("countries", { key: "wrong", countryCode: "SE" })).toBe("SE");
    expect(filterConversationRetrievalResults(mergeConversationRetrievalResults([stored]), new Map([[stored, valid]])).map(({ key }) => key)).toEqual(["SE", "doc-1"]);
  });

  test("validates projected container pills against the fresh canonical projection", () => {
    const stored = retrieval([{ collectionSlug: "folders", results: [{ key: "folder-1", label: "Dogs", destinationCollectionSlug: "documents" }] }]);
    const output = {
      query: "find it",
      groups: [{ collectionSlug: "documents" as const, results: [{ key: "document-1" }] }],
      retrieval: retrieval([{ collectionSlug: "folders", results: [{ key: "folder-1", label: "Dogs", destinationCollectionSlug: "documents" }] }]),
    };
    const valid = validConversationRetrievalIdentities(stored, output);
    expect([...valid]).toEqual(["folders:folder-1"]);
  });

  test("merges query-free tool result retrievals alongside search retrievals", () => {
    const listTool = { source: "results" as const, limit: 10, minimumScore: 0.55, groups: [{ collectionSlug: "collections" as const, results: [{ key: "col-1", label: "City After Rain" }, { key: "col-2", label: "Coastal Days" }] }] } as ConversationRetrieval;
    const search = retrieval([{ collectionSlug: "collections", results: [{ key: "col-2", label: "Coastal Days" }, { key: "col-3", label: "Exhibition Selects" }] }]);
    expect(mergeConversationRetrievalResults([listTool, search]).map(({ key, label }) => ({ key, label }))).toEqual([
      { key: "col-1", label: "City After Rain" },
      { key: "col-2", label: "Coastal Days" },
      { key: "col-3", label: "Exhibition Selects" },
    ]);
    expect(mergeConversationRetrievalResults([listTool])).toHaveLength(2);
  });
});
