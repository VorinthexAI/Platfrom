import { createHash } from 'node:crypto';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';

export type MailFolderKind = 'root' | 'inboxes' | 'threads' | 'drafts' | 'tones' | 'replyContext' | 'settings';

const definitions = [
  { kind: 'root', purpose: 'communication-mail-root', name: 'Signal', archiveVisibility: 'visible' },
  { kind: 'inboxes', purpose: 'communication-mail-inboxes', name: 'Inboxes', archiveVisibility: 'visible' },
  { kind: 'threads', purpose: 'communication-mail-threads', name: 'Threads', archiveVisibility: 'domain-only' },
  { kind: 'drafts', purpose: 'communication-mail-drafts', name: 'Drafts', archiveVisibility: 'domain-only' },
  { kind: 'tones', purpose: 'communication-mail-tones', name: 'Tones', archiveVisibility: 'visible' },
  { kind: 'replyContext', purpose: 'communication-mail-reply-context', name: 'Reply context', archiveVisibility: 'domain-only' },
  { kind: 'settings', purpose: 'communication-mail-settings', name: 'Settings', archiveVisibility: 'domain-only' },
] as const;

export function mailFolderKey(scopeKey: string, purpose: string) {
  return `c${createHash('sha256').update(`managed-mail-folder\0${scopeKey}\0${purpose}`).digest('hex').slice(0, 24)}`;
}

export function mailFolderKeys(scopeKey: string): Record<MailFolderKind, string> {
  return Object.fromEntries(definitions.map(({ kind, purpose }) => [kind, mailFolderKey(scopeKey, purpose)])) as Record<MailFolderKind, string>;
}

export function mailInboxFolderKey(scopeKey: string, connectorKey: string) {
  return mailFolderKey(scopeKey, `mail-inbox\0${connectorKey}`);
}

export function mailInboxFilesFolderKey(scopeKey: string, connectorKey: string) {
  return mailFolderKey(scopeKey, `mail-inbox-files\0${connectorKey}`);
}

export async function ensureMailFolders(database: { query(query: string, bindVars?: Record<string, unknown>): Promise<unknown> }, scopeKey: string, at = new Date().toISOString()) {
  const keys = mailFolderKeys(scopeKey);
  const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);
  for (const item of definitions) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await database.query(`
          UPSERT { scopeKey: @scopeKey, purpose: @purpose }
            INSERT MERGE({ _key: @key, scopeKey: @scopeKey, name: @name, purpose: @purpose, mutationPolicy: "system-container", archiveVisibility: @archiveVisibility, embedding: @embedding, isFavorite: false, createdAt: @at, updatedAt: @at }, @parentFolderKey == null ? {} : { parentFolderKey: @parentFolderKey })
            UPDATE { parentFolderKey: @parentFolderKey, name: @name, mutationPolicy: "system-container", archiveVisibility: @archiveVisibility, updatedAt: OLD.name == @name && OLD.parentFolderKey == @parentFolderKey && OLD.mutationPolicy == "system-container" && OLD.archiveVisibility == @archiveVisibility ? OLD.updatedAt : @at } IN folders OPTIONS { keepNull: false }
        `, { key: keys[item.kind], scopeKey, purpose: item.purpose, parentFolderKey: item.kind === 'root' ? null : keys.root, name: item.name, archiveVisibility: item.archiveVisibility, embedding, at });
        break;
      } catch (error) {
        const conflict = error && typeof error === 'object' && (('errorNum' in error && error.errorNum === 1200) || ('code' in error && error.code === 409));
        if (!conflict || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 5));
      }
    }
  }
  return keys;
}

export async function ensureMailInboxFilesFolder(database: { query(query: string, bindVars?: Record<string, unknown>): Promise<{ next(): Promise<unknown> }> }, scopeKey: string, connectorKey: string, at = new Date().toISOString()) {
  const inboxFolderKey = mailInboxFolderKey(scopeKey, connectorKey);
  const key = mailInboxFilesFolderKey(scopeKey, connectorKey);
  const cursor = await database.query(`LET parent = DOCUMENT(folders, @inboxFolderKey)
    FILTER parent != null && parent.scopeKey == @scopeKey && parent.managedPurpose == "mail-inbox" && parent.managedOwnerKey == @connectorKey
    LET folder = FIRST(UPSERT { _key: @key }
      INSERT { _key: @key, scopeKey: @scopeKey, parentFolderKey: @inboxFolderKey, name: "Files", description: "Documents synchronized from email attachments", managedPurpose: "mail-inbox-files", managedOwnerKey: @connectorKey, mutationPolicy: "system-container", archiveVisibility: "visible", embedding: @embedding, isFavorite: false, createdAt: @at, updatedAt: @at }
      UPDATE (OLD.scopeKey == @scopeKey && OLD.managedPurpose == "mail-inbox-files" && OLD.managedOwnerKey == @connectorKey ? { parentFolderKey: @inboxFolderKey, name: "Files", mutationPolicy: "system-container", archiveVisibility: "visible", updatedAt: OLD.parentFolderKey == @inboxFolderKey && OLD.name == "Files" && OLD.mutationPolicy == "system-container" && OLD.archiveVisibility == "visible" ? OLD.updatedAt : @at } : {}) IN folders RETURN NEW)
    FILTER folder.scopeKey == @scopeKey && folder.parentFolderKey == @inboxFolderKey && folder.managedPurpose == "mail-inbox-files" && folder.managedOwnerKey == @connectorKey && folder.mutationPolicy == "system-container"
    RETURN folder._key`, { key, scopeKey, inboxFolderKey, connectorKey, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), at });
  if (await cursor.next() !== key) throw new Error('Deterministic mail inbox Files folder belongs to another managed resource');
  return key;
}
