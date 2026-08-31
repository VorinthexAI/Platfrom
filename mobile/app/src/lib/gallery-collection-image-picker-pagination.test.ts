import { expect, test } from "bun:test";

import { appendGalleryCollectionPickerPage, GALLERY_COLLECTION_PICKER_SKELETON_COUNT } from "./gallery-collection-image-picker";

test("appends cursor pages in order without duplicate images", () => {
  expect(appendGalleryCollectionPickerPage([{ key: "one" }, { key: "two" }], [{ key: "two" }, { key: "three" }])).toEqual([{ key: "one" }, { key: "two" }, { key: "three" }]);
  expect(GALLERY_COLLECTION_PICKER_SKELETON_COUNT).toBe(4);
});
