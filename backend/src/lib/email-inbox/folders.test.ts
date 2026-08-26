import { describe, expect, test } from 'bun:test';
import { ensureMailFolders, ensureMailInboxFilesFolder, mailFolderKeys, mailInboxFilesFolderKey, mailInboxFolderKey } from './folders';

const scopeKey = 'cmrnlzf640001qc7kazsr96k5';

describe('managed mail folders', () => {
  test('uses deterministic product-neutral purposes and reconciles protected hierarchy idempotently', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const database = { async query(query: string, bindVars?: Record<string, unknown>) { calls.push({ query, bindVars }); return {}; } };
    const first = await ensureMailFolders(database, scopeKey, '2026-08-20T09:00:00.000Z');
    const second = await ensureMailFolders(database, scopeKey, '2026-08-20T09:00:00.000Z');
    expect(first).toEqual(second);
    expect(first).toEqual(mailFolderKeys(scopeKey));
    expect(calls).toHaveLength(14);
    expect(calls.every(({ query }) => query.includes('UPSERT') && query.includes('system-container'))).toBe(true);
    expect(calls.slice(0, 7).map(({ bindVars }) => bindVars?.purpose)).toEqual(['communication-mail-root', 'communication-mail-inboxes', 'communication-mail-threads', 'communication-mail-drafts', 'communication-mail-tones', 'communication-mail-reply-context', 'communication-mail-settings']);
    expect(calls[0]?.bindVars?.name).toBe('Signal');
    expect(calls.slice(1, 7).every(({ bindVars }) => bindVars?.parentFolderKey === first.root)).toBe(true);
    expect(calls.slice(0, 7).map(({ bindVars }) => bindVars?.archiveVisibility)).toEqual(['visible', 'visible', 'domain-only', 'domain-only', 'visible', 'domain-only', 'domain-only']);
    expect(mailInboxFolderKey(scopeKey, 'connector')).toBe(mailInboxFolderKey(scopeKey, 'connector'));
  });

  test('retries transient Arango write conflicts during concurrent initialization', async () => {
    let calls = 0;
    const database = { async query() { calls += 1; if (calls === 1) throw Object.assign(new Error('conflict'), { errorNum: 1200 }); return {}; } };
    await expect(ensureMailFolders(database, scopeKey)).resolves.toEqual(mailFolderKeys(scopeKey));
    expect(calls).toBe(8);
  });

  test('creates one visible protected Files folder beneath each inbox', async () => {
    const connectorKey = 'cmrnlzf650002qc7k4p5zem5w';
    let query = '';
    let bindVars: Record<string, unknown> | undefined;
    const key = mailInboxFilesFolderKey(scopeKey, connectorKey);
    const database = { async query(value: string, vars?: Record<string, unknown>) { query = value; bindVars = vars; return { next: async () => key }; } };
    await expect(ensureMailInboxFilesFolder(database, scopeKey, connectorKey)).resolves.toBe(key);
    expect(bindVars).toMatchObject({ key, scopeKey, connectorKey, inboxFolderKey: mailInboxFolderKey(scopeKey, connectorKey) });
    expect(query).toContain('name: "Files"');
    expect(query).toContain('managedPurpose: "mail-inbox-files"');
    expect(query).toContain('archiveVisibility: "visible"');
  });
});
