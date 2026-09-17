import { createHash } from 'node:crypto';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { initialWorkspaceFolderKey } from '@/lib/initial-workspace-content-identifiers';
import type { TravelDatabase } from '@/lib/travel/repository';

export type GeneratedDocumentFolderKind = 'guide' | 'brief' | 'accommodations' | 'restaurants' | 'activities';

const definitions = [
  { purpose: 'generated-documents-guide', name: 'Travel Guides', kind: 'guide' },
  { purpose: 'generated-documents-brief', name: 'Briefs', kind: 'brief' },
  { purpose: 'generated-documents-accommodations', name: 'Accommodations', kind: 'accommodations' },
  { purpose: 'generated-documents-restaurants', name: 'Restaurants', kind: 'restaurants' },
  { purpose: 'generated-documents-activities', name: 'Activities', kind: 'activities' },
] as const;

export function generatedDocumentFolderKey(scopeKey: string, purpose: string) {
  return `c${createHash('sha256').update(`generated-document-folder\0${scopeKey}\0${purpose}`).digest('hex').slice(0, 24)}`;
}

export function generatedDocumentFolderKeys(scopeKey: string) {
  return Object.fromEntries(definitions.filter((item) => 'kind' in item).map((item) => [item.kind, generatedDocumentFolderKey(scopeKey, item.purpose)])) as Record<GeneratedDocumentFolderKind, string>;
}

/** Recreates Compass and the destination folder for one dumped document. */
export async function ensureGeneratedDocumentFolders(database: Pick<TravelDatabase, 'query'>, scopeKey: string, at = new Date().toISOString(), kind: GeneratedDocumentFolderKind) {
  const item = definitions.find((definition) => definition.kind === kind);
  if (!item) throw new Error(`Unknown Compass archive folder kind: ${kind}`);
  const rootKey = initialWorkspaceFolderKey(scopeKey, 'travel');
  const platformKey = initialWorkspaceFolderKey(scopeKey, 'platform');
  const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);
  await database.query(`
    UPSERT { _key: @key }
      INSERT { _key: @key, scopeKey: @scopeKey, parentFolderKey: @platformKey, name: "Compass", presentation: "travel", mutationPolicy: "user", embedding: @embedding, isFavorite: false, createdAt: @at, updatedAt: @at }
      UPDATE { presentation: "travel" } IN folders
  `, { key: rootKey, scopeKey, platformKey, embedding, at });
  const key = generatedDocumentFolderKey(scopeKey, item.purpose);
  await database.query(`
    UPSERT { _key: @key }
      INSERT { _key: @key, scopeKey: @scopeKey, parentFolderKey: @rootKey, name: @name, mutationPolicy: "user", embedding: @embedding, isFavorite: false, createdAt: @at, updatedAt: @at }
      UPDATE { name: @name } IN folders
  `, { key, scopeKey, rootKey, name: item.name, embedding, at });
  return { rootKey, ...generatedDocumentFolderKeys(scopeKey) };
}
