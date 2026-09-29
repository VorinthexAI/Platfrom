export type GalleryRepository = {
  ensureGeneratedMediaCollection: (...args: unknown[]) => Promise<{ key: string } | null>;
};
export function getDefaultGalleryRepository(): GalleryRepository {
  return { async ensureGeneratedMediaCollection() { return null; } };
}
