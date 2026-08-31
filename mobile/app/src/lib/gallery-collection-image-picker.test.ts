import { expect, test } from "bun:test";

import { GALLERY_COLLECTION_PICKER_COLUMNS, GALLERY_COLLECTION_PICKER_HISTORY_DEBOUNCE_MS, GALLERY_COLLECTION_PICKER_MAX_SELECTION, GALLERY_COLLECTION_PICKER_RESULT_DEBOUNCE_MS, GALLERY_COLLECTION_PICKER_SKELETON_COUNT, toggleGalleryCollectionImageSelection } from "./gallery-collection-image-picker";

test("defines the collection picker layout and independent search timings", () => {
  expect(GALLERY_COLLECTION_PICKER_COLUMNS).toBe(4);
  expect(GALLERY_COLLECTION_PICKER_SKELETON_COUNT).toBe(4);
  expect(GALLERY_COLLECTION_PICKER_RESULT_DEBOUNCE_MS).toBe(300);
  expect(GALLERY_COLLECTION_PICKER_HISTORY_DEBOUNCE_MS).toBe(800);
});

test("keeps ordered selection, toggles entries, and caps highlights at ten", () => {
  let selection: string[] = [];
  for (let index = 0; index < GALLERY_COLLECTION_PICKER_MAX_SELECTION + 1; index += 1) selection = toggleGalleryCollectionImageSelection(selection, `image-${index}`);
  expect(selection).toEqual(Array.from({ length: 10 }, (_, index) => `image-${index}`));
  expect(toggleGalleryCollectionImageSelection(selection, "image-3")).toEqual(selection.filter((key) => key !== "image-3"));
});
