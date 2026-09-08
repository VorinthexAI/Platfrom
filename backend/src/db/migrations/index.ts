import { legacySchemaMigration } from './0001-legacy-schema';
import type { GraphMigration } from './types';

// Add each new migration here once. Applied entries are immutable.
export const graphMigrations: readonly GraphMigration[] = [legacySchemaMigration];
