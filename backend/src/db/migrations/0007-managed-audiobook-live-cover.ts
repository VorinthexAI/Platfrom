import type { Database } from 'arangojs';
import { initialWorkspaceBookKey } from '@/lib/initial-workspace-content-identifiers';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

export async function removeManagedAudiobookStoredCover(database: Database) {
  const scopes = await (await database.query<{ key: string }>('FOR scope IN scopes LET team = DOCUMENT(teams, scope.teamKey) FILTER team != null && team.is_root != true RETURN { key: scope._key }')).all();
  await database.query(`
    FOR key IN @bookKeys
      LET book = DOCUMENT(books, key)
      FILTER book != null && book.managed == true && HAS(book, "coverStorageKey")
      UPDATE book WITH { coverStorageKey: null } IN books OPTIONS { keepNull: false }
  `, { bookKeys: scopes.map(({ key }) => initialWorkspaceBookKey(key)) });
}

export const managedAudiobookLiveCoverMigration: GraphMigration = {
  id: '0007-managed-audiobook-live-cover',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url)]),
  up: removeManagedAudiobookStoredCover,
};
