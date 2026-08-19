import type { GalleryEventSlug } from "./gallery-convergence";

export type AppEvent =
  | { type: "gallery.changed"; slug: GalleryEventSlug }
  | { type: "event-stream.connected" };

const listeners = new Set<(event: AppEvent) => void>();

export function publishAppEvent(event: AppEvent) {
  for (const listener of listeners) listener(event);
}

export function subscribeAppEvent(listener: (event: AppEvent) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
