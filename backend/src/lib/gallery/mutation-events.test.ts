import { describe, expect, test } from 'bun:test';
import { APP_EVENT_SLUGS } from '@/api/event-contract';
import { galleryAssistantMutationOperations } from '@/lib/ai/personal-assistant/gallery-capabilities';
import { GALLERY_CANONICAL_MUTATION_PUBLICATIONS, GALLERY_MUTATION_EVENTS, mutationEventTargets, publishGalleryEvents } from './mutation-events';

describe('Gallery mutation event matrix', () => {
  test('is explicit, product-neutral, and contains only registered payload-free slugs', () => {
    for (const routes of Object.values(GALLERY_MUTATION_EVENTS)) {
      for (const slug of [...routes.collection, ...routes.user]) expect(APP_EVENT_SLUGS).toContain(slug);
    }
    expect(JSON.stringify(GALLERY_MUTATION_EVENTS)).not.toContain('gallery');
  });

  test('exhaustively maps every canonical mutation tool, including deferred worker transitions', () => {
    expect(Object.keys(GALLERY_CANONICAL_MUTATION_PUBLICATIONS).sort()).toEqual([...galleryAssistantMutationOperations, 'reserveUploads', 'completeUploads'].sort());
    expect(galleryAssistantMutationOperations).not.toEqual(expect.arrayContaining(['reserveUploads', 'completeUploads']));
    const mappedEvents = Object.values(GALLERY_CANONICAL_MUTATION_PUBLICATIONS).flatMap(({ events, ...value }) => [...events, ...('deferredEvents' in value ? value.deferredEvents : [])]);
    for (const event of mappedEvents) expect(GALLERY_MUTATION_EVENTS).toHaveProperty(event);
    expect(GALLERY_CANONICAL_MUTATION_PUBLICATIONS.completeUploads).toEqual({
      events: ['uploadQueued'],
      deferredEvents: ['uploadProcessing', 'uploadCompleted', 'uploadFailed', 'uploadCompensated', 'unfiledImageChanged', 'reconcileSubject'],
    });
    expect(GALLERY_CANONICAL_MUTATION_PUBLICATIONS.reserveUploads.events).toEqual(['uploadReserved']);
    expect(GALLERY_CANONICAL_MUTATION_PUBLICATIONS.createHighlight.events).toEqual(['highlightChanged']);
    expect(GALLERY_CANONICAL_MUTATION_PUBLICATIONS.deleteHighlight.events).toEqual(['highlightChanged']);
    expect(GALLERY_CANONICAL_MUTATION_PUBLICATIONS.createMemory.events).toEqual(['memoryCreated']);
    expect(GALLERY_CANONICAL_MUTATION_PUBLICATIONS.deleteMemory.events).toEqual(['memoryDeleted']);
  });

  test.each([
    ['updateCollectionCover', ['collection.content.changed', 'collection.index.changed']],
    ['acceptInvite', ['collection.invites.changed', 'collection.access.changed', 'collection.index.changed']],
    ['uploadCompleted', ['image.changed', 'collection.content.changed', 'collection.index.changed']],
    ['highlightChanged', ['highlight.changed']],
    ['memoryCreated', ['memory.created']],
    ['memoryDeleted', ['memory.deleted']],
  ] as const)('%s publishes its collection cache families', (operation, expected) => {
    expect(mutationEventTargets(operation, { collections: ['collection-1'] }).map(({ event }) => event)).toEqual([...expected]);
  });

  test('deduplicates route, target, and slug and ignores publisher failures', async () => {
    const calls: string[] = [];
    const target = { route: 'collection' as const, key: 'collection-1', event: 'collection.index.changed' as const };
    await expect(publishGalleryEvents([target, target, { route: 'user', key: 'user-1', event: 'upload.changed' }], {
      collection: async (key, event) => { calls.push(`${key}:${event}`); throw new Error('redis unavailable'); },
      user: async (key, event) => { calls.push(`${key}:${event}`); },
    })).resolves.toBeUndefined();
    expect(calls.sort()).toEqual(['collection-1:collection.index.changed', 'user-1:upload.changed']);
  });

  test('deduplicates envelopes rather than users resolved across routes', async () => {
    const calls: string[] = [];
    await publishGalleryEvents([
      { route: 'collection', key: 'collection-1', event: 'collection.index.changed' },
      { route: 'collection', key: 'collection-1', event: 'collection.index.changed' },
      { route: 'user', key: 'user-1', event: 'collection.index.changed' },
    ], {
      collection: async (key, event) => { calls.push(`collection:${key}:${event}`); },
      user: async (key, event) => { calls.push(`user:${key}:${event}`); },
    });
    expect(calls.sort()).toEqual(['collection:collection-1:collection.index.changed', 'user:user-1:collection.index.changed']);
  });
});
