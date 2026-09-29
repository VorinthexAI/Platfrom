import { schemaMigration } from './0001-schema';
import type { GraphMigration } from './types';

export const graphMigrations: readonly GraphMigration[] = [schemaMigration];
