import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workspace = readFileSync(join(import.meta.dir, "../components/capability/GalleryWorkspace.tsx"), "utf8");
const memories = readFileSync(join(import.meta.dir, "../components/capability/GalleryMemories.tsx"), "utf8");

test("places Memories first in the member-visible collection AI menu", () => {
  const start = workspace.indexOf('{activeSheet === "cleanupMenu" ? <>');
  const menu = workspace.slice(start, workspace.indexOf('activeSheet === "imageActions"', start));
  expect(menu.indexOf(">Memories</BottomSheetItem>")).toBeGreaterThan(0);
  expect(menu.indexOf(">Memories</BottomSheetItem>")).toBeLessThan(menu.indexOf(">Highlights</BottomSheetItem>"));
  expect(menu.indexOf(">Highlights</BottomSheetItem>")).toBeLessThan(menu.indexOf("{isCollectionOwner ?"));
  expect(workspace).toContain("setMemoriesOpen(true)");
});

test("uses four-column full sheets, exact-open freshness, and owner-only creation", () => {
  expect(memories).toContain("const COLUMNS = 4");
  expect(memories).toContain("Array.from({ length: 4 }");
  expect(memories).toContain('<BottomSheet footer={listFooter} height="full"');
  expect(memories).toContain('<BottomSheet footer={detailFooter} height="full"');
  expect(memories).toContain('staleTime: 0');
  expect(memories).toContain('exact: true, refetchType: "none"');
  expect(memories).toContain('owner ? <Button disabled={creating || listLoading || opening}');
  expect(memories).toContain('notify("Memory created")');
  expect(memories.indexOf('{creating ?')).toBeLessThan(memories.indexOf('memories.map((memory)'));
});

test("guards auto-open and preserves typing across zoom and event refresh", () => {
  expect(memories).toContain('const listSheetOpen = useRef(open && !detail && !opening && activeSheet === "list")');
  expect(memories).toContain('listSheetOpen.current = open && !detail && !opening && activeSheet === "list"');
  expect(memories).toContain("if (listSheetOpen.current) void openMemory(memory)");
  expect(memories).toContain("listSheetOpen.current = false");
  expect(memories).toContain("restartTyping(result.memory.text)");
  expect(memories).toContain("if (detail) void refreshDetail(detail.key)");
  expect(memories).toContain('"memory.created", "memory.deleted", "image.changed", "collection.content.changed"');
  expect(memories).toContain('showImage ? "Read memory" : "Show image"');
  expect(memories).toContain("useReducedMotion()");
});

test("matches bulk partial deletion and hard-removes detail caches", () => {
  expect(memories).toContain("Promise.allSettled(memoryKeys.map((memoryKey) => deleteGalleryCollectionMemory(memoryKey, collection.key)))");
  expect(memories).toContain('disabled={creating || opening || deleting}');
  expect(memories).toContain('onPress={() => { listSheetOpen.current = false; setActiveSheet("confirmDelete"); }}');
  expect(memories).toContain("queryClient.removeQueries({ queryKey: galleryQueryKeys.memory");
  expect(memories).toContain('title="Delete selected memories?"');
  expect(memories).not.toContain("<Pressable");
});

test("bridges memory events into the memory cache family", () => {
  const convergence = readFileSync(join(import.meta.dir, "gallery-convergence.ts"), "utf8");
  const bridge = readFileSync(join(import.meta.dir, "event-bridge.tsx"), "utf8");
  expect(convergence).toContain('"memory.created": ["memories"]');
  expect(convergence).toContain('"memory.deleted": ["memories"]');
  expect(bridge).toContain('families.has("memories")');
  expect(bridge).toContain('[...root, "memories"]');
});

test("uses the global memory projection without collection membership or unsafe image fields", () => {
  const client = readFileSync(join(import.meta.dir, "gallery-client.ts"), "utf8");
  const start = client.indexOf("export type GalleryMemory = {");
  const projection = client.slice(start, client.indexOf("};", start) + 2);
  expect(projection).not.toContain("collectionKey");
  expect(projection).toContain("image: { key: string; url: string }");
  expect(projection).not.toContain("GalleryImage");
  expect(client).toContain("createGalleryCollectionMemory(collectionKey: string)");
  expect(client).toContain("listGalleryCollectionMemories(collectionKey: string)");
  expect(client).toContain("deleteGalleryCollectionMemory(memoryKey: string, collectionKey: string)");
  expect(client).toContain("{ memoryKey, collectionKey }");
});

test("guards highlight post-create auto-open with the current list sheet ref", () => {
  const highlights = readFileSync(join(import.meta.dir, "../components/capability/GalleryHighlights.tsx"), "utf8");
  expect(highlights).toContain('const listSheetOpen = useRef(open && !detail && !opening && activeSheet === "player")');
  expect(highlights).toContain('listSheetOpen.current = open && !detail && !opening && activeSheet === "player"');
  expect(highlights).toContain("if (listSheetOpen.current) void openHighlight(highlight)");
  expect(highlights).toContain('disabled={creating || opening || deleting}');
  expect(highlights).toContain('onPress={() => { listSheetOpen.current = false; setActiveSheet("confirmDelete"); }}');
});
