import { z } from 'zod';
import { db } from '@/lib/db/client';
import { MANAGED_SCOPE_DIRECTORY_PURPOSE } from './manifest';
import type { ManagedScopeDirectoryDatabase } from './repository';

export const managedScopeDirectoryCatalogEntrySchema = z.object({
  key: z.string().cuid(),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  detailedDescription: z.string().trim().min(1),
}).strict();
export type ManagedScopeDirectoryCatalogEntry = z.infer<typeof managedScopeDirectoryCatalogEntrySchema>;
const catalogRowSchema = z.object({ key: z.string().cuid(), name: z.string().trim().min(1), kind: z.enum(['Brief', 'Description']), content: z.string().trim().min(1) }).strict();

export async function readManagedScopeDirectoryCatalog(motherScopeKey: string, database: ManagedScopeDirectoryDatabase = db): Promise<ManagedScopeDirectoryCatalogEntry[]> {
  const scopeKey = z.string().cuid().parse(motherScopeKey);
  const rows = await (await database.query(`
    FOR folder IN folders
      FILTER folder.scopeKey == @scopeKey && folder.managedPurpose == @purpose && folder.mutationPolicy == "system-container"
      FOR document IN documents
        FILTER document.scopeKey == @scopeKey && document.folderKey == folder._key
        FILTER document.managedPurpose == @purpose && document.mutationPolicy == "system-only"
        FILTER document.name IN ["Brief", "Description"] && document.managedOwnerKey == folder.managedOwnerKey
        SORT folder.name ASC, document.name ASC
        RETURN { key: folder.managedOwnerKey, name: folder.name, kind: document.name, content: document.content }
  `, { scopeKey, purpose: MANAGED_SCOPE_DIRECTORY_PURPOSE })).all();
  const entries = new Map<string, { key: string; name: string; description?: string; detailedDescription?: string }>();
  for (const value of rows) {
    const row = catalogRowSchema.parse(value);
    const entry = entries.get(row.key) ?? { key: row.key, name: row.name };
    if (entry.name !== row.name) throw new Error('Managed scope directory owner is assigned to multiple product folders.');
    if (row.kind === 'Brief') {
      if (entry.description !== undefined) throw new Error(`Managed scope directory has duplicate Brief content for ${row.name}.`);
      entry.description = row.content;
    } else {
      if (entry.detailedDescription !== undefined) throw new Error(`Managed scope directory has duplicate Description content for ${row.name}.`);
      entry.detailedDescription = row.content;
    }
    entries.set(row.key, entry);
  }
  if (entries.size !== 7) throw new Error(`Managed scope directory catalog is incomplete: expected 7 products, found ${entries.size}.`);
  return [...entries.values()].map((entry) => managedScopeDirectoryCatalogEntrySchema.parse(entry));
}
