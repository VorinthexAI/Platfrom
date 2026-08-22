import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { compassQueryKeys } from "./compass-query-keys";
import { formatGuideContent } from "./travel-guide-format";

const workspace = readFileSync(new URL("../components/capability/TravelWorkspace.tsx", import.meta.url), "utf8");
const events = readFileSync(new URL("event-bridge.tsx", import.meta.url), "utf8");
const context = { organizationKey: "org", scopeKey: "scope" };

test("scopes place reference caches by workspace, place, and kind", () => {
  expect(compassQueryKeys.placeReferences(context, "place-key", "brief")).toEqual(["compass", "org", "scope", "places", "place-key", "references", "brief"]);
  expect(compassQueryKeys.placeReferences(context, "place-key", "brief")).not.toEqual(compassQueryKeys.placeReferences(context, "place-key", "restaurants"));
  expect(events).toContain('if (event.event === "place.reference.changed") invalidateCompassPlaceReferences()');
  expect(events).toContain('if (event.event === "content.changed")');
  expect(events).toContain('queryKey: ["archive", organizationKey, scopeKey]');
});

test("offers four parameterized place reference kinds without report compatibility", () => {
  for (const value of ['kind: "brief", label: "Briefs"', 'kind: "accommodations", label: "Accommodations"', 'kind: "restaurants", label: "Restaurants"', 'kind: "activities", label: "Activities"']) expect(workspace).toContain(value);
  expect(workspace).toContain("PLACE_REFERENCE_OPTIONS.map");
  expect(workspace).toContain("listPlaceReferences(selectedPlace.key, placeReferenceKind, signal)");
  expect(workspace).toContain("generatePlaceReference(placeKey, kind, randomUUID())");
  expect(workspace).toContain('<GeneratedDocumentSheets appendGeneration createLabel="Request new" documents={placeReferencesQuery.data}');
  expect(workspace).toContain("placeReferencesQuery.data?.find(({ key }) => key === selectedPlaceReference.key)");
  expect(workspace).toContain('accessibilityLabel="AI place actions"');
  expect(workspace).toContain('<BrainIcon size="sm" />');
  expect(workspace).toContain('open={placeAiMenuOpen} title="AI actions"');
  const placeHeaders = workspace.slice(workspace.indexOf('{selectedPlace ? <>'), workspace.indexOf('<ScrollView accessibilityLabel={`${selectedPlace.name}'));
  expect(placeHeaders.indexOf('accessibilityLabel="Place menu"')).toBeLessThan(placeHeaders.indexOf('accessibilityLabel="AI place actions"'));
  expect(placeHeaders).toContain('style={styles.detailHeaderActions}');
  expect(placeHeaders).not.toContain('size="xs" variant="icon"');
  const aiMenuStart = workspace.indexOf('<BottomSheet hideHeading onOpenChange={setPlaceAiMenuOpen}');
  const placeMenuStart = workspace.indexOf('<BottomSheet hideHeading onOpenChange={setPlaceMenuOpen}');
  const placeMenuEnd = workspace.indexOf('</BottomSheet>', placeMenuStart);
  expect(workspace.slice(aiMenuStart, placeMenuStart)).toContain('PLACE_REFERENCE_OPTIONS.map');
  expect(workspace.slice(placeMenuStart, placeMenuEnd)).not.toContain('PLACE_REFERENCE_OPTIONS.map');
});

test("keeps place generation in the listing as one appended skeleton before opening the result", () => {
  expect(workspace).toContain('tripGuidePill: { width: "100%", minHeight: 44');
  expect(workspace).toContain('tripGuidePillSkeleton: { width: "100%", height: 44, borderRadius: 999 }');
  expect(workspace).toContain("visibleDocuments?.map((document)");
  expect(workspace).toContain("appendGeneration && !loading && generating ? <Skeleton");
  expect(workspace).toContain("setSelectedPlaceReference(reference)");
  expect(workspace).toContain("<GeneratedDocumentSheets appendGeneration");
  expect(workspace).toContain('createLabel="Request new"');
  expect(workspace).toContain('onDetailClose={() => setSelectedPlaceReference(undefined)}');
  expect(workspace).toContain('open={open && (!generating || appendGeneration)}');
  expect(workspace).toContain('request complete`, duration: 2_000');
  expect(workspace).toContain("formatGuideContent(document.content)");
  expect(workspace).toContain("formatGuideBody(body).map");
  expect(workspace).toContain('ellipsizeMode="tail" numberOfLines={1} style={styles.tripGuidePillName}');
  expect(workspace).toContain('<View style={styles.tripGuidePillAccessory}><ChevronRightIcon size="sm" /></View>');
  expect(workspace).toContain("keys.map((key) => deleteContentDocument(key))");
  expect(workspace).toContain('accessibilityLabel="Clear reference selection"');
  expect(workspace).toContain('textStyle={styles.bulkRemoveText} variant="secondary">Remove</Button>');
  expect(workspace).toContain('title={`Remove ${activeSelectedKeys.length === 1');
  expect(workspace).toContain("documentSelected && styles.tripGuidePillSelected");
  expect(workspace).toContain('tripGuidePillSelected: { borderColor: palette.silver50, borderWidth: 2 }');
  expect(workspace).not.toContain("tripGuidePillSelected: { backgroundColor:");
  expect(formatGuideContent("Intro text after an edit.\n\n## Stay\n- Near transit\n- Book early\n\nFood:\nTry the market.")).toEqual([
    { body: "Intro text after an edit." },
    { heading: "Stay", body: "- Near transit\n- Book early" },
    { heading: "Food", body: "Try the market." },
  ]);
});
