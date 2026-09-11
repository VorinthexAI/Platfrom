import { describe, expect, test } from 'bun:test';
import { cleanupExpiredConversationAttachmentArtifacts, createConversationAttachmentArtifactRepository } from './attachment-artifacts';

describe('conversation attachment artifact repository', () => {
  test('idempotently inserts prepared records without relying on an INSERT OLD value', async () => {
    let query = '';
    const database = { query: async (value: string) => { query = value; return { all: async () => [] }; } };
    await expect(createConversationAttachmentArtifactRepository(database as never).insertPrepared([])).resolves.toEqual([]);
    expect(query).toContain('UPSERT { _key: value._key }');
    expect(query).not.toContain('OLD');
  });

  test('leases with attempt bounds and fences completion and retry by token', async () => {
    const queries: string[] = [];
    const database = { query: async (query: string) => { queries.push(query); return { next: async () => null }; } };
    const repository = createConversationAttachmentArtifactRepository(database as never);
    await repository.lease('cmadeupkey', 'token', '2026-09-01T00:00:00.000Z', '2026-09-01T00:05:00.000Z');
    await repository.renew('cmadeupkey', 'token', '2026-09-01T00:06:00.000Z');
    await repository.complete('cmadeupkey', 'token', { key: 'cmadeupref', kind: 'document', filename: 'a.txt', mimeType: 'text/plain', sizeBytes: 1 });
    await repository.retry('cmadeupkey', 'token', 'failed', '2026-09-01T00:00:02.000Z', false);
    expect(queries[0]).toContain('artifact.attempts < @maximumAttempts');
    expect(queries[0]).toContain('artifact.leaseExpiresAt <= @now');
    expect(queries[1]).toContain('artifact.status == "PROCESSING"');
    expect(queries[2]).toContain('artifact.leaseToken == @token');
    expect(queries[3]).toContain('artifact.leaseToken == @token');
  });

  test('deletes staged bytes before hard-deleting an expired record', async () => {
    const order: string[] = [];
    const artifact = { key: 'cmadeupkey', stagedStorageKey: 'pending/a', expiresAt: '2026-09-01T00:00:00.000Z' };
    const result = await cleanupExpiredConversationAttachmentArtifacts({ repository: { listExpired: async () => [artifact], removeExpired: async () => { order.push('record'); return true; } } as never, storage: { delete: async () => { order.push('object'); } }, now: () => '2026-09-02T00:00:00.000Z' });
    expect(order).toEqual(['object', 'record']); expect(result).toEqual({ removed: 1 });
  });

  test('settles mixed terminal artifacts as PARTIAL without hiding successful references', async () => {
    let query = '';
    const reference = { key: 'cmadeupref', kind: 'document' as const, filename: 'a.txt', mimeType: 'text/plain' as const, sizeBytes: 1 };
    const database = { query: async (value: string) => { query = value; return { next: async () => ({ userKey: 'cmadeupusr', conversationKey: 'cmadeupcon', status: 'PARTIAL', references: [reference] }) }; } };
    await expect(createConversationAttachmentArtifactRepository(database as never).settleMessage('cmadeupmsg')).resolves.toEqual({ userKey: 'cmadeupusr', conversationKey: 'cmadeupcon', status: 'PARTIAL', references: [reference] });
    expect(query).toContain('LENGTH(references) > 0 ? "PARTIAL"');
    expect(query).toContain('attachments: visibleReferences');
  });
});
