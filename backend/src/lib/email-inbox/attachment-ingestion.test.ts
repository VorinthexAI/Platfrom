import { describe, expect, test } from 'bun:test';
import { createEmailAttachmentIngestionService, EmailAttachmentIngestionError, type EmailAttachmentRepository } from './attachment-ingestion';
import type { EmailAttachmentBinding } from './attachment-binding-schema';
import { GmailApiError, GmailPermanentAttachmentError } from './gmail';
import { toArangoDoc } from '@/lib/db/base';

const teamKey = 'team';
const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const teamMembershipKey = 'cmrnlzf650002qc7k4p5zemb0';
const connectorKey = 'cmrnlzf660003qc7kw1n9j93a';
const billingUserKey = 'cmrnlzf670004qc7kw1n9j94b';
const common = { userKey: billingUserKey, teamKey, scopeKey, teamMembershipKey, billingUserKey, connectorKey, providerMessageId: 'provider-message' };
const at = new Date('2026-08-25T12:00:00.000Z');

function fixture(options: { exportFailure?: boolean } = {}) {
  const bindings = new Map<string, EmailAttachmentBinding & { userKey: string; storageKey?: string; exportPending?: boolean }>();
  const events: string[] = [];
  const uploads: Array<{ key: string; billingUserKey?: string }> = [];
  const deleted: string[] = [];
  const repository: EmailAttachmentRepository = {
    async markExported(key) { const value = bindings.get(key); if (value) bindings.set(key, { ...value, exportPending: false }); },
    async activeMembership(input) { return input.preferredTeamMembershipKey; },
    async completed(input) {
      const value = bindings.get(input.key);
      if (!value || value.status !== 'completed') return null;
      if (value.sourceFilename !== input.sourceFilename || value.sourceMimeType !== input.sourceMimeType || value.sourceSize !== input.sourceSize) throw new EmailAttachmentIngestionError('ATTACHMENT_CONFLICT', 'changed metadata', false);
      return value;
    },
    async claim(input, _teamMembershipKey, leaseToken, now, leaseExpiresAt) {
      const existing = bindings.get(input.key);
      if (existing && (existing.contentHash !== input.contentHash || existing.sourceFilename !== input.sourceFilename || existing.sourceMimeType !== input.sourceMimeType || existing.sourceSize !== input.sourceSize)) throw new EmailAttachmentIngestionError('ATTACHMENT_CONFLICT', 'changed source', false);
      if (existing?.status === 'completed') return { status: 'replay', binding: existing };
      const binding = { ...input, exportPending: true, status: 'processing' as const, leaseToken, leaseExpiresAt, createdAt: existing?.createdAt ?? now, updatedAt: now };
      bindings.set(input.key, binding);
      events.push('claim');
      return { status: 'claimed', binding };
    },
    async persistStorage(key, _token, storageKey, now) {
      const current = bindings.get(key);
      if (!current) return false;
      bindings.set(key, { ...current, storageKey, updatedAt: now });
      events.push('persist');
      return true;
    },
    async renew() { return true; },
    async complete(key, token, type, targetKey, _collectionKey, _teamMembershipKey, now) {
      const current = bindings.get(key);
      if (!current || current.leaseToken !== token || targetKey !== key || current.targetType !== type || !current.storageKey) return false;
      bindings.set(key, { ...current, status: 'completed', leaseToken: undefined, leaseExpiresAt: undefined, updatedAt: now });
      events.push('complete');
      return true;
    },
    async compensateTarget(key, token) {
      const current = bindings.get(key);
      if (current?.status === 'processing' && current.leaseToken === token) bindings.delete(key);
      events.push('compensate');
    },
    async release(key, token) {
      const current = bindings.get(key);
      if (current?.status === 'processing' && current.leaseToken === token) bindings.delete(key);
    },
  };
  const service = createEmailAttachmentIngestionService({
    repository,
    publishScopeEvent: async () => undefined,
    storage: {
      async upload(input) { uploads.push({ key: input.key, billingUserKey: input.billingUserKey }); events.push('upload'); return { storageKey: input.key }; },
      async delete(key) { deleted.push(key); events.push('delete'); },
      async download() { return { bytes: new Uint8Array() }; },
      async copy(input) { return { storageKey: input.destinationKey }; },
    },
    exportDatabase: {
      async query(query) {
        if (String(query).startsWith('FOR inbox')) events.push('export');
        if (options.exportFailure) throw new Error('export unavailable');
        return { next: async () => String(query).startsWith('FOR inbox') ? 'Inbox' : undefined } as never;
      },
    },
    parse: async () => ({ document: {} as never }),
    ingestGalleryUpload: async (input) => { expect(input).toMatchObject({ userKey: billingUserKey, mimeType: 'image/png' }); return { key: input.imageKey } as never; },
    now: () => at,
  });
  return { service, repository, bindings, events, uploads, deleted };
}

describe('canonical email attachment ingestion', () => {
  test('recovers a persisted export and retries its event without reprocessing or losing the intent', async () => {
    let published = 0, acknowledged = 0, parsed = 0;
    const value = toArangoDoc({ key: connectorKey, userKey: billingUserKey, teamKey, scopeKey, connectorKey, providerMessageId: 'message', partPath: '0.1', contentHash: 'a'.repeat(64), kind: 'document', filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 5, storageKey: 'canonical/bytes', status: 'completed', exportPending: true, createdAt: at.toISOString(), updatedAt: at.toISOString() });
    const service = createEmailAttachmentIngestionService({
      repository: { activeMembership: async () => teamMembershipKey, markExported: async (key: string, owner: string) => { expect(key).toBe(connectorKey); expect(owner).toBe(billingUserKey); acknowledged += 1; } } as never,
      exportDatabase: { query: async (query: string) => ({ next: async () => query.startsWith('LET attachment') ? value : true }) } as never,
      storage: { download: async () => ({ bytes: new TextEncoder().encode('hello') }) } as never,
      parse: async () => { parsed += 1; throw new Error('must reuse the existing export'); },
      publishScopeEvent: async () => { published += 1; if (published === 1) throw new Error('event transport unavailable'); },
    });
    await expect(service.retryExport(connectorKey)).rejects.toThrow('remains pending');
    expect(acknowledged).toBe(0);
    await service.retryExport(connectorKey);
    expect({ published, acknowledged, parsed }).toEqual({ published: 2, acknowledged: 1, parsed: 0 });
  });
  test('staging retains valid parts and records permanent failures without aborting the message', async () => {
    const f = fixture();
    const result = await f.service.stageMessage({
      ...common, connectorLeaseToken: 'lease', heartbeat: async () => undefined,
      message: { id: 'message', threadId: 'thread', payload: { mimeType: 'multipart/mixed', parts: [
        { mimeType: 'image/png', filename: 'bad.png', body: { size: 4, attachmentId: 'bad' } },
        { mimeType: 'text/plain', filename: 'good.txt', body: { size: 5, attachmentId: 'good' } },
      ] } },
      gmail: { attachment: async (_id: string, part: { filename: string }) => { if (part.filename === 'bad.png') throw new GmailPermanentAttachmentError('ATTACHMENT_MALFORMED_PAYLOAD', 'bad signature'); return new TextEncoder().encode('hello'); } } as never,
    });
    expect(result).toMatchObject({ availability: 'failed', unavailableCount: 1, refs: [{ type: 'document' }] });
    expect(result.staged).toHaveLength(1);
    expect(f.deleted).toEqual([]);
  });

  test('staging still retries transient provider errors', async () => {
    const f = fixture();
    await expect(f.service.stageMessage({ ...common, connectorLeaseToken: 'lease', heartbeat: async () => undefined,
      message: { id: 'message', threadId: 'thread', payload: { mimeType: 'text/plain', filename: 'good.txt', body: { size: 5, attachmentId: 'good' } } },
      gmail: { attachment: async () => { throw new GmailApiError(503); } } as never,
    })).rejects.toThrow('503');
  });
  test('persists canonical storage before running an independent export and completing', async () => {
    const f = fixture();
    const result = await f.service.ingest({ ...common, part: { path: '0.1', type: 'document', mimeType: 'text/plain', filename: 'notes.txt', size: 5, data: 'aGVsbG8' }, bytes: new TextEncoder().encode('hello') });
    expect(result).toEqual({ type: 'document', key: expect.any(String) });
    expect(f.events).toEqual(['claim', 'upload', 'persist', 'export', 'complete']);
    expect(f.uploads[0]).toEqual({ key: expect.stringMatching(new RegExp(`^email/${scopeKey}/${connectorKey}/`)), billingUserKey });
    expect([...f.bindings.values()][0]).toMatchObject({ status: 'completed', storageKey: f.uploads[0]!.key, exportPending: false });
  });

  test('does not let an export failure roll back canonical ingestion', async () => {
    const f = fixture({ exportFailure: true });
    await expect(f.service.ingest({ ...common, part: { path: '0.2', type: 'image', mimeType: 'image/png', filename: 'photo.png', size: 4, data: 'iVBORw' }, bytes: new Uint8Array([137, 80, 78, 71]) })).resolves.toMatchObject({ type: 'image' });
    expect([...f.bindings.values()][0]?.status).toBe('completed');
    expect([...f.bindings.values()][0]?.exportPending).toBe(true);
    expect(f.deleted).toEqual([]);
  });

  test('replays a completed source without uploading or recreating acknowledged exports', async () => {
    const f = fixture();
    const input = { ...common, part: { path: '0.3', type: 'document' as const, mimeType: 'text/plain', filename: 'same.txt', size: 4, data: 'c2FtZQ' }, bytes: new TextEncoder().encode('same') };
    const first = await f.service.ingest(input);
    const eventCount = f.events.length;
    expect(await f.service.ingest(input)).toEqual(first);
    expect(f.events).toHaveLength(eventCount);
    expect(f.events.at(-1)).toBe('complete');
    expect(f.uploads).toHaveLength(1);
  });

  test('keeps deferred canonical metadata processing until the mail transaction completes', async () => {
    const f = fixture();
    const input = { ...common, connectorLeaseToken: '11111111-1111-4111-8111-111111111111', heartbeat: async () => undefined, part: { path: '0.4', type: 'document' as const, mimeType: 'text/plain', filename: 'staged.txt', size: 6, data: 'c3RhZ2Vk' }, bytes: new TextEncoder().encode('staged'), deferCompletion: true };
    const staged = await f.service.ingest(input);
    expect(f.bindings.get(staged.staged.bindingKey)?.status).toBe('processing');
    await f.service.compensate([staged.staged], scopeKey);
    expect(f.bindings.size).toBe(0);
    expect(f.deleted).toEqual([staged.staged.storageKey]);
  });

  test('rejects a changed immutable source identity', async () => {
    const f = fixture();
    const part = { path: '0.5', type: 'document' as const, mimeType: 'text/plain', filename: 'stable.txt', size: 3, data: 'b25l' };
    await f.service.ingest({ ...common, part, bytes: new TextEncoder().encode('one') });
    await expect(f.service.ingest({ ...common, part: { ...part, filename: 'changed.txt' }, bytes: new TextEncoder().encode('one') })).rejects.toMatchObject({ code: 'ATTACHMENT_CONFLICT', retryable: false });
  });
});
