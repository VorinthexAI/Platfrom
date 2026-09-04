import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("../components/capability/TravelWorkspace.tsx", import.meta.url), "utf8");

test("opens persisted travel guides from the titleless trip AI menu through a delayed full-height sheet", () => {
  expect(workspace).toContain('<BottomSheet hideHeading onOpenChange={setTripAiMenuOpen} open={tripAiMenuOpen} title="">');
  expect(workspace).toContain(">Travel guides</BottomSheetItem>");
  expect(workspace).toContain('accessibilityLabel="AI trip actions"');
  expect(workspace).toContain("setTripAiMenuOpen(false)");
  expect(workspace).toContain("delaySheetTransition(() => setTripGuidesOpen(true))");
  expect(workspace).toContain('label="Travel guides"');
  expect(workspace).toContain("compassQueryKeys.tripGuides(travelContext, selectedTrip?.key ?? \"\")");
  expect(workspace).toContain("listTripGuides(selectedTrip.key, signal)");
});

test("renders exact guide actions, server-confirmed cache updates, and detail navigation", () => {
  expect(workspace).toContain('createLabel = "Create new"');
  expect(workspace).toContain('size="md" variant="primary">{createLabel}</Button>');
  expect(workspace).toContain('size="md" style={styles.sheetSecondary} variant="secondary">Close</Button>');
  expect(workspace).toContain("if (!selectedTrip || tripGuideGeneratingRef.current) return");
  expect(workspace).toContain("const guide = await generateTripGuide(tripKey, randomUUID())");
  expect(workspace).toContain("[guide, ...(current ?? []).filter(({ key }) => key !== guide.key)]");
  expect(workspace.indexOf("const guide = await generateTripGuide")).toBeLessThan(workspace.indexOf("setSelectedTripGuide(guide)"));
  expect(workspace).toContain('title: "Travel guide request complete"');
  expect(workspace).toContain("showToast({ title: errorMessage(error)");
  expect(workspace).toContain('<GeneratedDocumentSheets appendGeneration contentContext={contentContext} createLabel="Request new" documents={tripGuidesQuery.data}');
  expect(workspace).toContain("open={open && (!generating || appendGeneration)}");
  expect(workspace).toContain('onDetailClose={() => setSelectedTripGuide(undefined)}');
  expect(workspace).toContain('title={generating && !appendGeneration ? `Creating ${singular.toLocaleLowerCase()}`');
  expect(workspace).toContain('accessibilityLabel={`Generating ${singular.toLocaleLowerCase()}`}');
  expect(workspace).toContain("Array.from({ length: 3 }");
  expect(workspace).toContain("if (!appendGeneration) return");
  expect(workspace).toContain("deleteContentDocument(key)");
  expect(workspace).toContain('accessibilityLabel="Selected document actions"');
  expect(workspace).toContain('<BottomSheetItem onPress={() => { setDocumentActionsOpen(false); requestAnimationFrame(() => setResourceTagsOpen(true)); }');
  expect(workspace).toContain('targets={activeSelectedKeys.map((key) => ({ type: "document", key }))}');
  expect(workspace).toContain('contentContext: ContentContext');
  expect(workspace).not.toContain('textStyle={styles.bulkRemoveText} variant="secondary">Remove</Button>');
  expect(workspace).toContain("open={open && appendGeneration && activeSelectedKeys.length > 0 && removeConfirmOpen}");
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

test("adapts the trip guide hero for one through four available place images", () => {
  expect(workspace).toContain("images.length === 2 && styles.tripGuideCollageTwo");
  expect(workspace).toContain("images.length === 1 && styles.tripGuideCollageImageSingle");
  expect(workspace).toContain("images.length === 2 && styles.tripGuideCollageImageTwo");
  expect(workspace).toContain("images.length === 3 && index === 2 && styles.tripGuideCollageImageWide");
  expect(workspace).toContain("tripGuideCollageTwo: { aspectRatio: 2.9 }");
  expect(workspace).toContain('tripGuideCollageImageWide: { width: "100%" }');
});
