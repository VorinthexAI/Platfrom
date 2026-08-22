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
  expect(workspace).toContain("<GeneratedDocumentSheets documents={placeReferencesQuery.data}");
  expect(workspace).toContain("placeReferencesQuery.data?.find(({ key }) => key === selectedPlaceReference.key)");
});

test("uses name-only thin pills, a dedicated three-skeleton creation sheet, and resilient content sections", () => {
  expect(workspace).toContain('tripGuidePill: { width: "100%", minHeight: 44');
  expect(workspace).toContain('tripGuidePillSkeleton: { width: "100%", height: 44, borderRadius: 999 }');
  expect(workspace).toContain("documents?.map((document)");
  expect(workspace).toContain("Array.from({ length: 3 }");
  expect(workspace).toContain("formatGuideContent(document.content)");
  expect(formatGuideContent("Intro text after an edit.\n\n## Stay\n- Near transit\n- Book early\n\nFood:\nTry the market.")).toEqual([
    { body: "Intro text after an edit." },
    { heading: "Stay", body: "- Near transit\n- Book early" },
    { heading: "Food", body: "Try the market." },
  ]);
});
