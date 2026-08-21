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
  const cleanupStart = workspace.indexOf('{activeSheet === "cleanupMenu" ? <>');
  const cleanupMenu = workspace.slice(cleanupStart, workspace.indexOf('activeSheet === "imageActions"', cleanupStart));
  expect(cleanupMenu).toContain('>Highlights</BottomSheetItem>');
  expect(cleanupMenu.indexOf('>Highlights</BottomSheetItem>')).toBeLessThan(cleanupMenu.indexOf('{isCollectionOwner ?'));
});

test("uses separate full-height grid and player sheets with footer actions", () => {
  expect(highlights).toContain('<BottomSheet footer={listFooter} height="full"');
  expect(highlights).toContain('<BottomSheet footer={playerFooter} height="full"');
  expect(highlights).not.toContain("headerLeading=");
  expect(highlights).toContain('variant="primary">Create</Button>');
  expect(highlights).toContain('variant="secondary">Close</Button>');
  expect(highlights).toContain('accessibilityLabel="Creating highlight"');
  expect(highlights).toContain('setHighlights((current) => [...current.filter(({ key }) => key !== highlight.key), highlight])');
  expect(highlights).toContain('setCreating(false)');
  expect(highlights).toContain('notify("Highlight created")');
  expect(highlights).not.toContain('skeletonUntil');
  expect(highlights).not.toContain('finishSkeleton');
  expect(highlights.indexOf('{creating ?')).toBeLessThan(highlights.indexOf('highlights.map((highlight)'));
  expect(highlights).toContain('Skeleton style={[styles.cardFrame, { width: cardWidth, height: cardWidth * 16 / 9 }]}');
  expect(highlights).toContain('style={[styles.cardFrame, styles.card, selected && styles.cardSelected, { width: cardWidth, height: cardWidth * 16 / 9 }]}');
  expect(highlights).toContain('cardFrame: { overflow: "hidden", borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.sm, backgroundColor: palette.panelRaised }');
  expect(highlights).toContain("useToast()");
  expect(highlights).toContain('notify("Highlights could not be loaded")');
  expect(highlights).toContain('void loadList(true)');
  expect(highlights).toContain('invalidateQueries({ queryKey: galleryQueryKeys.highlights(galleryContext, collection.key), exact: true, refetchType: "none" })');
  expect(highlights).not.toContain('style={styles.error}');
  expect(highlights).toContain('contentContainerStyle={[styles.grid, listEmpty && styles.emptyGrid]}');
  expect(highlights).toContain('emptyGrid: { flexGrow: 1, alignItems: "center", justifyContent: "center" }');
  expect(highlights).toContain('const cardWidth = Math.floor(((gridWidth || width - 40) - GAP * (COLUMNS - 1)) / COLUMNS)');
  expect(highlights).toContain('onLayout={({ nativeEvent }) => setGridWidth(nativeEvent.layout.width)}');
  expect(highlights).toContain('height: cardWidth * 16 / 9');
  expect(highlights).toContain('<Button accessibilityLabel="Previous slide"');
  expect(highlights).toContain("<ChevronLeftIcon />");
  expect(highlights).toContain('<PauseIcon variant="inverse" />');
  expect(highlights).toContain('<PlayIcon variant="inverse" />');
  expect(highlights).toContain('<Button accessibilityLabel="Next slide"');
  expect(highlights).toContain("<ChevronRightIcon />");
  expect(highlights).not.toContain('accessibilityLabel="Open highlight actions"');
  expect(highlights).not.toContain('MoreHorizontalIcon');
  expect(highlights).not.toContain('detailMenuRow');
  expect(highlights).not.toContain("<Pressable");
  expect(highlights).not.toContain("<Touchable");
});

test("uses owner-only creation and long-press bulk deletion from the grid", () => {
  expect(highlights).toContain("const owner = isGalleryCollectionOwned(collection)");
  expect(highlights).toContain('owner ? <Button disabled={creating || listLoading || opening}');
  expect(highlights).toContain('onLongPress={owner ? () => handleHighlightLongPress(highlight.key) : undefined}');
  expect(highlights).toContain('accessibilityActions={owner ? [{ name: "longpress"');
  expect(highlights).toContain('onAccessibilityAction={owner ?');
  expect(highlights).toContain('accessibilityState={{ selected }}');
  expect(highlights).toContain('<CheckIcon size="sm" variant="inverse" />');
  expect(highlights).toContain('accessibilityLabel="Clear highlight selection"');
  expect(highlights).toContain('style={styles.bulkDeleteAction} variant="secondary">Delete</Button>');
  expect(highlights).not.toContain('activeSheet === "actions"');
  expect(highlights).not.toContain('BottomSheetItem');
  expect(highlights).toContain('activeSheet === "confirmDelete"');
  expect(highlights).toContain('title={`Delete ${selectedHighlightKeys.length === 1 ? "highlight" : `${selectedHighlightKeys.length} highlights`}?`}');
  expect(highlights).not.toContain('dismissible={!deleting} hideHeading');
  expect(highlights).toContain('size="md" variant="primary">Delete</Button>');
  expect(highlights).toContain("finally {\n      if (generation === createRequest.current) setCreating(false);");
  expect(highlights).toContain("createRequest.current += 1; setCreating(false);");
  expect(highlights).toContain("if (!open || creating || deleting || opening) return;");
  expect(highlights).toContain("const listRequest = useRef(0);");
  expect(highlights).toContain("const detailRequest = useRef(0);");
  expect(highlights).toContain('Promise.allSettled(highlightKeys.map((highlightKey) => deleteGalleryCollectionHighlight(highlightKey)))');
  expect(highlights).toContain('size="md" variant="secondary">Close</Button>');
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
  expect(client).toContain('list: "/gallery/highlights"');
  expect(client).toContain('apiClient.get<ApiResponse<{ highlights: GalleryHighlightProjection[] }>>');
  expect(client).toContain('detail: "/gallery/highlights/read"');
  expect(client).toContain('delete: "/gallery/highlights/delete"');
  expect(convergence).toContain('"highlight.changed": ["highlights"]');
  expect(bridge).toContain('families.has("highlights")');
  expect(highlights).toContain('["highlight.changed", "image.changed", "collection.content.changed"].includes(event.slug)');
  expect(highlights).toContain('event.type !== "gallery.changed"');
  expect(highlights).toContain('if (detail) void openHighlight(detail)');
  expect(highlights).toContain('event.type !== "event-stream.connected"');
});

test("does not route assistant Gallery mutations through text search", () => {
  const guard = workspace.indexOf("if (!shouldRunGalleryAssistantTextSearch(assistantResult))");
  const search = workspace.indexOf("const searchResult = await searchGalleryImages", guard);
  expect(guard).toBeGreaterThan(0);
  expect(search).toBeGreaterThan(guard);
});
