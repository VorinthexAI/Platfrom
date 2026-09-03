import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { newId } from '@/lib/ids';
import {
  claimTransientAttachment,
  completeTransientAttachments,
  releaseTransientAttachment,
  reserveTransientAttachments,
  transientAttachmentReserveInputSchema,
  type TransientAttachmentDependencies,
  type TransientAttachmentOwner,
  type TransientAttachmentRecord,
} from './transient-attachments';

const organizationKey = 'organization';
const scopeKey = newId();
const userKey = newId();
const conversationKey = newId();
const owner: TransientAttachmentOwner = { organizationKey, scopeKey, userKey };
const now = new Date('2026-09-02T12:00:00.000Z');

function harness() {
  const values = new Map<string, string>();
  const objects = new Map<string, { bytes: Uint8Array; mimeType: string }>();
  const deleted: string[] = [];
  const redis = {
    async get(key: string) { return values.get(key) ?? null; },
    async set(key: string, value: string, ...args: unknown[]) { if (args.includes('NX') && values.has(key)) return null; values.set(key, value); return 'OK'; },
    async del(...keys: string[]) { keys.forEach((key) => values.delete(key)); return keys.length; },
    async eval() { throw new Error('Use the injected transition.'); },
  };
  const dependencies: TransientAttachmentDependencies = {
    redis: redis as never,
    repository: { read: async (selected, key) => selected.organizationKey === organizationKey && selected.scopeKey === scopeKey && selected.userKey === userKey && key === conversationKey ? {} as never : null },
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
  };
  return { values, objects, deleted, dependencies };
}

describe('transient conversation attachments', () => {
  test('strictly accepts only supported extension and MIME pairs', () => {
    expect(() => transientAttachmentReserveInputSchema.parse({ conversationKey, requestKey: 'request-1', files: [{ clientKey: 'a', filename: 'photo.gif', mimeType: 'image/gif', sizeBytes: 10 }] })).toThrow();
    expect(() => transientAttachmentReserveInputSchema.parse({ conversationKey, requestKey: 'request-1', files: [{ clientKey: 'a', filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 10, extra: true }] })).toThrow('Unrecognized key');
    expect(transientAttachmentReserveInputSchema.parse({ conversationKey, requestKey: 'request-1', files: [{ clientKey: 'a', filename: 'notes.md', mimeType: 'text/plain', sizeBytes: 10 }] }).files[0]!.filename).toBe('notes.md');
  });

  test('binds reservations to the owner, conversation, and request and seals sanitized images plus extracted documents', async () => {
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
      expect(record).toMatchObject({ organizationKey, scopeKey, userKey, conversationKey, requestKey: 'request-1', status: 'reserved' });
      context.objects.set(record.storageKey, index === 0 ? { bytes: png, mimeType: 'image/png' } : { bytes: text, mimeType: 'text/plain' });
    }
    const completed = await completeTransientAttachments({ conversationKey, requestKey: 'request-1', attachmentKeys: reserved.uploads.map(({ attachmentKey }) => attachmentKey) }, owner, context.dependencies);
    expect(completed.attachments).toEqual([
      expect.objectContaining({ kind: 'image', mimeType: 'image/png', width: 2, height: 3, status: 'sealed' }),
      expect.objectContaining({ kind: 'document', extractedCharacters: 15, status: 'sealed' }),
    ]);
    expect(JSON.stringify(completed)).not.toContain('storageKey');
    expect(JSON.stringify(completed)).not.toContain('First');
    const document = JSON.parse(context.values.get(`conversation-attachment:${reserved.uploads[1]!.attachmentKey}`)!) as TransientAttachmentRecord;
    expect(document.result).toMatchObject({ kind: 'document', content: 'First\r\n\r\nSecond' });
    expect(context.deleted.filter((key) => key.includes('/original.'))).toHaveLength(2);
  });

  test('rejects cross-owner completion and permits exactly one atomic claim', async () => {
    const context = harness();
    const text = new TextEncoder().encode('Claim me');
    const reserved = await reserveTransientAttachments({ conversationKey, requestKey: 'request-2', files: [{ clientKey: 'document', filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: text.byteLength }] }, owner, context.dependencies);
    const key = reserved.uploads[0]!.attachmentKey;
    const record = JSON.parse(context.values.get(`conversation-attachment:${key}`)!) as TransientAttachmentRecord;
    context.objects.set(record.storageKey, { bytes: text, mimeType: 'text/plain' });
    await expect(completeTransientAttachments({ conversationKey, requestKey: 'request-2', attachmentKeys: [key] }, { ...owner, userKey: newId() }, context.dependencies)).rejects.toMatchObject({ code: 'ATTACHMENT_CONVERSATION_NOT_FOUND' });
    await completeTransientAttachments({ conversationKey, requestKey: 'request-2', attachmentKeys: [key] }, owner, context.dependencies);
    const claims = await Promise.allSettled([0, 1].map(() => claimTransientAttachment({ conversationKey, requestKey: 'request-2', attachmentKey: key }, owner, context.dependencies)));
    expect(claims.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(claims.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const claimed = (claims.find(({ status }) => status === 'fulfilled') as PromiseFulfilledResult<TransientAttachmentRecord>).value;
    await releaseTransientAttachment(claimed, context.dependencies);
    expect(context.values.has(`conversation-attachment:${key}`)).toBe(false);
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
