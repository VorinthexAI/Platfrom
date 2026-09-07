import { db, withDatabaseTransaction, withTransaction } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { collectionSchema } from '@/lib/db/collections.node';
import { collectionImageSchema } from '@/lib/db/collection-images.node';
import { documentSchema } from '@/lib/db/documents.node';
import { folderSchema } from '@/lib/db/folders.node';
import { imageSchema } from '@/lib/db/images.node';
import { MANAGED_SCOPE_DIRECTORY_PURPOSE } from './manifest';
import type { ManagedScopeDirectoryApplyResult, ManagedScopeDirectoryRepository, ManagedScopeDirectoryState } from './types';

export interface ManagedScopeDirectoryDatabase {
  query(query: string, bindVars?: Record<string, unknown>): Promise<{ all(): Promise<unknown[]>; next?(): Promise<unknown> }>;
}

type TransactionRunner = <T>(operation: (database: ManagedScopeDirectoryDatabase) => Promise<T>) => Promise<T>;
const runTransaction: TransactionRunner = (operation) => withTransaction({ read: ['scopes'], write: ['folders', 'documents', 'collections', 'images', 'collectionImages', 'storageDeletionJobs'] }, (transaction) => operation(transaction));

const parseRows = <T>(schema: { parse(value: unknown): T }, rows: unknown[]) => rows.map((row) => schema.parse(withArangoKey(row as Record<string, unknown>)));

async function loadManagedState(database: ManagedScopeDirectoryDatabase, scopeKeys: string[]): Promise<ManagedScopeDirectoryState> {
  const bind = { scopeKeys, purpose: MANAGED_SCOPE_DIRECTORY_PURPOSE };
  const folders = await (await database.query('FOR value IN folders FILTER value.scopeKey IN @scopeKeys && value.managedPurpose == @purpose RETURN value', bind)).all();
  const documents = await (await database.query('FOR value IN documents FILTER value.scopeKey IN @scopeKeys && value.managedPurpose == @purpose RETURN value', bind)).all();
  const collections = await (await database.query('FOR value IN collections FILTER value.scopeKey IN @scopeKeys && value.purpose == @purpose && value.mutationPolicy == "system-only" RETURN value', bind)).all();
  const images = await (await database.query('FOR value IN images FILTER value.scopeKey IN @scopeKeys && value.managedPurpose == @purpose RETURN value', bind)).all();
  const relations = await (await database.query('FOR value IN collectionImages FILTER value.scopeKey IN @scopeKeys && value.managedPurpose == @purpose RETURN value', bind)).all();
  return {
    folders: parseRows(folderSchema, folders), documents: parseRows(documentSchema, documents), collections: parseRows(collectionSchema, collections),
    images: parseRows(imageSchema, images), relations: parseRows(collectionImageSchema, relations),
  };
}

function assertDesiredRelations(state: ManagedScopeDirectoryState, scopeKeys: string[]): void {
  const scopes = new Set(scopeKeys);
  const folders = new Map(state.folders.map((value) => [value.key, value]));
  const collections = new Map(state.collections.map((value) => [value.key, value]));
  const images = new Map(state.images.map((value) => [value.key, value]));
  for (const value of [...state.folders, ...state.documents, ...state.collections, ...state.images, ...state.relations]) if (!scopes.has(value.scopeKey)) throw new Error('Managed scope directory record is outside its target scopes.');
  for (const folder of state.folders) if (folder.parentFolderKey && folders.get(folder.parentFolderKey)?.scopeKey !== folder.scopeKey) throw new Error('Managed scope directory folder parents must be in the same scope.');
  for (const document of state.documents) if (!document.folderKey || folders.get(document.folderKey)?.scopeKey !== document.scopeKey) throw new Error('Managed scope directory documents must belong to a same-scope managed folder.');
  for (const relation of state.relations) if (collections.get(relation.collectionKey)?.scopeKey !== relation.scopeKey || images.get(relation.imageKey)?.scopeKey !== relation.scopeKey) throw new Error('Managed scope directory Gallery relations must remain in one scope.');
}

function recordCounts(current: ManagedScopeDirectoryState, desired: ManagedScopeDirectoryState): ManagedScopeDirectoryApplyResult {
  const currentRecords = [...current.folders, ...current.documents, ...current.collections, ...current.images, ...current.relations];
  const desiredRecords = [...desired.folders, ...desired.documents, ...desired.collections, ...desired.images, ...desired.relations];
  const currentByKey = new Map(currentRecords.map((value) => [value.key, value]));
  const desiredKeys = new Set(desiredRecords.map((value) => value.key));
  let created = 0, updated = 0, unchanged = 0;
  for (const value of desiredRecords) {
    const previous = currentByKey.get(value.key);
    if (!previous) created += 1;
    else if (JSON.stringify(previous) === JSON.stringify(value)) unchanged += 1;
    else updated += 1;
  }
  return { created, updated, unchanged, deleted: currentRecords.filter((value) => !desiredKeys.has(value.key)).length };
}

async function findConflicts(database: ManagedScopeDirectoryDatabase, collection: string, keys: string[], managedFilter: string): Promise<string[]> {
  if (!keys.length) return [];
  return await (await database.query(`FOR value IN ${collection} FILTER value._key IN @keys && !(${managedFilter}) RETURN value._key`, { keys, purpose: MANAGED_SCOPE_DIRECTORY_PURPOSE })).all() as string[];
}

export function createManagedScopeDirectoryRepository(database: ManagedScopeDirectoryDatabase = db, transaction?: TransactionRunner): ManagedScopeDirectoryRepository {
  const transact = transaction ?? (database === db
    ? runTransaction
    : (operation) => withDatabaseTransaction(database as typeof db, { read: ['scopes'], write: ['folders', 'documents', 'collections', 'images', 'collectionImages', 'storageDeletionJobs'] }, (executor) => operation(executor)));
  return {
    load: (scopeKeys) => loadManagedState(database, scopeKeys),
    async apply(state, scopeKeys, now) {
      assertDesiredRelations(state, scopeKeys);
      return transact(async (executor) => {
        const scopeRows = await (await executor.query('FOR scope IN scopes FILTER scope._key IN @scopeKeys RETURN scope._key', { scopeKeys })).all() as string[];
        if (new Set(scopeRows).size !== new Set(scopeKeys).size) throw new Error('Every managed scope directory target scope must exist.');
        const conflicts: string[] = [];
        conflicts.push(...await findConflicts(executor, 'folders', state.folders.map(({ key }) => key), 'value.managedPurpose == @purpose && value.mutationPolicy == "system-container"'));
        conflicts.push(...await findConflicts(executor, 'documents', state.documents.map(({ key }) => key), 'value.managedPurpose == @purpose && value.mutationPolicy == "system-only"'));
        conflicts.push(...await findConflicts(executor, 'collections', state.collections.map(({ key }) => key), 'value.purpose == @purpose && value.mutationPolicy == "system-only"'));
        conflicts.push(...await findConflicts(executor, 'images', state.images.map(({ key }) => key), 'value.managedPurpose == @purpose && value.mutationPolicy == "system-only"'));
        conflicts.push(...await findConflicts(executor, 'collectionImages', state.relations.map(({ key }) => key), 'value.managedPurpose == @purpose'));
        if (conflicts.length) throw new Error(`Managed scope directory deterministic keys conflict with user-owned records: ${conflicts.join(', ')}`);
        const current = await loadManagedState(executor, scopeKeys);
        const counts = recordCounts(current, state);
        const staleImageKeys = current.images.filter((value) => !state.images.some((desired) => desired.key === value.key) || state.images.find((desired) => desired.key === value.key)?.storageKey !== value.storageKey).map(({ storageKey }) => storageKey);
        if (staleImageKeys.length) await executor.query('FOR storageKey IN UNIQUE(@storageKeys) UPSERT { storageKey } INSERT { storageKey, createdAt: @now, status: "pending" } UPDATE {} IN storageDeletionJobs', { storageKeys: staleImageKeys, now });

        const writes = [
          ['folders', state.folders], ['documents', state.documents], ['collections', state.collections], ['images', state.images], ['collectionImages', state.relations],
        ] as const;
        for (const [collection, values] of writes) await executor.query(`FOR value IN @values LET current = DOCUMENT(${collection}, value._key) FILTER current == null || UNSET(current, "_id", "_rev") != value UPSERT { _key: value._key } INSERT value REPLACE value IN ${collection}`, { values: values.map((value) => toArangoDoc(value)) });
        const desired = {
          folderKeys: state.folders.map(({ key }) => key), documentKeys: state.documents.map(({ key }) => key), collectionKeys: state.collections.map(({ key }) => key),
          imageKeys: state.images.map(({ key }) => key), relationKeys: state.relations.map(({ key }) => key), scopeKeys, purpose: MANAGED_SCOPE_DIRECTORY_PURPOSE,
        };
        const managed = { scopeKeys: desired.scopeKeys, purpose: desired.purpose };
        await executor.query('FOR value IN collectionImages FILTER value.scopeKey IN @scopeKeys && value.managedPurpose == @purpose && value._key NOT IN @relationKeys REMOVE value IN collectionImages', { ...managed, relationKeys: desired.relationKeys });
        await executor.query('FOR value IN documents FILTER value.scopeKey IN @scopeKeys && value.managedPurpose == @purpose && value._key NOT IN @documentKeys REMOVE value IN documents', { ...managed, documentKeys: desired.documentKeys });
        await executor.query('FOR value IN images FILTER value.scopeKey IN @scopeKeys && value.managedPurpose == @purpose && value._key NOT IN @imageKeys REMOVE value IN images', { ...managed, imageKeys: desired.imageKeys });
        await executor.query('FOR value IN folders FILTER value.scopeKey IN @scopeKeys && value.managedPurpose == @purpose && value._key NOT IN @folderKeys REMOVE value IN folders', { ...managed, folderKeys: desired.folderKeys });
        await executor.query('FOR value IN collections FILTER value.scopeKey IN @scopeKeys && value.purpose == @purpose && value.mutationPolicy == "system-only" && value._key NOT IN @collectionKeys REMOVE value IN collections', { ...managed, collectionKeys: desired.collectionKeys });
        const invalid = await (await executor.query('FOR relation IN collectionImages FILTER relation._key IN @relationKeys LET collection = DOCUMENT(collections, relation.collectionKey) LET image = DOCUMENT(images, relation.imageKey) FILTER collection == null || image == null || relation.scopeKey != collection.scopeKey || relation.scopeKey != image.scopeKey RETURN relation._key', { relationKeys: desired.relationKeys })).all();
        if (invalid.length) throw new Error('Managed scope directory produced a cross-scope Gallery relation.');
        return counts;
      });
    },
  };
}
