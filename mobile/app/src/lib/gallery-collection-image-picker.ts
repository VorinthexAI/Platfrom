export const GALLERY_COLLECTION_PICKER_COLUMNS = 4;
export const GALLERY_COLLECTION_PICKER_MAX_SELECTION = 10;
export const GALLERY_COLLECTION_PICKER_RESULT_DEBOUNCE_MS = 300;
export const GALLERY_COLLECTION_PICKER_HISTORY_DEBOUNCE_MS = 800;
export const GALLERY_COLLECTION_PICKER_SKELETON_COUNT = 4;

export function toggleGalleryCollectionImageSelection(current: string[], imageKey: string, maxSelection = GALLERY_COLLECTION_PICKER_MAX_SELECTION) {
  if (current.includes(imageKey)) return current.filter((key) => key !== imageKey);
  return current.length < maxSelection ? [...current, imageKey] : current;
}

export function appendGalleryCollectionPickerPage<T extends { key: string }>(current: T[], page: T[]) {
  const keys = new Set(current.map(({ key }) => key));
  return [...current, ...page.filter(({ key }) => !keys.has(key))];
}
