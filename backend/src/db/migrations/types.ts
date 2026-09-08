import type { Database } from 'arangojs';

export type GraphMigration = {
  id: string;
  checksum: () => Promise<string>;
  up: (database: Database) => Promise<void>;
};
