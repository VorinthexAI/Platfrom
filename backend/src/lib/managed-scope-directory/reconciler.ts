import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { embedText } from '@/lib/embeddings';
import { documentStorage, type DocumentObjectStorage } from '@/lib/ai/document-processing/storage';
import { chunkDocumentContent, documentEmbeddingTexts, documentSemanticHash } from '@/lib/ai/document-processing/chunking';
import { collectionSchema, type Collection } from '@/lib/db/collections.node';
import { collectionImageSchema, type CollectionImage } from '@/lib/db/collection-images.node';
import { documentSchema, type Document } from '@/lib/db/documents.node';
import { folderSchema, type Folder } from '@/lib/db/folders.node';
import { imageSchema, type Image } from '@/lib/db/images.node';
import { createManagedScopeDirectoryManifest, managedScopeDirectoryStorageKey, MANAGED_SCOPE_DIRECTORY_PURPOSE, type ManagedScopeDirectoryProduct, type ManagedScopeDirectoryTargets } from './manifest';
import { createManagedScopeDirectoryRepository } from './repository';
import type { ManagedScopeDirectoryRepository, ManagedScopeDirectoryState } from './types';

export interface ManagedScopeDirectoryReconcileResult {
  records: Awaited<ReturnType<ManagedScopeDirectoryRepository['apply']>>;
  assets: { uploaded: number; unchanged: number };
}

export interface ManagedScopeDirectoryDependencies {
  repository?: ManagedScopeDirectoryRepository;
  storage?: Pick<DocumentObjectStorage, 'download' | 'upload'> & Partial<Pick<DocumentObjectStorage, 'delete'>>;
  embed?: (text: string) => Promise<number[]>;
  now?: () => string;
}

const same = (value: object | undefined, fields: Record<string, unknown>) => Boolean(value) && Object.entries(fields).every(([key, expected]) => {
  const actual = (value as Record<string, unknown>)[key];
  return actual === expected || JSON.stringify(actual) === JSON.stringify(expected);
});

export async function reconcileManagedScopeDirectory(input: {
  products: readonly ManagedScopeDirectoryProduct[];
  targetScopeKeys: ManagedScopeDirectoryTargets;
}, dependencies: ManagedScopeDirectoryDependencies = {}): Promise<ManagedScopeDirectoryReconcileResult> {
  const manifest = createManagedScopeDirectoryManifest(input);
  const repository = dependencies.repository ?? createManagedScopeDirectoryRepository();
  const storage = dependencies.storage ?? documentStorage;
  const embed = dependencies.embed ?? ((text: string) => embedText({ text }));
  const now = (dependencies.now ?? (() => new Date().toISOString()))();
  const scopeKeys = Object.values(manifest.targetScopeKeys);
  const current = await repository.load(scopeKeys);
  const folderByKey = new Map(current.folders.map((value) => [value.key, value]));
  const documentByKey = new Map(current.documents.map((value) => [value.key, value]));
  const collectionByKey = new Map(current.collections.map((value) => [value.key, value]));
  const imageByKey = new Map(current.images.map((value) => [value.key, value]));
  const relationByKey = new Map(current.relations.map((value) => [value.key, value]));

  const folders: Folder[] = [];
  for (const item of manifest.folders) {
    const previous = folderByKey.get(item.key);
    const fields = { scopeKey: item.scopeKey, parentFolderKey: item.parentFolderKey, name: item.name, managedPurpose: MANAGED_SCOPE_DIRECTORY_PURPOSE, managedOwnerKey: item.ownerKey, mutationPolicy: 'system-container', archiveVisibility: 'visible', isFavorite: false };
    folders.push(same(previous, fields) ? previous! : folderSchema.parse({ key: item.key, ...fields, embedding: await embed(item.name), createdAt: previous?.createdAt ?? now, updatedAt: now }));
  }

  const documents: Document[] = [];
  for (const item of manifest.documents) {
    const previous = documentByKey.get(item.key);
    const contentChunks = chunkDocumentContent(item.content);
    const fields = { scopeKey: item.scopeKey, folderKey: item.folderKey, name: item.name, content: item.content, contentChunks, semanticChunkCount: contentChunks.length, semanticContentHash: documentSemanticHash(item.content), managedPurpose: MANAGED_SCOPE_DIRECTORY_PURPOSE, managedOwnerKey: item.ownerKey, mutationPolicy: 'system-only', archiveVisibility: 'visible', isFavorite: false };
    if (same(previous, fields) && previous?.chunkEmbeddings?.length === contentChunks.length) {
      documents.push(previous);
    } else {
      const chunkEmbeddings = await Promise.all(documentEmbeddingTexts(item.name, contentChunks).map(embed));
      documents.push(documentSchema.parse({ key: item.key, ...fields, embedding: chunkEmbeddings[0], chunkEmbeddings, createdAt: previous?.createdAt ?? now, updatedAt: now }));
    }
  }

  const collections: Collection[] = [];
  for (const item of manifest.collections) {
    const previous = collectionByKey.get(item.key);
    const fields = { scopeKey: item.scopeKey, name: 'Scopes', purpose: MANAGED_SCOPE_DIRECTORY_PURPOSE, mutationPolicy: 'system-only', isFavorite: false };
    collections.push(same(previous, fields) ? previous! : collectionSchema.parse({ key: item.key, ...fields, embedding: await embed('Scopes product logos'), createdAt: previous?.createdAt ?? now, updatedAt: now }));
  }

  let uploaded = 0, unchanged = 0;
  const uploadedStorageKeys: string[] = [];
  const compensateUploads = async () => {
    if (!storage.delete) return;
    await Promise.allSettled(uploadedStorageKeys.map((storageKey) => storage.delete!(storageKey)));
  };
  const sourceAssets = new Map<string, Promise<{ bytes: Uint8Array; checksum: string; width: number; height: number }>>();
  const loadSource = (sourceStorageKey: string) => {
    let asset = sourceAssets.get(sourceStorageKey);
    if (!asset) {
      asset = storage.download(sourceStorageKey).then(async ({ bytes }) => {
        if (!bytes.byteLength) throw new Error(`Managed scope directory logo is empty: ${sourceStorageKey}`);
        const metadata = await sharp(bytes).metadata();
        if (!metadata.width || !metadata.height) throw new Error(`Managed scope directory logo has no dimensions: ${sourceStorageKey}`);
        return { bytes, checksum: createHash('sha256').update(bytes).digest('hex'), width: metadata.width, height: metadata.height };
      });
      sourceAssets.set(sourceStorageKey, asset);
    }
    return asset;
  };
  const images: Image[] = [];
  const relations: CollectionImage[] = [];
  for (const item of manifest.logos) {
    const asset = await loadSource(item.sourceStorageKey);
    const storageKey = managedScopeDirectoryStorageKey(item.scopeKey, item.product.slug, asset.checksum);
    const previous = imageByKey.get(item.key);
    const fields = {
      scopeKey: item.scopeKey, filename: `${item.product.slug}.png`, caption: `${item.product.name} logo`, storageKey, mimeType: 'image/png', sizeBytes: asset.bytes.byteLength,
      width: asset.width, height: asset.height, origin: 'uploaded', mutationPolicy: 'system-only', managedPurpose: MANAGED_SCOPE_DIRECTORY_PURPOSE, managedOwnerKey: item.product.key,
      contentChecksum: asset.checksum, createdByKey: null, isFavorite: false,
    };
    if (same(previous, fields)) {
      images.push(previous!);
      unchanged += 1;
    } else {
      if (previous?.storageKey === storageKey && previous.contentChecksum === asset.checksum) {
        unchanged += 1;
      } else {
        uploadedStorageKeys.push(storageKey);
        try { await storage.upload({ key: storageKey, bytes: asset.bytes, mimeType: 'image/png' }); }
        catch (error) { await compensateUploads(); throw error; }
        uploaded += 1;
      }
      images.push(imageSchema.parse({ key: item.key, ...fields, embedding: await embed(`${item.product.name} logo`), createdAt: previous?.createdAt ?? now, updatedAt: now }));
    }
    const previousRelation = relationByKey.get(item.relationKey);
    const relationFields = { scopeKey: item.scopeKey, collectionKey: item.collectionKey, imageKey: item.key, managedPurpose: MANAGED_SCOPE_DIRECTORY_PURPOSE };
    relations.push(same(previousRelation, relationFields) ? previousRelation! : collectionImageSchema.parse({ key: item.relationKey, ...relationFields, createdAt: previousRelation?.createdAt ?? now }));
  }
  const desired: ManagedScopeDirectoryState = { folders, documents, collections, images, relations };
  try {
    return { records: await repository.apply(desired, scopeKeys, now), assets: { uploaded, unchanged } };
  } catch (error) {
    await compensateUploads();
    throw error;
  }
}
