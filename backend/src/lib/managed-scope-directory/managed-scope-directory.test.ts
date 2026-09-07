import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { collectionSchema } from '@/lib/db/collections.node';
import { collectionImageSchema } from '@/lib/db/collection-images.node';
import { documentSchema } from '@/lib/db/documents.node';
import { folderSchema } from '@/lib/db/folders.node';
import { imageSchema } from '@/lib/db/images.node';
import { createManagedScopeDirectoryManifest, managedScopeDirectoryKey, MANAGED_SCOPE_DIRECTORY_PRODUCTS, type ManagedScopeDirectoryProduct, type ManagedScopeDirectoryTargets } from './manifest';
import { readManagedScopeDirectoryCatalog } from './reader';
import { reconcileManagedScopeDirectory } from './reconciler';
import type { ManagedScopeDirectoryRepository, ManagedScopeDirectoryState } from './types';

const products = MANAGED_SCOPE_DIRECTORY_PRODUCTS.map((slug, index) => ({
  key: newId(), slug, name: slug === 'vorinthex-ai' ? 'Vorinthex AI' : `${slug[0]!.toUpperCase()}${slug.slice(1)}`,
  description: `${slug} brief`, detailedDescription: `${slug} detailed description`,
})) satisfies ManagedScopeDirectoryProduct[];
const targetScopeKeys = Object.fromEntries(MANAGED_SCOPE_DIRECTORY_PRODUCTS.map((slug) => [slug, newId()])) as ManagedScopeDirectoryTargets;
const emptyState = (): ManagedScopeDirectoryState => ({ folders: [], documents: [], collections: [], images: [], relations: [] });
const records = (state: ManagedScopeDirectoryState) => [...state.folders, ...state.documents, ...state.collections, ...state.images, ...state.relations];

class MemoryRepository implements ManagedScopeDirectoryRepository {
  state = emptyState();
  async load() { return structuredClone(this.state); }
  async apply(next: ManagedScopeDirectoryState) {
    const previous = new Map(records(this.state).map((value) => [value.key, value]));
    const desired = records(next);
    const keys = new Set(desired.map(({ key }) => key));
    const result = { created: 0, updated: 0, unchanged: 0, deleted: records(this.state).filter(({ key }) => !keys.has(key)).length };
    for (const value of desired) {
      const current = previous.get(value.key);
      if (!current) result.created += 1;
      else if (JSON.stringify(current) === JSON.stringify(value)) result.unchanged += 1;
      else result.updated += 1;
    }
    this.state = structuredClone(next);
    return result;
  }
}

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.25);

describe('managed scope directory manifest', () => {
  test('builds the exact mother and child Archive/Gallery trees', () => {
    const manifest = createManagedScopeDirectoryManifest({ products, targetScopeKeys });
    expect(manifest.products.map(({ slug }) => slug)).toEqual([...MANAGED_SCOPE_DIRECTORY_PRODUCTS]);
    expect(manifest.folders).toHaveLength(20);
    expect(manifest.documents).toHaveLength(26);
    expect(manifest.collections).toHaveLength(7);
    expect(manifest.logos).toHaveLength(13);
    const motherScope = targetScopeKeys['vorinthex-ai'];
    expect(manifest.folders.filter(({ scopeKey }) => scopeKey === motherScope).map(({ name }) => name).sort()).toEqual(['Archive', 'Ascend', 'Compass', 'Core', 'Gallery', 'Scopes', 'Signal', 'Vorinthex AI'].sort());
    expect(manifest.documents.filter(({ scopeKey }) => scopeKey === motherScope)).toHaveLength(14);
    for (const product of products.slice(1)) {
      const scopeKey = targetScopeKeys[product.slug];
      expect(manifest.folders.filter((folder) => folder.scopeKey === scopeKey).map(({ name }) => name)).toEqual(['Scopes', product.name]);
      expect(manifest.documents.filter((document) => document.scopeKey === scopeKey).map(({ name }) => name)).toEqual(['Brief', 'Description']);
      expect(manifest.logos.filter((logo) => logo.scopeKey === scopeKey).map(({ product: item }) => item.slug)).toEqual([product.slug]);
    }
    expect(manifest.logos.filter(({ scopeKey }) => scopeKey === motherScope)).toHaveLength(7);
    const folderIdentities = manifest.folders.map(({ scopeKey, ownerKey, name }) => `${scopeKey}\0scope-directory\0${ownerKey}\0${name}`);
    const documentIdentities = manifest.documents.map(({ scopeKey, ownerKey, name }) => `${scopeKey}\0scope-directory\0${ownerKey}\0${name}`);
    expect(new Set(folderIdentities).size).toBe(folderIdentities.length);
    expect(new Set(documentIdentities).size).toBe(documentIdentities.length);
  });

  test('requires exactly seven unique products and target scopes', () => {
    expect(() => createManagedScopeDirectoryManifest({ products: products.slice(0, 6), targetScopeKeys })).toThrow('exactly seven');
    expect(() => createManagedScopeDirectoryManifest({ products: [...products.slice(0, 6), products[0]!], targetScopeKeys })).toThrow('exactly once');
    expect(() => createManagedScopeDirectoryManifest({ products, targetScopeKeys: { ...targetScopeKeys, core: targetScopeKeys.archive } })).toThrow('must be unique');
  });

  test('uses unique deterministic CUID keys and only same-scope relations', () => {
    const first = createManagedScopeDirectoryManifest({ products, targetScopeKeys });
    const second = createManagedScopeDirectoryManifest({ products, targetScopeKeys });
    expect(first).toEqual(second);
    const keys = [...first.folders.map(({ key }) => key), ...first.documents.map(({ key }) => key), ...first.collections.map(({ key }) => key), ...first.logos.flatMap(({ key, relationKey }) => [key, relationKey])];
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key) => folderSchema.shape.key.safeParse(key).success)).toBe(true);
    const collections = new Map(first.collections.map((value) => [value.key, value.scopeKey]));
    expect(first.logos.every((logo) => collections.get(logo.collectionKey) === logo.scopeKey)).toBe(true);
    expect(managedScopeDirectoryKey('x', 'y')).toBe(managedScopeDirectoryKey('x', 'y'));
  });
});

describe('managed scope directory reconciliation', () => {
  test('is idempotent, immutable, exact-scope, and gives every logo a unique object', async () => {
    const repository = new MemoryRepository();
    const uploads: string[] = [];
    const storage = { async download() { return { bytes: png }; }, async upload({ key }: { key: string }) { uploads.push(key); return { storageKey: key }; } };
    const dependencies = { repository, storage, embed: async () => embedding, now: () => '2026-09-06T00:00:00.000Z' };
    const first = await reconcileManagedScopeDirectory({ products, targetScopeKeys }, dependencies);
    expect(first.records).toEqual({ created: 79, updated: 0, deleted: 0, unchanged: 0 });
    expect(first.assets).toEqual({ uploaded: 13, unchanged: 0 });
    expect(new Set(uploads).size).toBe(13);
    expect(repository.state.folders.every(({ mutationPolicy, managedPurpose, archiveVisibility }) => mutationPolicy === 'system-container' && managedPurpose === 'scope-directory' && archiveVisibility === 'visible')).toBe(true);
    expect(repository.state.documents.every(({ mutationPolicy, managedPurpose, archiveVisibility }) => mutationPolicy === 'system-only' && managedPurpose === 'scope-directory' && archiveVisibility === 'visible')).toBe(true);
    expect(repository.state.collections.every(({ name, purpose, mutationPolicy }) => name === 'Scopes' && purpose === 'scope-directory' && mutationPolicy === 'system-only')).toBe(true);
    expect(repository.state.images.every(({ mutationPolicy, managedPurpose }) => mutationPolicy === 'system-only' && managedPurpose === 'scope-directory')).toBe(true);
    const images = new Map(repository.state.images.map((value) => [value.key, value]));
    const collections = new Map(repository.state.collections.map((value) => [value.key, value]));
    expect(repository.state.relations.every((relation) => relation.scopeKey === images.get(relation.imageKey)?.scopeKey && relation.scopeKey === collections.get(relation.collectionKey)?.scopeKey)).toBe(true);
    const second = await reconcileManagedScopeDirectory({ products, targetScopeKeys }, { ...dependencies, now: () => '2026-09-07T00:00:00.000Z' });
    expect(second.records).toEqual({ created: 0, updated: 0, deleted: 0, unchanged: 79 });
    expect(second.assets).toEqual({ uploaded: 0, unchanged: 13 });
    expect(uploads).toHaveLength(13);
  });

  test('updates canonical text and removes only stale records in its namespace', async () => {
    const repository = new MemoryRepository();
    const dependencies = { repository, storage: { async download() { return { bytes: png }; }, async upload({ key }: { key: string }) { return { storageKey: key }; } }, embed: async () => embedding, now: () => '2026-09-06T00:00:00.000Z' };
    await reconcileManagedScopeDirectory({ products, targetScopeKeys }, dependencies);
    const staleFolderKey = newId(), staleCollectionKey = newId(), staleImageKey = newId(), staleAt = '2026-01-01T00:00:00.000Z';
    repository.state.folders.push(folderSchema.parse({ key: staleFolderKey, scopeKey: targetScopeKeys.archive, name: 'Retired', managedPurpose: 'scope-directory', managedOwnerKey: products[2]!.key, mutationPolicy: 'system-container', archiveVisibility: 'visible', embedding, createdAt: staleAt, updatedAt: staleAt }));
    repository.state.documents.push(documentSchema.parse({ key: newId(), scopeKey: targetScopeKeys.archive, folderKey: staleFolderKey, name: 'Stale', content: 'stale', managedPurpose: 'scope-directory', managedOwnerKey: products[2]!.key, mutationPolicy: 'system-only', archiveVisibility: 'visible', embedding, createdAt: staleAt, updatedAt: staleAt }));
    repository.state.collections.push(collectionSchema.parse({ key: staleCollectionKey, scopeKey: targetScopeKeys.archive, name: 'Retired', purpose: 'scope-directory', mutationPolicy: 'system-only', embedding, createdAt: staleAt, updatedAt: staleAt }));
    repository.state.images.push(imageSchema.parse({ key: staleImageKey, scopeKey: targetScopeKeys.archive, filename: 'retired.png', caption: 'Retired logo', storageKey: 'managed/scope-directory/retired.png', mimeType: 'image/png', sizeBytes: 1, width: 1, height: 1, origin: 'uploaded', mutationPolicy: 'system-only', managedPurpose: 'scope-directory', managedOwnerKey: products[2]!.key, contentChecksum: 'a'.repeat(64), embedding, createdAt: staleAt, updatedAt: staleAt }));
    repository.state.relations.push(collectionImageSchema.parse({ key: newId(), scopeKey: targetScopeKeys.archive, collectionKey: staleCollectionKey, imageKey: staleImageKey, managedPurpose: 'scope-directory', createdAt: staleAt }));
    const changed = products.map((product) => product.slug === 'archive' ? { ...product, detailedDescription: 'Canonical replacement' } : product);
    const result = await reconcileManagedScopeDirectory({ products: changed, targetScopeKeys }, { ...dependencies, now: () => '2026-09-07T00:00:00.000Z' });
    expect(result.records.deleted).toBe(5);
    expect(result.records.updated).toBe(2);
    expect(repository.state.documents.filter(({ managedOwnerKey, name }) => managedOwnerKey === products[2]!.key && name === 'Description').every(({ content }) => content === 'Canonical replacement')).toBe(true);
  });

  test('schemas retain the domain-neutral managed purpose and system policies', () => {
    const manifest = createManagedScopeDirectoryManifest({ products, targetScopeKeys });
    const now = '2026-09-06T00:00:00.000Z';
    expect(folderSchema.parse({ ...manifest.folders[0], managedPurpose: 'scope-directory', managedOwnerKey: products[0]!.key, mutationPolicy: 'system-container', archiveVisibility: 'visible', embedding, createdAt: now, updatedAt: now }).mutationPolicy).toBe('system-container');
    expect(collectionSchema.parse({ key: manifest.collections[0]!.key, scopeKey: targetScopeKeys['vorinthex-ai'], name: 'Scopes', purpose: 'scope-directory', mutationPolicy: 'system-only', embedding, createdAt: now, updatedAt: now }).purpose).toBe('scope-directory');
    expect(imageSchema.shape.managedPurpose.parse('scope-directory')).toBe('scope-directory');
    expect(collectionImageSchema.safeParse({ key: newId(), scopeKey: newId(), collectionKey: newId(), imageKey: newId(), managedPurpose: 'scope-directory', createdAt: now }).success).toBe(true);
  });

  test('compensates newly copied logo objects when persistence fails', async () => {
    const repository: ManagedScopeDirectoryRepository = { async load() { return emptyState(); }, async apply() { throw new Error('database unavailable'); } };
    const uploaded: string[] = [], deleted: string[] = [];
    const storage = {
      async download() { return { bytes: png }; },
      async upload({ key }: { key: string }) { uploaded.push(key); return { storageKey: key }; },
      async delete(key: string) { deleted.push(key); },
    };
    await expect(reconcileManagedScopeDirectory({ products, targetScopeKeys }, { repository, storage, embed: async () => embedding })).rejects.toThrow('database unavailable');
    expect(deleted.sort()).toEqual(uploaded.sort());
    expect(uploaded).toHaveLength(13);
  });

  test('repository fences user-owned key collisions and never cleans by display name', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    expect(source).toContain('deterministic keys conflict with user-owned records');
    expect(source).toContain('value.managedPurpose == @purpose');
    expect(source).toContain('value.purpose == @purpose && value.mutationPolicy == "system-only"');
    expect(source).not.toContain('value.name == "Scopes"');
    expect(source).not.toMatch(/executor\.query\([^\n]+, desired\)/);
    expect(source.indexOf('IN storageDeletionJobs')).toBeLessThan(source.indexOf('REMOVE value IN images'));
  });
});

describe('managed scope directory reader', () => {
  test('loads exactly seven Brief/Description pairs from one exact scope', async () => {
    const queried: Record<string, unknown>[] = [];
    const rows = products.flatMap((product) => [
      { key: product.key, name: product.name, kind: 'Brief', content: product.description },
      { key: product.key, name: product.name, kind: 'Description', content: product.detailedDescription },
    ]);
    const database = { async query(_query: string, bind?: Record<string, unknown>) { queried.push(bind ?? {}); return { async all() { return rows; } }; } };
    const catalog = await readManagedScopeDirectoryCatalog(targetScopeKeys['vorinthex-ai'], database);
    expect(catalog).toHaveLength(7);
    expect(catalog.find(({ key }) => key === products[0]!.key)).toEqual({ key: products[0]!.key, name: 'Vorinthex AI', description: 'vorinthex-ai brief', detailedDescription: 'vorinthex-ai detailed description' });
    expect(queried).toEqual([{ scopeKey: targetScopeKeys['vorinthex-ai'], purpose: 'scope-directory' }]);
  });

  test('rejects incomplete or duplicate document pairs', async () => {
    const rows = products.slice(0, 6).flatMap((product) => [{ key: product.key, name: product.name, kind: 'Brief', content: product.description }, { key: product.key, name: product.name, kind: 'Description', content: product.detailedDescription }]);
    const database = { async query() { return { async all() { return rows; } }; } };
    await expect(readManagedScopeDirectoryCatalog(targetScopeKeys['vorinthex-ai'], database)).rejects.toThrow('expected 7');
    const duplicateDatabase = { async query() { return { async all() { return [...rows, ...products.slice(6).flatMap((product) => [{ key: product.key, name: product.name, kind: 'Brief', content: product.description }, { key: product.key, name: product.name, kind: 'Description', content: product.detailedDescription }]), { key: products[0]!.key, name: products[0]!.name, kind: 'Brief', content: 'duplicate' }]; } }; } };
    await expect(readManagedScopeDirectoryCatalog(targetScopeKeys['vorinthex-ai'], duplicateDatabase)).rejects.toThrow('duplicate Brief');
  });
});
