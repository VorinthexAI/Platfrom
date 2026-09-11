import { createHash } from 'node:crypto';
import type { Database } from 'arangojs';
import { withDatabaseTransaction } from '@/lib/db/client';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { legacyEmailArchiveRootFolderKey } from '@/lib/email-inbox/export-container-keys';
import { generatedDocumentFolderKey } from '@/lib/generated-documents/folders';
import { initialWorkspaceFolderKey } from '@/lib/initial-workspace-content-identifiers';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

type ManagedArchiveRoot = { _key: string; scopeKey: string; purpose?: string; embedding?: unknown; createdAt?: string; updatedAt?: string };
type ManagedArchiveMigrationTransaction = (collections: { write: string[] }, operation: (transaction: Pick<Database, 'query'>) => Promise<void>) => Promise<void>;

const legacyManagedArchiveRootKey = (kind: string, ...values: string[]) => `c${createHash('sha256').update([kind, ...values].join('\0')).digest('hex').slice(0, 24)}`;

export async function migrateCanonicalManagedArchiveFolders(
  database: Database,
  runTransaction: ManagedArchiveMigrationTransaction = (collections, operation) => withDatabaseTransaction(database, collections, operation),
): Promise<void> {
  const roots = await (await database.query<ManagedArchiveRoot>('FOR folder IN folders FILTER IS_STRING(folder.scopeKey) RETURN KEEP(folder, "_key", "scopeKey", "purpose", "embedding", "createdAt", "updatedAt")')).all();
  const rootDestination = (root: ManagedArchiveRoot) => {
    if (root._key === generatedDocumentFolderKey(root.scopeKey, 'generated-documents-root') || root.purpose === 'generated-documents-root') return { id: 'travel', name: 'Compass', presentation: 'travel' } as const;
    if (root._key === legacyEmailArchiveRootFolderKey(root.scopeKey) || root.purpose === 'communication-mail-root') return { id: 'communication', name: 'Signal', presentation: 'communication' } as const;
    if (root._key === legacyManagedArchiveRootKey('archive-ascend-root', root.scopeKey) || root.purpose === 'generated-audio-root') return { id: 'learning', name: 'Ascend', presentation: 'learning' } as const;
    return undefined;
  };
  const moveRoot = async (root: ManagedArchiveRoot, destination: NonNullable<ReturnType<typeof rootDestination>>) => {
    const destinationKey = initialWorkspaceFolderKey(root.scopeKey, destination.id);
    const platformKey = initialWorkspaceFolderKey(root.scopeKey, 'platform');
    await runTransaction({ write: ['folders', 'documents'] }, async (transaction) => {
      await transaction.query('LET platform = DOCUMENT(folders, @platformKey) UPSERT { _key: @destinationKey } INSERT { _key: @destinationKey, scopeKey: @scopeKey, parentFolderKey: platform == null ? null : @platformKey, name: @name, presentation: @presentation, mutationPolicy: "system-container", embedding: @embedding, isFavorite: false, createdAt: @createdAt, updatedAt: @updatedAt } UPDATE { parentFolderKey: platform == null ? null : @platformKey, presentation: @presentation, mutationPolicy: "system-container" } IN folders OPTIONS { keepNull: false }', { destinationKey, platformKey, scopeKey: root.scopeKey, name: destination.name, presentation: destination.presentation, embedding: root.embedding ?? Array(EMBEDDING_DIMENSIONS).fill(0), createdAt: root.createdAt ?? new Date(0).toISOString(), updatedAt: root.updatedAt ?? root.createdAt ?? new Date(0).toISOString() });
      await transaction.query('FOR folder IN folders FILTER folder.scopeKey == @scopeKey && folder.parentFolderKey == @legacyKey UPDATE folder WITH { parentFolderKey: @destinationKey } IN folders', { scopeKey: root.scopeKey, legacyKey: root._key, destinationKey });
      await transaction.query('FOR document IN documents FILTER document.scopeKey == @scopeKey && document.folderKey == @legacyKey UPDATE document WITH { folderKey: @destinationKey } IN documents', { scopeKey: root.scopeKey, legacyKey: root._key, destinationKey });
      const remaining = await (await transaction.query<number>('RETURN LENGTH(FOR folder IN folders FILTER folder.scopeKey == @scopeKey && folder.parentFolderKey == @legacyKey RETURN 1) + LENGTH(FOR document IN documents FILTER document.scopeKey == @scopeKey && document.folderKey == @legacyKey RETURN 1)', { scopeKey: root.scopeKey, legacyKey: root._key })).next() ?? 0;
      if (remaining !== 0) throw new Error(`Legacy managed Archive root ${root._key} could not be emptied.`);
      await transaction.query('FOR folder IN folders FILTER folder._key == @legacyKey && folder.scopeKey == @scopeKey REMOVE folder IN folders', { scopeKey: root.scopeKey, legacyKey: root._key });
    });
  };
  for (const root of roots) {
    const destination = rootDestination(root);
    if (destination) await moveRoot(root, destination);
  }

  const bookFolders = await (await database.query<{ scopeKey: string; folderKey: string }>('FOR book IN books FILTER IS_STRING(book.scopeKey) && IS_STRING(book.archiveFolderKey) COLLECT scopeKey = book.scopeKey, folderKey = book.archiveFolderKey RETURN { scopeKey, folderKey }')).all();
  for (const { scopeKey, folderKey } of bookFolders) {
    const destinationKey = initialWorkspaceFolderKey(scopeKey, 'learning');
    await database.query('LET folder = DOCUMENT(folders, @folderKey) LET destination = DOCUMENT(folders, @destinationKey) FILTER folder != null && folder.scopeKey == @scopeKey && destination != null && destination.scopeKey == @scopeKey && folder.parentFolderKey != @destinationKey UPDATE folder WITH { parentFolderKey: @destinationKey } IN folders', { scopeKey, folderKey, destinationKey });
  }
}

export const canonicalManagedArchiveFoldersMigration: GraphMigration = {
  id: '0005-canonical-managed-archive-folders',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url)]),
  up: migrateCanonicalManagedArchiveFolders,
};
