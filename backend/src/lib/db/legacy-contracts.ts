import type { Database } from 'arangojs';

const LEGACY_CONTENT_LEDGER = 'archiveIdempotency';

export async function resolveContentLedgerCollection(database: Database, currentCollection: string): Promise<string> {
  return await database.collection(currentCollection).exists() ? currentCollection : LEGACY_CONTENT_LEDGER;
}
