import { createHash } from 'node:crypto';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';

export type MailFolderKind = 'root' | 'threads' | 'drafts' | 'tones' | 'settings';

const definitions = [
  { kind: 'root', purpose: 'communication-mail-root', name: 'Signal' },
  { kind: 'threads', purpose: 'communication-mail-threads', name: 'Threads' },
  { kind: 'drafts', purpose: 'communication-mail-drafts', name: 'Drafts' },
  { kind: 'tones', purpose: 'communication-mail-tones', name: 'Tones' },
  { kind: 'settings', purpose: 'communication-mail-settings', name: 'Settings' },
] as const;

export function mailFolderKey(scopeKey: string, purpose: string) {
  return `c${createHash('sha256').update(`managed-mail-folder\0${scopeKey}\0${purpose}`).digest('hex').slice(0, 24)}`;
}

export function mailFolderKeys(scopeKey: string): Record<MailFolderKind, string> {
  return Object.fromEntries(definitions.map(({ kind, purpose }) => [kind, mailFolderKey(scopeKey, purpose)])) as Record<MailFolderKind, string>;
}

export async function ensureMailFolders(database: { query(query: string, bindVars?: Record<string, unknown>): Promise<unknown> }, scopeKey: string, at = new Date().toISOString()) {
  const keys = mailFolderKeys(scopeKey);
  const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);
  for (const item of definitions) {
    await database.query(`
      UPSERT { scopeKey: @scopeKey, purpose: @purpose }
        INSERT MERGE({ _key: @key, scopeKey: @scopeKey, name: @name, purpose: @purpose, mutationPolicy: "system-container", embedding: @embedding, isFavorite: false, createdAt: @at, updatedAt: @at }, @parentFolderKey == null ? {} : { parentFolderKey: @parentFolderKey })
        UPDATE { parentFolderKey: @parentFolderKey, name: @name, mutationPolicy: "system-container", updatedAt: OLD.name == @name && OLD.parentFolderKey == @parentFolderKey && OLD.mutationPolicy == "system-container" ? OLD.updatedAt : @at } IN folders OPTIONS { keepNull: false }
    `, { key: keys[item.kind], scopeKey, purpose: item.purpose, parentFolderKey: item.kind === 'root' ? null : keys.root, name: item.name, embedding, at });
  }
  return keys;
}
