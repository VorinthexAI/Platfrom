import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { newId } from '@/lib/ids';
import {
  completeTransientAttachments,
  reserveTransientAttachments,
  transientAttachmentReserveInputSchema,
  validateCoreAttachmentImageBytes,
  type TransientAttachmentDependencies,
  type TransientAttachmentOwner,
  type TransientAttachmentRecord,
} from './transient-attachments';
import { CORE_CHAT_MAX_IMAGE_BYTES } from '@/lib/ai/actions/core-chat';
import { documentValidate } from '@/lib/ai/document-processing';

const teamKey = 'team';
const scopeKey = newId();
const userKey = newId();
const conversationKey = newId();
const owner: TransientAttachmentOwner = { teamKey, scopeKey, userKey };
const now = new Date('2026-09-02T12:00:00.000Z');

function harness() {
  const values = new Map<string, string>();
  const objects = new Map<string, { bytes: Uint8Array; mimeType: string }>();
  const deleted: string[] = [];
  const artifacts = new Map<string, any>();
  const redis = {
    async get(key: string) { return values.get(key) ?? null; },
    async set(key: string, value: string, ...args: unknown[]) { if (args.includes('NX') && values.has(key)) return null; values.set(key, value); return 'OK'; },
    async del(...keys: string[]) { keys.forEach((key) => values.delete(key)); return keys.length; },
    async eval() { throw new Error('Use the injected transition.'); },
  };
  const dependencies: TransientAttachmentDependencies = {
    redis: redis as never,
    repository: { read: async (selected, key) => selected.teamKey === teamKey && selected.scopeKey === scopeKey && selected.userKey === userKey && key === conversationKey ? {} as never : null },
    storage: {
      async upload({ key, bytes, mimeType }) { objects.set(key, { bytes: new Uint8Array(bytes), mimeType }); return { storageKey: key }; },
      async download(key) { const value = objects.get(key); if (!value) throw new Error('missing object'); return { ...value, sizeBytes: value.bytes.byteLength }; },
      async delete(key) { deleted.push(key); objects.delete(key); },
      async copy() { throw new Error('not used'); },
    },
    signUpload: async (record) => `https://uploads.test/${record.key}`,
    inspectObject: async (key) => { const value = objects.get(key); return value ? { sizeBytes: value.bytes.byteLength, mimeType: value.mimeType } : {}; },
    transition: async (record, next) => {
      const key = `conversation-attachment:${record.key}`;
      const current = values.get(key);
      if (!current) return false;
      const parsed = JSON.parse(current) as TransientAttachmentRecord;
      if (parsed.status !== record.status || parsed.binding !== record.binding) return false;
      values.set(key, JSON.stringify(next));
      return true;
    },
    now: () => now,
    ownerKey: userKey,
    artifacts: {
      async insertPrepared(records) { for (const record of records) artifacts.set(record.key, record); return records; },
      async readBound(selected, selectedConversationKey, requestKey, keys) { return keys.map((key) => artifacts.get(key)).filter((record) => record && record.teamKey === selected.teamKey && record.scopeKey === selected.scopeKey && record.userKey === selected.userKey && record.conversationKey === selectedConversationKey && record.requestKey === requestKey); },
    },
  };
  return { values, objects, deleted, artifacts, dependencies };
}

describe('transient conversation attachments', () => {
  test('enforces the aggregate 16 MiB canonical image limit', () => {
    const image = (sizeBytes: number) => ({ kind: 'image' as const, filename: 'a.png', mimeType: 'image/png' as const, sizeBytes, width: 1, height: 1, storageKey: 'pending/a' });
    expect(() => validateCoreAttachmentImageBytes([image(8 * 1024 * 1024), image(8 * 1024 * 1024)])).not.toThrow();
    expect(() => validateCoreAttachmentImageBytes([image(8 * 1024 * 1024), image(8 * 1024 * 1024 + 1)])).toThrow('16 MiB');
  });
  test('strictly accepts only supported extension and MIME pairs', () => {
    expect(() => transientAttachmentReserveInputSchema.parse({ conversationKey, requestKey: 'request-1', files: [{ clientKey: 'a', filename: 'photo.gif', mimeType: 'image/gif', sizeBytes: 10 }] })).toThrow();
    expect(() => transientAttachmentReserveInputSchema.parse({ conversationKey, requestKey: 'request-1', files: [{ clientKey: 'a', filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 10, extra: true }] })).toThrow('Unrecognized key');
    expect(transientAttachmentReserveInputSchema.parse({ conversationKey, requestKey: 'request-1', files: [{ clientKey: 'a', filename: 'notes.md', mimeType: 'text/plain', sizeBytes: 10 }] }).files[0]!.filename).toBe('notes.md');
  });

  test('binds reservations to the owner, conversation, and request and prepares sanitized images plus validated documents', async () => {
    const context = harness();
    const png = new Uint8Array(await sharp({ create: { width: 2, height: 3, channels: 4, background: '#336699' } }).png().toBuffer());
    const text = new TextEncoder().encode('First\r\n\r\nSecond');
    const reserved = await reserveTransientAttachments({ conversationKey, requestKey: 'request-1', files: [
      { clientKey: 'image', filename: 'photo.png', mimeType: 'image/png', sizeBytes: png.byteLength },
      { clientKey: 'document', filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: text.byteLength },
    ] }, owner, context.dependencies);
    expect(reserved.uploads).toHaveLength(2);
    expect(reserved.uploads[0]).toMatchObject({ clientKey: 'image', headers: { 'Content-Type': 'image/png' } });
    for (const [index, upload] of reserved.uploads.entries()) {
      const record = JSON.parse(context.values.get(`conversation-attachment:${upload.attachmentKey}`)!) as TransientAttachmentRecord;
      expect(record).toMatchObject({ teamKey, scopeKey, userKey, conversationKey, requestKey: 'request-1', status: 'reserved' });
      context.objects.set(record.storageKey, index === 0 ? { bytes: png, mimeType: 'image/png' } : { bytes: text, mimeType: 'text/plain' });
    }
    const completed = await completeTransientAttachments({ conversationKey, requestKey: 'request-1', attachmentKeys: reserved.uploads.map(({ attachmentKey }) => attachmentKey) }, owner, context.dependencies);
    expect(completed.attachments).toEqual([
      expect.objectContaining({ kind: 'image', mimeType: 'image/png', width: 2, height: 3, status: 'prepared' }),
      expect.objectContaining({ kind: 'document', status: 'prepared' }),
    ]);
    expect(JSON.stringify(completed)).not.toContain('storageKey');
    expect(JSON.stringify(completed)).not.toContain('First');
    const document = context.artifacts.get(reserved.uploads[1]!.attachmentKey);
    expect(document.kind).toBe('document');
    expect(typeof document.stagedStorageKey).toBe('string');
    expect(document).not.toHaveProperty('documentContent');
    expect(context.deleted.filter((key) => key.includes('/original.'))).toHaveLength(1);
    expect([...context.objects.keys()]).toContain(document.stagedStorageKey);
  });

  test('prepares twelve uploads with bounded concurrency two', async () => {
    const context = harness(); const text = new TextEncoder().encode('bounded'); let active = 0; let maximum = 0;
    const files = Array.from({ length: 12 }, (_, index) => ({ clientKey: `document-${index}`, filename: `notes-${index}.txt`, mimeType: 'text/plain' as const, sizeBytes: text.byteLength }));
    const reserved = await reserveTransientAttachments({ conversationKey, requestKey: 'bounded', files }, owner, context.dependencies);
    for (const upload of reserved.uploads) { const record = JSON.parse(context.values.get(`conversation-attachment:${upload.attachmentKey}`)!) as TransientAttachmentRecord; context.objects.set(record.storageKey, { bytes: text, mimeType: 'text/plain' }); }
    const completed = await completeTransientAttachments({ conversationKey, requestKey: 'bounded', attachmentKeys: reserved.uploads.map(({ attachmentKey }) => attachmentKey) }, owner, { ...context.dependencies, validateDocument: async (...args) => { active += 1; maximum = Math.max(maximum, active); try { await new Promise((resolve) => setTimeout(resolve, 3)); return await documentValidate(...args); } finally { active -= 1; } } });
    expect(maximum).toBe(2);
    expect(completed.attachments).toHaveLength(12);
  });

  test('downscales canonical PNG images to the Core model byte limit', async () => {
    const context = harness();
    const input = new Uint8Array(await sharp({ create: { width: 2, height: 2, channels: 4, background: '#336699' } }).png().toBuffer());
    const noisy = randomBytes(1_400 * 1_400 * 3);
    const oversized = new Uint8Array(await sharp(noisy, { raw: { width: 1_400, height: 1_400, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer());
    expect(oversized.byteLength).toBeGreaterThan(CORE_CHAT_MAX_IMAGE_BYTES);
    const reserved = await reserveTransientAttachments({ conversationKey, requestKey: 'large-image', files: [{ clientKey: 'image', filename: 'photo.png', mimeType: 'image/png', sizeBytes: input.byteLength }] }, owner, context.dependencies);
    const key = reserved.uploads[0]!.attachmentKey;
    const record = JSON.parse(context.values.get(`conversation-attachment:${key}`)!) as TransientAttachmentRecord;
    context.objects.set(record.storageKey, { bytes: input, mimeType: 'image/png' });
    const completed = await completeTransientAttachments({ conversationKey, requestKey: 'large-image', attachmentKeys: [key] }, owner, { ...context.dependencies, sanitizeImage: async () => ({ bytes: oversized, coordinates: undefined }) });
    expect(completed.attachments[0]).toMatchObject({ kind: 'image', mimeType: 'image/png', status: 'prepared' });
    expect(completed.attachments[0]!.sizeBytes).toBeLessThanOrEqual(CORE_CHAT_MAX_IMAGE_BYTES);
  });

  test('rejects cross-owner completion and removes Redis coordination after durable preparation', async () => {
    const context = harness();
    const text = new TextEncoder().encode('Claim me');
    const reserved = await reserveTransientAttachments({ conversationKey, requestKey: 'request-2', files: [{ clientKey: 'document', filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: text.byteLength }] }, owner, context.dependencies);
    const key = reserved.uploads[0]!.attachmentKey;
    const record = JSON.parse(context.values.get(`conversation-attachment:${key}`)!) as TransientAttachmentRecord;
    context.objects.set(record.storageKey, { bytes: text, mimeType: 'text/plain' });
    await expect(completeTransientAttachments({ conversationKey, requestKey: 'request-2', attachmentKeys: [key] }, { ...owner, userKey: newId() }, context.dependencies)).rejects.toMatchObject({ code: 'ATTACHMENT_CONVERSATION_NOT_FOUND' });
    await completeTransientAttachments({ conversationKey, requestKey: 'request-2', attachmentKeys: [key] }, owner, context.dependencies);
    expect(context.values.has(`conversation-attachment:${key}`)).toBe(false);
    expect(context.artifacts.get(key)).toMatchObject({ status: 'PREPARED', stagedStorageKey: record.storageKey });
    expect(context.objects.has(record.storageKey)).toBe(true);
  });

  test('completion replay reads the durable artifact without Redis', async () => {
    const context = harness();
    const text = new TextEncoder().encode('Recover me');
    const reserved = await reserveTransientAttachments({ conversationKey, requestKey: 'recovery', files: [{ clientKey: 'document', filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: text.byteLength }] }, owner, context.dependencies);
    const key = reserved.uploads[0]!.attachmentKey;
    const record = JSON.parse(context.values.get(`conversation-attachment:${key}`)!) as TransientAttachmentRecord;
    context.objects.set(record.storageKey, { bytes: text, mimeType: 'text/plain' });
    await completeTransientAttachments({ conversationKey, requestKey: 'recovery', attachmentKeys: [key] }, owner, context.dependencies);
    const replay = await completeTransientAttachments({ conversationKey, requestKey: 'recovery', attachmentKeys: [key] }, owner, context.dependencies);
    expect(replay.attachments[0]).toMatchObject({ attachmentKey: key, status: 'prepared' });
  });

  test('cleans staging and Redis metadata when validation fails', async () => {
    const context = harness();
    const invalid = new TextEncoder().encode('not a pdf');
    const reserved = await reserveTransientAttachments({ conversationKey, requestKey: 'request-3', files: [{ clientKey: 'document', filename: 'bad.pdf', mimeType: 'application/pdf', sizeBytes: invalid.byteLength }] }, owner, context.dependencies);
    const key = reserved.uploads[0]!.attachmentKey;
    const record = JSON.parse(context.values.get(`conversation-attachment:${key}`)!) as TransientAttachmentRecord;
    context.objects.set(record.storageKey, { bytes: invalid, mimeType: 'application/pdf' });
    await expect(completeTransientAttachments({ conversationKey, requestKey: 'request-3', attachmentKeys: [key] }, owner, context.dependencies)).rejects.toThrow();
    expect(context.values.has(`conversation-attachment:${key}`)).toBe(false);
    expect(context.objects.has(record.storageKey)).toBe(false);
  });
});
