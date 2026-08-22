import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("../components/capability/TravelWorkspace.tsx", import.meta.url), "utf8");

test("opens persisted travel guides from the trip menu through a delayed full-height sheet", () => {
  expect(workspace).toContain(">Travel guides</BottomSheetItem>");
  expect(workspace).toContain("delaySheetTransition(() => setTripGuidesOpen(true))");
  expect(workspace).toContain('label="Travel guides"');
  expect(workspace).toContain("compassQueryKeys.tripGuides(travelContext, selectedTrip?.key ?? \"\")");
  expect(workspace).toContain("listTripGuides(selectedTrip.key, signal)");
});

test("renders exact guide actions, server-confirmed cache updates, and detail navigation", () => {
  expect(workspace).toContain('size="md" variant="primary">Create new</Button>');
  expect(workspace).toContain('size="md" style={styles.sheetSecondary} variant="secondary">Close</Button>');
  expect(workspace).toContain("if (!selectedTrip || tripGuideGeneratingRef.current) return");
  expect(workspace).toContain("const guide = await generateTripGuide(tripKey, randomUUID())");
  expect(workspace).toContain("[guide, ...(current ?? []).filter(({ key }) => key !== guide.key)]");
  expect(workspace.indexOf("const guide = await generateTripGuide")).toBeLessThan(workspace.indexOf("setSelectedTripGuide(guide)"));
  expect(workspace).toContain('title: "Travel guide created"');
  expect(workspace).toContain("showToast({ title: errorMessage(error)");
  expect(workspace).toContain("open={open && !selected && !generating}");
  expect(workspace).toContain('title={generating ? `Creating ${singular.toLocaleLowerCase()}`');
  expect(workspace).toContain('accessibilityLabel={`Generating ${singular.toLocaleLowerCase()}`}');
  expect(workspace).toContain("Array.from({ length: 3 }");
});

test("uses shared controls for full-width guide pills and formats a four-image detail", () => {
  expect(workspace).toContain('shape="pill" size="md"');
  expect(workspace).toContain(".slice(0, 4)");
  expect(workspace).toContain("formatGuideContent(document.content)");
  expect(workspace).toContain("tripGuidesQuery.data?.find(({ key }) => key === selectedTripGuide.key)");
  expect(workspace).toContain('tripGuidePill: { width: "100%", minHeight: 44');
  expect(workspace).toContain('tripGuidePillSkeleton: { width: "100%", height: 44, borderRadius: 999 }');
  expect(workspace).not.toContain('size="md" variant="primary">Back</Button>');
  expect(workspace).not.toContain("<Pressable");
  expect(workspace).not.toContain("<Touchable");
});
