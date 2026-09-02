import { expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const [composer, sheet, route, archive, signal, compass, books] = await Promise.all([
  read("../components/PersistentCoreComposer.tsx"),
  read("../components/ConversationRetrievalSheet.tsx"),
  read("../app/capability/[slug].tsx"),
  read("../components/capability/KnowledgeWorkspace.tsx"),
  read("../components/capability/EmailWorkspace.tsx"),
  read("../components/capability/TravelWorkspace.tsx"),
  read("../components/capability/AscendWorkspace.tsx"),
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
});

test("auto-opens only fresh non-replayed completions and closes on state boundaries", () => {
  expect(composer).toContain("!event.replayed && mergeConversationRetrievalResults(event.message.retrievals).length");
  expect(composer).toContain("autoOpenedCompletions.current.has(event.message.key)");
  expect(composer).toContain("setActiveRetrievals({ fresh: true");
  expect(composer).toContain("setActiveRetrievals({ fresh: false");
  expect(composer).toContain("setActiveRetrievals(undefined); autoOpenedCompletions.current.clear()");
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
