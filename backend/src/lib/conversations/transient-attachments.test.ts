import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { newId } from '@/lib/ids';
import {
  completeTransientAttachments,
  reserveTransientAttachments,
  transientAttachmentReserveInputSchema,
  TRANSIENT_ATTACHMENT_MAX_AGGREGATE_RAW_BYTES,
  validateCoreAttachmentImageBytes,
  type TransientAttachmentDependencies,
  type TransientAttachmentOwner,
  type TransientAttachmentRecord,
} from './transient-attachments';
import { CORE_CHAT_MAX_IMAGE_BYTES } from '@/lib/ai/actions/core-chat';

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
  test('enforces the aggregate 50 MiB image limit', () => {
    const image = (sizeBytes: number) => ({ kind: 'image' as const, filename: 'a.png', mimeType: 'image/png' as const, sizeBytes, width: 1, height: 1, storageKey: 'pending/a' });
    expect(() => validateCoreAttachmentImageBytes([image(20 * 1024 * 1024), image(20 * 1024 * 1024), image(10 * 1024 * 1024)])).not.toThrow();
    expect(() => validateCoreAttachmentImageBytes([image(20 * 1024 * 1024), image(20 * 1024 * 1024), image(10 * 1024 * 1024 + 1)])).toThrow('50 MiB');
  });
  test('strictly accepts only supported extension and MIME pairs', () => {
    expect(() => transientAttachmentReserveInputSchema.parse({ conversationKey, requestKey: 'request-1', files: [{ clientKey: 'a', filename: 'photo.gif', mimeType: 'image/gif', sizeBytes: 10 }] })).toThrow();
    expect(() => transientAttachmentReserveInputSchema.parse({ conversationKey, requestKey: 'request-1', files: [{ clientKey: 'a', filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 10, extra: true }] })).toThrow('Unrecognized key');
    expect(transientAttachmentReserveInputSchema.parse({ conversationKey, requestKey: 'request-1', files: [{ clientKey: 'a', filename: 'notes.md', mimeType: 'text/plain', sizeBytes: 10 }] }).files[0]!.filename).toBe('notes.md');
  });

  test('rejects the aggregate raw attachment bound', () => {
    expect(() => transientAttachmentReserveInputSchema.parse({ conversationKey, requestKey: 'raw-limit', files: [
      { clientKey: 'a', filename: 'a.txt', mimeType: 'text/plain', sizeBytes: TRANSIENT_ATTACHMENT_MAX_AGGREGATE_RAW_BYTES / 2 + 1 },
      { clientKey: 'b', filename: 'b.txt', mimeType: 'text/plain', sizeBytes: TRANSIENT_ATTACHMENT_MAX_AGGREGATE_RAW_BYTES / 2 },
    ] })).toThrow('Attachment bytes');
  });

  test('binds reservations and prepares original image and document bytes', async () => {
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
      expect(record).toMatchObject({ teamKey, scopeKey, userKey, conversationKey, requestKey: 'request-1', displayKey: index === 0 ? 'image' : 'document', displayOrder: index, status: 'reserved' });
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
    expect(document.documentContent).toBeUndefined();
    expect(document.stagedSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(context.deleted).toHaveLength(0);
    const image = context.artifacts.get(reserved.uploads[0]!.attachmentKey);
    expect(image).toMatchObject({ displayKey: 'image', displayOrder: 0, filename: 'photo.png', mimeType: 'image/png', stagedStorageKey: expect.stringContaining('/original.png') });
    expect(image.stagedSha256).toBe(createHash('sha256').update(png).digest('hex'));
    expect([...context.objects.keys()]).toContain(document.stagedStorageKey);
  });

  test('prepares twelve uploads with bounded concurrency four', async () => {
    const context = harness(); const text = new TextEncoder().encode('bounded'); let active = 0; let maximum = 0;
    const files = Array.from({ length: 12 }, (_, index) => ({ clientKey: `document-${index}`, filename: `notes-${index}.txt`, mimeType: 'text/plain' as const, sizeBytes: text.byteLength }));
    const reserved = await reserveTransientAttachments({ conversationKey, requestKey: 'bounded', files }, owner, context.dependencies);
    for (const upload of reserved.uploads) { const record = JSON.parse(context.values.get(`conversation-attachment:${upload.attachmentKey}`)!) as TransientAttachmentRecord; context.objects.set(record.storageKey, { bytes: text, mimeType: 'text/plain' }); }
    const storage = context.dependencies.storage!;
    const completed = await completeTransientAttachments({ conversationKey, requestKey: 'bounded', attachmentKeys: reserved.uploads.map(({ attachmentKey }) => attachmentKey) }, owner, { ...context.dependencies, storage: { ...storage, download: async (key) => { active += 1; maximum = Math.max(maximum, active); try { await new Promise((resolve) => setTimeout(resolve, 3)); return await storage.download(key); } finally { active -= 1; } } } });
    expect(maximum).toBe(4);
    expect(completed.attachments).toHaveLength(12);
  });

  test('prepares TXT, Markdown, DOC, DOCX, and PDF without extracting them', async () => {
    const context = harness();
    const formats = [
      ['txt', 'text/plain'],
      ['md', 'text/markdown'],
      ['doc', 'application/msword'],
      ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['pdf', 'application/pdf'],
    ] as const;
    const files = formats.map(([extension, mimeType], index) => ({ clientKey: extension, filename: `${index + 1}.${extension}`, mimeType, sizeBytes: 1 }));
    const reserved = await reserveTransientAttachments({ conversationKey, requestKey: 'mixed-documents', files }, owner, context.dependencies);
    for (const upload of reserved.uploads) {
      const record = JSON.parse(context.values.get(`conversation-attachment:${upload.attachmentKey}`)!) as TransientAttachmentRecord;
      context.objects.set(record.storageKey, { bytes: new Uint8Array([1]), mimeType: record.mimeType });
    }
    await completeTransientAttachments({ conversationKey, requestKey: 'mixed-documents', attachmentKeys: reserved.uploads.map(({ attachmentKey }) => attachmentKey) }, owner, context.dependencies);
    const artifacts = reserved.uploads.map(({ attachmentKey }) => context.artifacts.get(attachmentKey));
    expect(artifacts.map(({ filename, mimeType, sizeBytes }) => ({ filename, mimeType, sizeBytes }))).toEqual(formats.map(([extension, mimeType], index) => ({ filename: `${index + 1}.${extension}`, mimeType, sizeBytes: 1 })));
    expect(artifacts.every((artifact) => !('documentContent' in artifact))).toBe(true);
  });

  test('rejects images above the 20 MiB provider limit at reservation', () => {
    expect(() => transientAttachmentReserveInputSchema.parse({ conversationKey, requestKey: 'large-image', files: [{ clientKey: 'image', filename: 'photo.png', mimeType: 'image/png', sizeBytes: CORE_CHAT_MAX_IMAGE_BYTES + 1 }] })).toThrow('maximum allowed size');
  });

  test('passes JPEG bytes through without creating a converted object', async () => {
    const context = harness();
    const jpeg = new Uint8Array(await sharp({ create: { width: 7, height: 5, channels: 3, background: '#336699' } }).jpeg().toBuffer());
    const reserved = await reserveTransientAttachments({ conversationKey, requestKey: 'jpeg', files: [{ clientKey: 'image', filename: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: jpeg.byteLength }] }, owner, context.dependencies);
    const key = reserved.uploads[0]!.attachmentKey;
    const record = JSON.parse(context.values.get(`conversation-attachment:${key}`)!) as TransientAttachmentRecord;
    context.objects.set(record.storageKey, { bytes: jpeg, mimeType: 'image/jpeg' });
    const completed = await completeTransientAttachments({ conversationKey, requestKey: 'jpeg', attachmentKeys: [key] }, owner, context.dependencies);
    expect(completed.attachments[0]).toMatchObject({ kind: 'image', filename: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: jpeg.byteLength, width: 7, height: 5, status: 'prepared' });
    expect(context.objects.size).toBe(1);
    expect(context.deleted).toHaveLength(0);
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

  test('accepts opaque PDF bytes for native model input and asynchronous parsing', async () => {
    const context = harness();
    const invalid = new TextEncoder().encode('not a pdf');
    const reserved = await reserveTransientAttachments({ conversationKey, requestKey: 'request-3', files: [{ clientKey: 'document', filename: 'bad.pdf', mimeType: 'application/pdf', sizeBytes: invalid.byteLength }] }, owner, context.dependencies);
    const key = reserved.uploads[0]!.attachmentKey;
    const record = JSON.parse(context.values.get(`conversation-attachment:${key}`)!) as TransientAttachmentRecord;
    context.objects.set(record.storageKey, { bytes: invalid, mimeType: 'application/pdf' });
    await expect(completeTransientAttachments({ conversationKey, requestKey: 'request-3', attachmentKeys: [key] }, owner, context.dependencies)).resolves.toMatchObject({ attachments: [expect.objectContaining({ kind: 'document', mimeType: 'application/pdf' })] });
    expect(context.values.has(`conversation-attachment:${key}`)).toBe(false);
    expect(context.objects.has(record.storageKey)).toBe(true);
  });

  test('keeps arbitrary document bytes opaque during mixed batch preparation', async () => {
    const context = harness();
    const good = new TextEncoder().encode('Good document');
    const bad = new Uint8Array([0xff, 0xfe]);
    const reserved = await reserveTransientAttachments({ conversationKey, requestKey: 'one-bad', files: [
      { clientKey: 'good', filename: 'good.txt', mimeType: 'text/plain', sizeBytes: good.byteLength },
      { clientKey: 'bad', filename: 'bad.md', mimeType: 'text/markdown', sizeBytes: bad.byteLength },
    ] }, owner, context.dependencies);
    for (const [index, upload] of reserved.uploads.entries()) {
      const record = JSON.parse(context.values.get(`conversation-attachment:${upload.attachmentKey}`)!) as TransientAttachmentRecord;
      context.objects.set(record.storageKey, { bytes: index === 0 ? good : bad, mimeType: record.mimeType });
    }
    await expect(completeTransientAttachments({ conversationKey, requestKey: 'one-bad', attachmentKeys: reserved.uploads.map(({ attachmentKey }) => attachmentKey) }, owner, context.dependencies)).resolves.toMatchObject({ attachments: [expect.objectContaining({ filename: 'good.txt' }), expect.objectContaining({ filename: 'bad.md' })] });
    expect(context.artifacts.size).toBe(2);
    expect(context.values.size).toBe(0);
    expect(context.objects.size).toBe(2);
  });
});
