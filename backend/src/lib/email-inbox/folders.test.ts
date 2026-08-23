import { describe, expect, test } from 'bun:test';
import { ensureMailFolders, mailFolderKeys } from './folders';

const scopeKey = 'cmrnlzf640001qc7kazsr96k5';

describe('managed mail folders', () => {
  test('uses deterministic product-neutral purposes and reconciles protected hierarchy idempotently', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const database = { async query(query: string, bindVars?: Record<string, unknown>) { calls.push({ query, bindVars }); return {}; } };
    const first = await ensureMailFolders(database, scopeKey, '2026-08-20T09:00:00.000Z');
    const second = await ensureMailFolders(database, scopeKey, '2026-08-20T09:00:00.000Z');
    expect(first).toEqual(second);
    expect(first).toEqual(mailFolderKeys(scopeKey));
    expect(calls).toHaveLength(10);
    expect(calls.every(({ query }) => query.includes('UPSERT') && query.includes('system-container'))).toBe(true);
    expect(calls.slice(0, 5).map(({ bindVars }) => bindVars?.purpose)).toEqual(['communication-mail-root', 'communication-mail-threads', 'communication-mail-drafts', 'communication-mail-tones', 'communication-mail-settings']);
    expect(calls[0]?.bindVars?.name).toBe('Signal');
    expect(calls.slice(1, 5).every(({ bindVars }) => bindVars?.parentFolderKey === first.root)).toBe(true);
  });
});
