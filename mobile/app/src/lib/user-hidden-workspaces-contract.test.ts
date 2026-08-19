import { expect, test } from "bun:test";

const gallery = await Bun.file(new URL("../components/capability/GalleryWorkspace.tsx", import.meta.url)).text();
const archive = await Bun.file(new URL("../components/capability/KnowledgeWorkspace.tsx", import.meta.url)).text();
const auth = await Bun.file(new URL("../state/auth.ts", import.meta.url)).text();
const authHelpers = await Bun.file(new URL("./auth-helpers.ts", import.meta.url)).text();

test("keeps independent favorite and hidden filters local to each workspace", () => {
  for (const source of [gallery, archive]) {
    expect(source).toContain('useState<HiddenViewFilters>({ favoritesOnly: false, showHidden: false })');
    expect(source).toContain('({ ...current, favoritesOnly: checked })');
    expect(source).toContain('({ ...current, showHidden: checked })');
  }
  expect(auth).not.toContain("ShowOnlyFavorites");
  expect(auth).not.toContain("/auth/me/settings");
  expect(authHelpers).not.toContain("showOnlyFavorites");
});

test("uses one wrapping Gallery-style active badge row in all filtered surfaces", () => {
  for (const source of [gallery, archive]) {
    expect(source).toContain('filterBadgeRow: { flexDirection: "row", flexWrap: "wrap"');
    expect(source).toContain('similarPill: { alignSelf: "flex-start", maxWidth: "100%", minHeight: 38');
    expect(source).toContain('>Favorites</Text>');
    expect(source).toContain('>Show hidden</Text>');
  }
  expect(gallery.match(/\{filterBadges\(true\)\}/g)).toHaveLength(2);
  expect(gallery.match(/\{filterBadges\(\)\}/g)?.length).toBeGreaterThanOrEqual(2);
  expect(archive.match(/\{filterBadges\}/g)?.length).toBeGreaterThanOrEqual(5);
});

test("places hide and reveal immediately before destructive Gallery actions", () => {
  const collectionMenuStart = gallery.lastIndexOf('{activeSheet === "collectionMenu"');
  const collectionMenu = gallery.slice(collectionMenuStart, gallery.indexOf('{activeSheet === "cleanupMenu"', collectionMenuStart));
  expect(collectionMenu.indexOf('? "Reveal" : "Hide"')).toBeLessThan(collectionMenu.indexOf('>Delete collection</BottomSheetItem>'));
  expect(collectionMenu.indexOf('? "Reveal" : "Hide"')).toBeLessThan(collectionMenu.indexOf('>Leave</BottomSheetItem>'));
  const imageMenuStart = gallery.lastIndexOf('{activeSheet === "imageActions" && selectedImage');
  const imageMenu = gallery.slice(imageMenuStart, gallery.indexOf('{activeSheet === "imageEdit"', imageMenuStart));
  expect(imageMenu.indexOf('? "Reveal" : "Hide"')).toBeLessThan(imageMenu.indexOf('>Delete image</BottomSheetItem>'));
  expect(imageMenu).toContain('setHiddenOptimistically("image"');
});

test("places hide and reveal immediately before destructive Archive actions", () => {
  const documentMenuStart = archive.lastIndexOf('{activeSheet === "documentActions" && selectedDocument');
  const documentMenu = archive.slice(documentMenuStart, archive.indexOf('{activeSheet === "scanSources"', documentMenuStart));
  expect(documentMenu.indexOf('? "Reveal" : "Hide"')).toBeLessThan(documentMenu.indexOf('>Delete {selectedDocument.extension ? "file" : "document"}</BottomSheetItem>'));
  const folderMenuStart = archive.lastIndexOf('{activeSheet === "folderActions" && selectedFolder');
  const folderMenu = archive.slice(folderMenuStart, archive.indexOf('{activeSheet === "folderDetails"', folderMenuStart));
  expect(folderMenu.indexOf('? "Reveal" : "Hide"')).toBeLessThan(folderMenu.indexOf('>Delete folder</BottomSheetItem>'));
});

test("optimistically patches only overlays and rolls back before convergence invalidation", () => {
  for (const source of [gallery, archive]) {
    const mutation = source.slice(source.indexOf("function setHiddenOptimistically"), source.indexOf("function", source.indexOf("function setHiddenOptimistically") + 10));
    expect(mutation).toContain("setUserHiddens(next)");
    expect(mutation).toContain("closeSheet()");
    expect(mutation.indexOf("notify(`${label}")).toBeLessThan(mutation.indexOf("hideUserSource(source, sourceKey)"));
    expect(mutation).toContain("setUserHiddens(previous)");
    expect(mutation.includes("userHiddens(contentContext)") || mutation.includes("userHiddens(galleryContext)")).toBe(true);
  }
  expect(gallery.slice(gallery.indexOf("function setHiddenOptimistically"), gallery.indexOf("function", gallery.indexOf("function setHiddenOptimistically") + 10))).not.toContain("removeCachedGalleryImages");
  expect(archive.slice(archive.indexOf("function setHiddenOptimistically"), archive.indexOf("function", archive.indexOf("function setHiddenOptimistically") + 10))).not.toContain("removeCachedContent");
});
