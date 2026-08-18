import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workspace = readFileSync(join(import.meta.dir, "../components/capability/GalleryWorkspace.tsx"), "utf8");
const highlights = readFileSync(join(import.meta.dir, "../components/capability/GalleryHighlights.tsx"), "utf8");

test("puts persistent highlight actions in the active collection brain menu", () => {
  expect(workspace).toContain('accessibilityLabel={`AI actions for ${activeCollection.name}`}');
  expect(workspace).toContain('setHighlightMode("create")');
  expect(workspace).toContain('>Create highlight</BottomSheetItem>');
  expect(workspace).toContain('setHighlightMode("list")');
  expect(workspace).toContain('>Highlights</BottomSheetItem>');
});

test("uses full-height shared sheets, shared controls, and responsive portrait cards", () => {
  expect(highlights).toContain('<BottomSheet headerLeading={back} height="full"');
  expect(highlights).toContain('const cardWidth = Math.floor((width - spacing.md * 2 - GAP * (COLUMNS - 1)) / COLUMNS)');
  expect(highlights).toContain('height: cardWidth * 16 / 9');
  expect(highlights).toContain('<Button accessibilityLabel="Previous slide"');
  expect(highlights).toContain('<PauseIcon variant="inverse" />');
  expect(highlights).toContain('<PlayIcon variant="inverse" />');
  expect(highlights).toContain('<Button accessibilityLabel="Next slide"');
  expect(highlights).not.toContain("<Pressable");
  expect(highlights).not.toContain("<Touchable");
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
