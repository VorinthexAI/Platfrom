import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { projectToolResultRetrieval } from './tool-retrieval';

describe('conversation tool result retrieval capture', () => {
  test('captures created and updated resources as query-free result retrievals', () => {
    const folderKey = newId();
    expect(projectToolResultRetrieval('folder.create', { key: folderKey, scopeKey: newId(), name: 'Research', isFavorite: false })).toEqual({
      source: 'results', limit: 10, minimumScore: 0.55, groups: [{ collectionSlug: 'folders', results: [{ key: folderKey, label: 'Research' }] }],
    });
    const documentKey = newId();
    expect(projectToolResultRetrieval('document.update', { key: documentKey, name: 'XYZ', extension: 'md' })).toEqual({
      source: 'results', limit: 10, minimumScore: 0.55, groups: [{ collectionSlug: 'documents', results: [{ key: documentKey, label: 'XYZ' }] }],
    });
  });

  test('captures list outputs from matching container fields and ignores other resource kinds', () => {
    const first = newId(), second = newId(), third = newId(), imageKey = newId();
    const retrieval = projectToolResultRetrieval('collection.list', {
      collections: [{ key: first, name: 'City After Rain', description: null }, { key: second, name: '   ' }, { key: third, name: 'Coastal Days' }],
      images: [{ key: imageKey, filename: 'not-a-collection.jpg' }],
      nextCursor: null,
    });
    expect(retrieval).toEqual({
      source: 'results', limit: 10, minimumScore: 0.55,
      groups: [{ collectionSlug: 'collections', results: [{ key: first, label: 'City After Rain' }, { key: second, label: 'Collection' }, { key: third, label: 'Coastal Days' }] }],
    });
    expect(JSON.stringify(retrieval)).not.toContain(imageKey);
  });

  test('captures a single trip without recursing into nested places', () => {
    const tripKey = newId();
    const retrieval = projectToolResultRetrieval('trip.create', { key: tripKey, name: 'Spring trip', status: 'planned', places: [{ key: newId(), name: 'Paris', kind: 'place' }] })!;
    expect(retrieval).toEqual({ source: 'results', limit: 10, minimumScore: 0.55, groups: [{ collectionSlug: 'trips', results: [{ key: tripKey, label: 'Spring trip' }] }] });
  });

  test('captures email drafts with connector context for navigation', () => {
    const draftKey = newId(), connectorKey = newId();
    const retrieval = projectToolResultRetrieval('email.draft.create', { key: draftKey, variant: 'new', connectorKey, subject: 'Q3 plan', generatedContent: 'body', status: 'generated' })!;
    expect(retrieval).toEqual({ source: 'results', limit: 10, minimumScore: 0.55, filters: { connectorKey }, groups: [{ collectionSlug: 'email-drafts', results: [{ key: draftKey, label: 'Q3 plan', destinationKey: connectorKey }] }] });
  });

  test('captures countries by country code', () => {
    expect(projectToolResultRetrieval('country.search', [{ name: 'France', countryCode: 'FR', latitude: 46, longitude: 2 }])).toEqual({
      source: 'results', limit: 10, minimumScore: 0.55, groups: [{ collectionSlug: 'countries', results: [{ key: 'FR', label: 'France' }] }],
    });
  });

  test('captures nothing for deletions, non-resource tools, unknown slugs, and empty results', () => {
    expect(projectToolResultRetrieval('folder.delete', { deletedKey: newId() })).toBeNull();
    expect(projectToolResultRetrieval('image.remove', { key: newId() })).toBeNull();
    expect(projectToolResultRetrieval('collection.member.list', { members: [{ key: newId(), name: 'Someone' }] })).toBeNull();
    expect(projectToolResultRetrieval('collection.invite.create', { key: newId(), name: 'Invite' })).toBeNull();
    expect(projectToolResultRetrieval('collection.share.update', { key: newId(), name: 'Share' })).toBeNull();
    expect(projectToolResultRetrieval('image.memory.read', { key: newId(), name: 'Memory' })).toBeNull();
    expect(projectToolResultRetrieval('web.search', { results: [{ key: newId(), name: 'Page' }] })).toBeNull();
    expect(projectToolResultRetrieval('agent.query', { answer: 'no resources' })).toBeNull();
    expect(projectToolResultRetrieval('folder.create', { name: 'No key' })).toBeNull();
    expect(projectToolResultRetrieval('collection.list', { collections: [], images: [] })).toBeNull();
    expect(projectToolResultRetrieval('folder.create', null)).toBeNull();
  });

  test('dedupes keys, falls back to kind labels, and caps results per group', () => {
    const key = newId();
    expect(projectToolResultRetrieval('folder.update', [{ key, name: 'Same' }, { key, name: 'Same' }, { key: newId(), name: '  ' }])!.groups[0]!.results).toHaveLength(2);
    const many = Array.from({ length: 80 }, (_, index) => ({ key: newId(), name: `Folder ${index}` }));
    expect(projectToolResultRetrieval('folder.list', { folders: many })!.groups[0]!.results).toHaveLength(50);
  });

  test('captures books by title and images by filename fallback', () => {
    const bookKey = newId(), imageKey = newId();
    expect(projectToolResultRetrieval('book.create', { key: bookKey, title: 'Clear Decisions', description: 'Guide', status: 'ready' })).toEqual({
      source: 'results', limit: 10, minimumScore: 0.55, groups: [{ collectionSlug: 'books', results: [{ key: bookKey, label: 'Clear Decisions' }] }],
    });
    expect(projectToolResultRetrieval('image.update', { key: imageKey, filename: 'shore.jpg', caption: '   ', isFavorite: true })).toEqual({
      source: 'results', limit: 10, minimumScore: 0.55, groups: [{ collectionSlug: 'images', results: [{ key: imageKey, label: 'shore.jpg' }] }],
    });
  });

  test('captures email tones and inboxes with connector destinations', () => {
    const toneKey = newId(), inboxKey = newId(), connectorKey = newId();
    expect(projectToolResultRetrieval('email.tone.create', { key: toneKey, name: 'Warm', instruction: 'Be warm' })).toEqual({
      source: 'results', limit: 10, minimumScore: 0.55, groups: [{ collectionSlug: 'email-tones', results: [{ key: toneKey, label: 'Warm' }] }],
    });
    expect(projectToolResultRetrieval('inbox.update', { key: inboxKey, connectorKey, name: 'Work inbox' })).toEqual({
      source: 'results', limit: 10, minimumScore: 0.55, groups: [{ collectionSlug: 'inboxes', results: [{ key: inboxKey, label: 'Work inbox', destinationKey: connectorKey }] }],
    });
  });

  test('unwraps generic items and results wrappers', () => {
    const placeKey = newId();
    expect(projectToolResultRetrieval('place.create', { items: [{ key: placeKey, name: 'Paris' }] })).toEqual({
      source: 'results', limit: 10, minimumScore: 0.55, groups: [{ collectionSlug: 'places', results: [{ key: placeKey, label: 'Paris' }] }],
    });
    expect(projectToolResultRetrieval('trip.update', { results: [{ key: newId(), name: 'Spring trip' }] })!.groups[0]!.collectionSlug).toBe('trips');
  });

  test('stops descending at three container levels', () => {
    const deep = { collections: { collections: { collections: { collections: [{ key: newId(), name: 'Too deep' }] } } } };
    expect(projectToolResultRetrieval('collection.list', deep)).toBeNull();
  });
});

