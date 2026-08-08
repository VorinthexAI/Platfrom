import type { Database } from 'arangojs';

const LEGACY_CONTENT_LEDGER = 'archiveIdempotency';
const LEGACY_PROJECT_FOLDER_FIELD = 'archiveFolderKey';

export async function resolveContentLedgerCollection(database: Database, currentCollection: string): Promise<string> {
  return await database.collection(currentCollection).exists() ? currentCollection : LEGACY_CONTENT_LEDGER;
}

export function normalizeLegacyProjectContract(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const project = value as Record<string, unknown>;
  if (project.contentFolderKey != null || typeof project[LEGACY_PROJECT_FOLDER_FIELD] !== 'string') return value;
  return { ...project, contentFolderKey: project[LEGACY_PROJECT_FOLDER_FIELD] };
}
