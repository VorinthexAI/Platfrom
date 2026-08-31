import { describe, expect, test } from 'bun:test';
import { createEmailAttachmentIngestionService, EmailAttachmentIngestionError, type EmailAttachmentRepository } from './attachment-ingestion';
import type { EmailAttachmentBinding } from './attachment-binding-schema';

const organizationKey = 'organization';
const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const membershipKey = 'cmrnlzf650002qc7k4p5zemb0';
const connectorKey = 'cmrnlzf660003qc7kw1n9j93a';
const common = { organizationKey, scopeKey, membershipKey, connectorKey, providerMessageId: 'provider-message' };
const at = new Date('2026-08-25T12:00:00.000Z');

function fixture(options: { exportFailure?: boolean } = {}) {
  const bindings = new Map<string, EmailAttachmentBinding & { storageKey?: string }>();
  const events: string[] = [];
  const uploads: string[] = [];
  const deleted: string[] = [];
  const repository: EmailAttachmentRepository = {
    async activeMembership(input) { return input.preferredMembershipKey; },
    async completed(input) {
      const value = bindings.get(input.key);
      if (!value || value.status !== 'completed') return null;
      if (value.sourceFilename !== input.sourceFilename || value.sourceMimeType !== input.sourceMimeType || value.sourceSize !== input.sourceSize) throw new EmailAttachmentIngestionError('ATTACHMENT_CONFLICT', 'changed metadata', false);
      return value;
    },
    async claim(input, _membershipKey, leaseToken, now, leaseExpiresAt) {
      const existing = bindings.get(input.key);
      if (existing && (existing.contentHash !== input.contentHash || existing.sourceFilename !== input.sourceFilename || existing.sourceMimeType !== input.sourceMimeType || existing.sourceSize !== input.sourceSize)) throw new EmailAttachmentIngestionError('ATTACHMENT_CONFLICT', 'changed source', false);
      if (existing?.status === 'completed') return { status: 'replay', binding: existing };
      const binding = { ...input, status: 'processing' as const, leaseToken, leaseExpiresAt, createdAt: existing?.createdAt ?? now, updatedAt: now };
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
    async complete(key, token, type, targetKey, _collectionKey, _membershipKey, now) {
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
    storage: {
      async upload(input) { uploads.push(input.key); events.push('upload'); return { storageKey: input.key }; },
      async delete(key) { deleted.push(key); events.push('delete'); },
      async download() { return { bytes: new Uint8Array() }; },
      async copy(input) { return { storageKey: input.destinationKey }; },
    },
    exportDatabase: {
      async query(query) {
        events.push('export');
        if (options.exportFailure) throw new Error('export unavailable');
        expect(query).toContain('UPDATE {}');
        expect(query).not.toContain('managedPurpose');
        return { next: async () => undefined } as never;
      },
    },
    parse: async () => ({ document: {} as never }),
    sanitizeImage: async (bytes) => ({ bytes: Uint8Array.from(bytes), coordinates: undefined }),
    processImage: async (input) => { expect(input.origin).toBe('uploaded'); return { key: input.imageKey } as never; },
    now: () => at,
  });
  return { service, repository, bindings, events, uploads, deleted };
}

describe('canonical email attachment ingestion', () => {
  test('persists canonical storage before running an independent export and completing', async () => {
    const f = fixture();
    const result = await f.service.ingest({ ...common, part: { path: '0.1', type: 'document', mimeType: 'text/plain', filename: 'notes.txt', size: 5, data: 'aGVsbG8' }, bytes: new TextEncoder().encode('hello') });
    expect(result).toEqual({ type: 'document', key: expect.any(String) });
    expect(f.events).toEqual(['claim', 'upload', 'persist', 'export', 'complete']);
    expect(f.uploads[0]).toStartWith(`email/${scopeKey}/${connectorKey}/`);
    expect([...f.bindings.values()][0]).toMatchObject({ status: 'completed', storageKey: f.uploads[0] });
  });

  test('does not let an export failure roll back canonical ingestion', async () => {
    const f = fixture({ exportFailure: true });
    await expect(f.service.ingest({ ...common, part: { path: '0.2', type: 'image', mimeType: 'image/png', filename: 'photo.png', size: 4, data: 'iVBORw' }, bytes: new Uint8Array([137, 80, 78, 71]) })).resolves.toMatchObject({ type: 'image' });
    expect([...f.bindings.values()][0]?.status).toBe('completed');
    expect(f.deleted).toEqual([]);
  });

  test('replays a completed source without uploading and repairs its independent export', async () => {
    const f = fixture();
    const input = { ...common, part: { path: '0.3', type: 'document' as const, mimeType: 'text/plain', filename: 'same.txt', size: 4, data: 'c2FtZQ' }, bytes: new TextEncoder().encode('same') };
    const first = await f.service.ingest(input);
    const eventCount = f.events.length;
    expect(await f.service.ingest(input)).toEqual(first);
    expect(f.events).toHaveLength(eventCount + 1);
    expect(f.events.at(-1)).toBe('export');
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
