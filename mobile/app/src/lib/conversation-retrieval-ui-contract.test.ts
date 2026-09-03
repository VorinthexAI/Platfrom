import { expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const [composer, sheet, route, archive, signal, compass, books, richText] = await Promise.all([
  read("../components/PersistentCoreComposer.tsx"),
  read("../components/ConversationRetrievalSheet.tsx"),
  read("../app/capability/[slug].tsx"),
  read("../components/capability/KnowledgeWorkspace.tsx"),
  read("../components/capability/EmailWorkspace.tsx"),
  read("../components/capability/TravelWorkspace.tsx"),
  read("../components/capability/AscendWorkspace.tsx"),
  read("../../../../shared/packages/ui/components/rich-text/rich-text.mobile.tsx"),
]);

test("renders one compact shared retrieval pill through the memoized message row", () => {
  expect(composer).toContain("const MessageRow = memo(");
  expect(composer).toContain("message.status === \"COMPLETED\"");
  expect(composer).toContain("<ActionPill compact onPress={() => onOpenRetrievals(message)}");
  expect(composer).toContain("formatConversationRetrievalSummary(retrievalResults)");
  expect(composer).not.toContain("<Pressable");
});

test("uses a full-height shared results sheet and validates without recording history", () => {
  expect(sheet).toContain('height="full"');
  expect(sheet).toContain('title="Search results"');
  expect(sheet).not.toContain("description=");
  expect(sheet).toContain("<ActionPill compact");
  expect(sheet).toContain("useQueries");
  expect(sheet).toContain("recordHistory: false");
  expect(sheet).toContain("validConversationRetrievalIdentities");
  expect(sheet).toContain("Some results could not be checked.");
  expect(sheet).toContain(">Retry</Button>");
  expect(sheet).not.toContain("footer=");
});

test("renders shared rich-text headings bold without increasing body size", () => {
  expect(richText).toContain('paragraph: { color: colors.text, fontSize: 14, lineHeight: 20 }');
  expect(richText).toContain('heading: { fontSize: 14, lineHeight: 20, fontWeight: "700" }');
  expect(richText).toContain("overrides.heading");
  expect(richText).not.toContain("heading1:");
  expect(richText).not.toContain("heading2:");
  expect(richText).not.toContain("heading3:");
});

test("renders tool result retrievals directly and re-runs only search retrievals", () => {
  expect(sheet).toContain('retrieval.source !== "results"');
  expect(sheet).toContain("retrieval.searchCollectionSlugs ??");
  expect(sheet).toContain("mergeConversationRetrievalResults(retrievals)");
});

test("opens retrieval results only from the completed-message pill", () => {
  expect(composer).toContain("setActiveRetrievals(message.retrievals)");
  expect(composer).toContain('setSheet("retrievals")');
  expect(composer).not.toContain("autoOpenedCompletions");
  expect(composer).not.toContain("setActiveRetrievals({ fresh:");
  expect(composer).not.toContain("!event.replayed && mergeConversationRetrievalResults");
  expect(sheet).not.toContain("fresh:");
  expect(composer).toContain('editable={configured && !turning && !sheet}');
});

test("routes each persisted resource identity to its established workspace", () => {
  for (const value of ["assetKey: key", "documentKey: key", "imageKey: key", "signalThreadKey: key", "tripKey: key", "connectorKey: destinationKey", "toneKey: key", "draftKey: key", "placeKey: key", "countryCode: key", "bookKey: key"]) expect(composer).toContain(value);
  expect(route).toContain("initialDraftKey={params.draftKey}");
  expect(route).toContain("initialToneKey={params.toneKey}");
  expect(route).toContain("initialPlaceKey={params.placeKey}");
  expect(route).toContain("initialCountryCode={params.countryCode}");
  expect(route).toContain("initialBookKey={params.bookKey}");
  expect(archive).toContain('initialCollectionKind === "documents" || initialCollectionKind === "files"');
  expect(signal).toContain("selectedInboxDraftKey");
  expect(signal).toContain("restoredInitialTone");
  expect(compass).toContain("initialPlaceKey");
  expect(compass).toContain("initialCountryCode");
  expect(compass).toContain("setSelectedTripKey(trip.key); if (shouldOpenTripAssets)");
  expect(books).toContain("Boolean(initialBookKey)");
});

test("reuses the retrieval query as the destination workspace search and opens matched collections", () => {
  expect(composer).toContain("const searchParams = retrieval.query ? { initialQuery: retrieval.query } : {};");
  expect(composer).toContain('params: { slug: "gallery", assetKey: key, ...searchParams }');
  expect(route).toContain("initialSearchQuery={params.initialQuery}");
  expect(route).toContain('key={`${params.assetKey ?? "root"}:${params.imageKey ?? ""}:${params.initialQuery ?? ""}`}');
  expect(route).toContain('key={`${params.assetKey ?? "root"}:${params.documentKey ?? ""}:${params.collectionKind ?? ""}:${params.initialQuery ?? ""}`}');
  expect(composer).toContain('collectionKind: destinationCollectionSlug');
  expect(archive).toContain('initialFolderKey ? initialSearchQuery?.slice(0, 500) ?? "" : ""');
  for (const kind of ['collectionKind: "places"', 'collectionKind: "trips"', 'collectionKind: "countries"', 'collectionKind: "email-tones"']) expect(composer).toContain(kind);
  expect(composer).toContain('collectionKind: destinationCollectionSlug, ...searchParams');
  expect(route).toContain('key={`${params.placeKey ?? ""}:${params.tripKey ?? ""}:${params.countryCode ?? ""}:${params.collectionKind ?? ""}:${params.initialQuery ?? ""}:${params.openTripAssets ?? ""}`}');
  expect(route).toContain('key={`${params.bookKey ?? "root"}:${params.initialQuery ?? ""}`}');
  expect(signal).toContain('search: initialConnectorKey && initialSearchQuery ? initialSearchQuery.slice(0, 500) : ""');
});
