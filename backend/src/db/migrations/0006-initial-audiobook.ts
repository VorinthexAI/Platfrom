import type { Database } from 'arangojs';
import { toArangoDoc } from '@/lib/db/base';
import { initialWorkspaceBookRecords } from '@/lib/initial-workspace-content';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

export async function addInitialAudiobook(database: Database) {
  const scopes = await (await database.query<{ key: string; createdAt?: string }>('FOR scope IN scopes LET team = DOCUMENT(teams, scope.teamKey) FILTER team != null && team.is_root != true RETURN { key: scope._key, createdAt: scope.createdAt }')).all();
  const records = scopes.map(({ key, createdAt }) => initialWorkspaceBookRecords(key, createdAt ?? '1970-01-01T00:00:00.000Z'));
  await database.query(`
    LET seededBooks = (
      FOR value IN @books
        UPSERT { _key: value._key } INSERT value UPDATE {} IN books
        RETURN NEW._key
    )
    LET seededChapters = (
      FOR value IN @chapters
        UPSERT { _key: value._key } INSERT value UPDATE {} IN bookChapters
        RETURN NEW._key
    )
    RETURN LENGTH(seededBooks) + LENGTH(seededChapters)
  `, {
    books: records.map(({ book }) => toArangoDoc(book)),
    chapters: records.flatMap(({ bookChapters }) => bookChapters.map(toArangoDoc)),
  });
}

export const initialAudiobookMigration: GraphMigration = {
  id: '0006-initial-audiobook',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url)]),
  up: addInitialAudiobook,
};
