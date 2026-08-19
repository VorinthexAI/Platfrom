import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workspace = readFileSync(join(import.meta.dir, "../components/capability/GalleryWorkspace.tsx"), "utf8");
const highlights = readFileSync(join(import.meta.dir, "../components/capability/GalleryHighlights.tsx"), "utf8");

test("opens persistent highlights from the active collection brain menu", () => {
  expect(workspace).toContain('accessibilityLabel={`AI actions for ${activeCollection.name}`}');
  expect(workspace).toContain('setHighlightsOpen(true)');
  expect(workspace).toContain('>Highlights</BottomSheetItem>');
  expect(workspace).not.toContain('>Create highlight</BottomSheetItem>');
});

test("uses separate full-height grid and player sheets with footer actions", () => {
  expect(highlights).toContain('<BottomSheet footer={listFooter} height="full"');
  expect(highlights).toContain('<BottomSheet footer={playerFooter} height="full"');
  expect(highlights).not.toContain("headerLeading=");
  expect(highlights).toContain('variant="primary">Create</Button>');
  expect(highlights).toContain('variant="secondary">Close</Button>');
  expect(highlights).toContain('accessibilityLabel="Creating highlight"');
  expect(highlights).toContain('const cardWidth = Math.floor((width - spacing.md * 2 - GAP * (COLUMNS - 1)) / COLUMNS)');
  expect(highlights).toContain('height: cardWidth * 16 / 9');
  expect(highlights).toContain('<Button accessibilityLabel="Previous slide"');
  expect(highlights).toContain("<ChevronLeftIcon />");
  expect(highlights).toContain('<PauseIcon variant="inverse" />');
  expect(highlights).toContain('<PlayIcon variant="inverse" />');
  expect(highlights).toContain('<Button accessibilityLabel="Next slide"');
  expect(highlights).toContain("<ChevronRightIcon />");
  expect(highlights).toContain('accessibilityLabel="Open highlight actions"');
  expect(highlights).toContain('<MoreHorizontalIcon size="sm" />');
  expect(highlights).not.toContain("<Pressable");
  expect(highlights).not.toContain("<Touchable");
});

test("uses owner-only creation and a titleless short delete confirmation", () => {
  expect(highlights).toContain("const owner = isGalleryCollectionOwned(collection)");
  expect(highlights).toContain('owner ? <Button disabled={creating || listLoading || opening}');
  expect(highlights).toContain('activeSheet === "actions"');
  expect(highlights).toContain('>Delete highlight</BottomSheetItem>');
  expect(highlights).toContain('activeSheet === "confirmDelete"');
  expect(highlights).toContain('title="Delete highlight?"');
  expect(highlights).toContain("hideHeading");
  expect(highlights).toContain('variant="primary">Delete</Button>');
  expect(highlights).toContain('deleteGalleryCollectionHighlight(highlightKey)');
  expect(highlights).toContain("setDetail(undefined)");
});

test("rotates each incoming slide as a reduced-motion-aware 3D cube face", () => {
  expect(highlights).toContain("useReducedMotion()");
  expect(highlights).toContain("withTiming(1, { duration: 420");
  expect(highlights).toContain("{ perspective: 900 }");
  expect(highlights).toContain("rotateY:");
  expect(highlights).toContain("<Animated.View style={[styles.cubeFace, cubeStyle]}");
});

test("prefetches direct image URLs and pauses playback in the background with timer cleanup", () => {
  expect(highlights).toContain('resolveGalleryHighlightSlides(detail)');
  expect(highlights).toContain('Image.prefetch(url)');
  expect(highlights).toContain('AppState.addEventListener("change"');
  expect(highlights).toContain('if (state !== "active") dispatch({ type: "pause" })');
  expect(highlights).toContain("return () => clearInterval(timer)");
});

test("matches the backend highlight operation routes and event cache family", () => {
  const client = readFileSync(join(import.meta.dir, "gallery-client.ts"), "utf8");
  const convergence = readFileSync(join(import.meta.dir, "gallery-convergence.ts"), "utf8");
  const bridge = readFileSync(join(import.meta.dir, "event-bridge.tsx"), "utf8");
  expect(client).toContain('create: "/gallery/highlights"');
  expect(client).toContain('list: "/gallery/highlights/list"');
  expect(client).toContain('detail: "/gallery/highlights/read"');
  expect(client).toContain('delete: "/gallery/highlights/delete"');
  expect(convergence).toContain('"highlight.changed": ["highlights"]');
  expect(bridge).toContain('families.has("highlights")');
  expect(highlights).toContain('["highlight.changed", "image.changed", "collection.content.changed"].includes(event.slug)');
  expect(highlights).toContain('if (detail) void openHighlight(detail)');
});

test("does not route assistant Gallery mutations through text search", () => {
  const guard = workspace.indexOf("if (!shouldRunGalleryAssistantTextSearch(assistantResult))");
  const search = workspace.indexOf("const searchResult = await searchGalleryImages", guard);
  expect(guard).toBeGreaterThan(0);
  expect(search).toBeGreaterThan(guard);
});
