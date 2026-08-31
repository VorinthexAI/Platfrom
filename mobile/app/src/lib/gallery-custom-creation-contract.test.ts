import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const picker = readFileSync(join(import.meta.dir, "../components/capability/GalleryCollectionImagePicker.tsx"), "utf8");
const highlights = readFileSync(join(import.meta.dir, "../components/capability/GalleryHighlights.tsx"), "utf8");
const memories = readFileSync(join(import.meta.dir, "../components/capability/GalleryMemories.tsx"), "utf8");

test("offers the shared Random and Custom creation menu for highlights and memories", () => {
  for (const source of [highlights, memories]) {
    expect(source).toContain(">Random</BottomSheetItem>");
    expect(source).toContain(">Custom</BottomSheetItem>");
    expect(source).toContain("<GalleryCollectionImagePicker");
    expect(source).toContain('open={open && !detail} title=');
    expect(source).not.toContain('open={open && !detail && !createMenuOpen && !customCreateOpen}');
  }
});

test("uses canonical collection search with separate result and successful history requests", () => {
  expect(picker).toContain("GALLERY_COLLECTION_PICKER_RESULT_DEBOUNCE_MS");
  expect(picker).toContain("GALLERY_COLLECTION_PICKER_HISTORY_DEBOUNCE_MS");
  expect(picker).toContain("recordHistory: false");
  expect(picker).toContain("recordHistory: true");
  expect(picker).toContain("...(collectionKey ? { collectionKey } : {})");
  expect(picker).toContain("searchController.current?.abort()");
  expect(picker).toContain("generation === searchGeneration.current");
  expect(picker).toMatch(/function changeQuery[\s\S]*?setLoading\(true\);[\s\S]*?setImages\(\[\]\);/);
  expect(picker).toContain("getUserSearchHistory(queryClient, context)");
  expect(picker).toContain("<SearchHistorySheet");
});

test("renders four skeletons, collection filters, selection treatment, and bounded highlight creation", () => {
  expect(picker).toContain("GALLERY_COLLECTION_PICKER_SKELETON_COUNT");
  expect(picker).toContain('style={[styles.imageFrame, selected && styles.imageFrameSelected]}');
  expect(picker).toContain('<CheckIcon size="sm" variant="inverse" />');
  expect(picker).toContain('disabled={selectedKeys.length < (minSelection ?? 2)}');
  expect(picker).toContain("Favorites</Text>");
  expect(picker).toContain("Show hidden</Text>");
  expect(highlights).toContain("createHighlight(imageKeys)");
  expect(highlights).toContain("Tap to select 2–10 images");
});

test("single selection closes the picker and immediately starts memory creation", () => {
  expect(picker).toContain('if (mode === "single") { onSelect([imageKey], image ? [image] : []); return; }');
  const callback = memories.slice(memories.indexOf("onSelect={([imageKey])"));
  expect(callback.indexOf("setCustomCreateOpen(false)")).toBeLessThan(callback.indexOf("void createMemory(imageKey)"));
  expect(memories).toContain("createRequest.current += 1");
  expect(memories).toContain("generation !== createRequest.current || !open");
});
