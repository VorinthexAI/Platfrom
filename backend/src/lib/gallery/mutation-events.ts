import { publishCollectionEvent, publishUserEvent, type AppEventSlug } from '@/api/events';
import type { GalleryOperationName } from './operations';

export const GALLERY_MUTATION_EVENTS = {
  createCollection: { collection: ['collection.index.changed'], user: [] },
  updateCollection: { collection: ['collection.index.changed'], user: [] },
  updateCollectionCover: { collection: ['collection.content.changed', 'collection.index.changed'], user: [] },
  deleteCollection: { collection: [], user: ['collection.index.changed'] },
  setFavorite: { collection: ['image.changed'], user: [] },
  updateImage: { collection: ['image.changed'], user: [] },
  unfiledImageChanged: { collection: [], user: ['image.changed'] },
  deleteImages: { collection: ['image.changed', 'collection.content.changed', 'collection.index.changed'], user: [] },
  deleteDuplicates: { collection: ['image.changed', 'collection.content.changed', 'collection.index.changed'], user: [] },
  transferCollectionImages: { collection: ['collection.content.changed', 'collection.index.changed'], user: [] },
  uploadReserved: { collection: [], user: ['upload.changed'] },
  uploadQueued: { collection: [], user: ['upload.changed'] },
  uploadProcessing: { collection: [], user: ['upload.changed'] },
  uploadCompleted: { collection: ['image.changed', 'collection.content.changed', 'collection.index.changed'], user: ['upload.changed'] },
  uploadFailed: { collection: [], user: ['upload.changed'] },
  uploadCompensated: { collection: ['image.changed', 'collection.content.changed', 'collection.index.changed'], user: ['image.changed'] },
  createSubject: { collection: [], user: ['subject.changed'] },
  deleteSubject: { collection: [], user: ['subject.changed'] },
  reconcileSubject: { collection: [], user: ['subject.changed'] },
  highlightChanged: { collection: ['highlight.changed'], user: [] },
  memoryCreated: { collection: ['memory.created'], user: [] },
  memoryDeleted: { collection: ['memory.deleted'], user: [] },
} as const satisfies Record<string, { collection: readonly AppEventSlug[]; user: readonly AppEventSlug[] }>;

export type GalleryMutationEventName = keyof typeof GALLERY_MUTATION_EVENTS;

export const GALLERY_CANONICAL_MUTATION_PUBLICATIONS = {
  createCollection: { events: ['createCollection'] },
  updateCollection: { events: ['updateCollection', 'updateCollectionCover'] },
  deleteCollection: { events: ['deleteCollection'] },
  reserveUploads: { events: ['uploadReserved'] },
  completeUploads: { events: ['uploadQueued'], deferredEvents: ['uploadProcessing', 'uploadCompleted', 'uploadFailed', 'uploadCompensated', 'unfiledImageChanged', 'reconcileSubject'] },
  setFavorite: { events: ['setFavorite', 'unfiledImageChanged'] },
  updateImage: { events: ['updateImage', 'unfiledImageChanged'] },
  deleteImages: { events: ['deleteImages', 'unfiledImageChanged', 'reconcileSubject'] },
  deleteDuplicates: { events: ['deleteDuplicates'] },
  transferCollectionImages: { events: ['transferCollectionImages'] },
  createSubject: { events: ['createSubject'] },
  deleteSubject: { events: ['deleteSubject'] },
  createHighlight: { events: ['highlightChanged'] },
  deleteHighlight: { events: ['highlightChanged'] },
  createMemory: { events: ['memoryCreated'] },
  deleteMemory: { events: ['memoryDeleted'] },
} as const satisfies Partial<Record<GalleryOperationName, { events: readonly GalleryMutationEventName[]; deferredEvents?: readonly GalleryMutationEventName[] }>>;
export type GalleryEventTarget = { route: 'collection' | 'user'; key: string; event: Exclude<AppEventSlug, 'spark.balance.required'> };

export async function publishGalleryEvents(
  targets: Iterable<GalleryEventTarget>,
  publishers: { collection?: typeof publishCollectionEvent; user?: typeof publishUserEvent } = {},
) {
  const collectionPublisher = publishers.collection ?? publishCollectionEvent;
  const userPublisher = publishers.user ?? publishUserEvent;
  // Deduplicate transport envelopes only. Different routes may intentionally
  // resolve to the same connected user, and clients coalesce those invalidations.
  const unique = new Map<string, GalleryEventTarget>();
  for (const target of targets) unique.set(`${target.route}\0${target.key}\0${target.event}`, target);
  await Promise.all([...unique.values()].map((target) => Promise.resolve().then(() => target.route === 'collection'
    ? collectionPublisher(target.key, target.event)
    : userPublisher(target.key, target.event)).catch(() => undefined)));
}

export function mutationEventTargets(
  operation: GalleryMutationEventName,
  targets: { collections?: Iterable<string>; users?: Iterable<string> },
) {
  const events = GALLERY_MUTATION_EVENTS[operation];
  return [
    ...[...(targets.collections ?? [])].flatMap((key) => events.collection.map((event) => ({ route: 'collection' as const, key, event }))),
    ...[...(targets.users ?? [])].flatMap((key) => events.user.map((event) => ({ route: 'user' as const, key, event }))),
  ];
}
