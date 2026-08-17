import { expect, test } from "bun:test";

const source = await Bun.file(new URL("../components/capability/GalleryWorkspace.tsx", import.meta.url)).text();

test("keeps image similarity collection-scoped and outside the image footer", () => {
  const footer = source.slice(source.indexOf('const sheetFooter ='), source.indexOf('return (', source.indexOf('const sheetFooter =')));
  expect(footer).not.toContain("Find similar");
  expect(source).toContain("imageKey: source.key, collectionKey: collection.key");
  expect(source).toContain("Similar to {similarSource.filename}");
  expect(source.indexOf(">Find similar image<")).toBeLessThan(source.indexOf(">Delete image<"));
});

test("uses four-column cursor grids and one skeleton row for initial and append loading", () => {
  expect(source).toContain("const IMAGE_COLUMNS = 4");
  expect(source).toContain("fetchGalleryOverview(collectionKey, cursor)");
  expect(source).toContain("Array.from({ length: IMAGE_COLUMNS }");
  expect(source).toContain("loadingMore ? Array.from({ length: IMAGE_COLUMNS }");
});

test("provides edit and confirmed delete flows for images and collections", () => {
  expect(source).toContain('pushSheet("confirmDeleteImage")');
  expect(source).toContain('pushSheet("confirmDeleteCollection")');
  expect(source).toContain('activeSheet === "imageEdit"');
  expect(source).toContain('activeSheet === "collectionEdit"');
  expect(source).toContain('activeSheet === "duplicates"');
});

test("uses a singleton collection cache and removes root Gallery search", () => {
  expect(source).toContain("getGalleryCollections(queryClient");
  expect(source).toContain("setCachedGalleryCollections");
  expect(source).not.toContain('accessibilityLabel="Search Gallery collections and images"');
});

test("provides the full visual identity library and image picker workflow", () => {
  expect(source).toContain('activeSheet === "visualIdentities"');
  expect(source).toContain('activeSheet === "identityPicker"');
  expect(source).toContain("Choose an image to create a visual identity from.");
  expect(source).toContain("Visual identities</Button>");
  expect(source).toContain("createGallerySubject(name, [image.key])");
  expect(source).toContain("identityKey: identity.key");
  expect(source).toContain("creatingIdentityKeys.includes(identity.key)");
});
