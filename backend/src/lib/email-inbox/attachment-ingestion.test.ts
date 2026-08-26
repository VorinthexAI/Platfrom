import { describe, expect, test } from 'bun:test';
import { createEmailAttachmentIngestionService, createEmailAttachmentRepository, EmailAttachmentIngestionError, type EmailAttachmentRepository } from './attachment-ingestion';
import type { EmailAttachmentBinding } from './attachment-binding-schema';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { documentSchema, type Document } from '@/lib/db/documents.node';
import { DocumentInputError } from '@/lib/ai/document-processing';
import { GmailPermanentAttachmentError } from './gmail';
import sharp from 'sharp';
import { newId } from '@/lib/ids';
import { mailInboxFilesFolderKey } from './folders';

const organizationKey = 'organization';
const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const membershipKey = 'cmrnlzf650002qc7k4p5zemb0';
const connectorKey = 'cmrnlzf660003qc7kw1n9j93a';
const attachmentFolderKey = mailInboxFilesFolderKey(scopeKey, connectorKey);

function fixture() {
  const bindings = new Map<string, EmailAttachmentBinding>();
  const completed: Array<{ type: string; key: string; collectionKey?: string }> = [];
  const released: string[] = [];
  const claimedBy: string[] = [];
  const ensuredDocumentFolders: Array<{ scopeKey: string; connectorKey: string }> = [];
  const targets = new Map<string, Document>();
  const repository: EmailAttachmentRepository = {
    async activeMembership(input) { return input.preferredMembershipKey; },
    async completed(input) {
      const binding = bindings.get(input.key);
      if (!binding || binding.status !== 'completed') return null;
      if (binding.sourceSize !== input.sourceSize || binding.sourceFilename !== input.sourceFilename || binding.sourceMimeType !== input.sourceMimeType) throw new EmailAttachmentIngestionError('ATTACHMENT_CONFLICT', 'changed metadata', false);
      return binding;
    },
    async claim(input, membership, leaseToken, now, leaseExpiresAt) {
      claimedBy.push(membership);
      const existing = bindings.get(input.key);
      if (existing) {
        if (existing.contentHash !== input.contentHash || existing.sourceMimeType !== input.sourceMimeType || existing.sourceFilename !== input.sourceFilename || existing.sourceSize !== input.sourceSize) throw new EmailAttachmentIngestionError('ATTACHMENT_CONFLICT', 'changed bytes or metadata', false);
        if (existing.status === 'completed') return { status: 'replay', binding: existing };
      }
      const binding = { ...input, status: 'processing' as const, leaseToken, leaseExpiresAt, createdAt: existing?.createdAt ?? now, updatedAt: now };
      bindings.set(input.key, binding);
      return { status: 'claimed', binding };
    },
    async renew() { return true; },
    async ensureDocumentFolder(resolvedScopeKey, resolvedConnectorKey) { ensuredDocumentFolders.push({ scopeKey: resolvedScopeKey, connectorKey: resolvedConnectorKey }); return attachmentFolderKey; },
    async ensureImageCollection() { return 'cmrnlzf680005qc7ku7uxyc9d'; },
    async documentTarget(input) { return targets.get(input.targetKey) ?? null; },
    async recoverDocumentTarget(input) {
      const target = targets.get(input.targetKey) ?? null;
      if (!target) return null;
      const current = bindings.get(input.bindingKey)!;
      if (target.scopeKey !== input.scopeKey || target.folderKey !== input.folderKey || target.managedPurpose !== 'mail-attachment' || target.managedOwnerKey !== input.bindingKey) throw new EmailAttachmentIngestionError('ATTACHMENT_CONFLICT', 'unrelated target', false);
      bindings.set(input.bindingKey, { ...current, status: 'completed', leaseToken: undefined, leaseExpiresAt: undefined, updatedAt: input.now });
      return target;
    },
    async complete(bindingKey, _lease, type, key, collectionKey, _membership, now) {
      const current = bindings.get(bindingKey)!;
      bindings.set(bindingKey, { ...current, status: 'completed', leaseToken: undefined, leaseExpiresAt: undefined, updatedAt: now });
      completed.push({ type, key, ...(collectionKey ? { collectionKey } : {}) });
      return true;
    },
    async compensateTarget() {},
    async release(bindingKey) { released.push(bindingKey); bindings.delete(bindingKey); },
  };
  const parsed: unknown[] = [], processed: unknown[] = [], sanitized: Uint8Array[] = [];
  const service = createEmailAttachmentIngestionService({
    repository,
    parse: async (input) => { parsed.push(input); return { document: {} as never }; },
    sanitizeImage: async (bytes) => { sanitized.push(bytes); return { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), coordinates: undefined }; },
    processImage: async (input) => { processed.push(input); return { key: input.imageKey, embedding: Array(EMBEDDING_DIMENSIONS).fill(0) } as never; },
    publishScopeEvent: async () => undefined,
    publishCollectionEvent: async () => undefined,
    now: () => new Date('2026-08-25T12:00:00.000Z'),
  });
  return { service, repository, bindings, targets, completed, claimedBy, ensuredDocumentFolders, parsed, processed, sanitized, released };
}

const common = { organizationKey, scopeKey, membershipKey, connectorKey, providerMessageId: 'provider-message' };

describe('managed email attachment ingestion', () => {
  test('reuses canonical document and sanitized image pipelines and completes targets first', async () => {
    const f = fixture();
    const document = await f.service.ingest({ ...common, part: { path: '0.1', type: 'document', mimeType: 'text/plain', filename: 'notes.txt', size: 5, data: 'aGVsbG8' }, bytes: new TextEncoder().encode('hello') });
    const image = await f.service.ingest({ ...common, part: { path: '0.2', type: 'image', mimeType: 'image/png', filename: 'photo.png', size: 4, data: 'iVBORw' }, bytes: new Uint8Array([137, 80, 78, 71]) });
    expect(f.parsed).toHaveLength(1);
    expect(f.ensuredDocumentFolders).toEqual([{ scopeKey, connectorKey }]);
    expect(f.parsed[0]).toMatchObject({ scopeKey, folderKey: mailInboxFilesFolderKey(scopeKey, connectorKey) });
    expect(f.sanitized).toHaveLength(1);
    expect(f.processed).toHaveLength(1);
    expect(f.processed[0]).toMatchObject({ file: { filename: 'photo.png', mimeType: 'image/png' }, mutationPolicy: 'system-only', ownerKey: membershipKey });
    expect(f.completed.map(({ type }) => type)).toEqual(['document', 'image']);
    expect(document.type).toBe('document');
    expect(image.type).toBe('image');
  });

  test('replays completed sources, conflicts on changed bytes, and keeps same-name MIME parts distinct', async () => {
    const f = fixture();
    const part = { path: '0.1', type: 'document' as const, mimeType: 'text/plain', filename: 'same.txt', size: 3, data: 'b25l' };
    const first = await f.service.ingest({ ...common, part, bytes: new TextEncoder().encode('one') });
    expect(await f.service.ingest({ ...common, part, bytes: new TextEncoder().encode('one') })).toEqual(first);
    expect(f.parsed).toHaveLength(1);
    await expect(f.service.ingest({ ...common, part, bytes: new TextEncoder().encode('two') })).rejects.toMatchObject({ code: 'ATTACHMENT_CONFLICT', retryable: false });
    const second = await f.service.ingest({ ...common, part: { ...part, path: '0.2' }, bytes: new TextEncoder().encode('one') });
    expect(second.key).not.toBe(first.key);
  });

  test('stages only newly claimed targets and keeps their binding processing for the mail transaction', async () => {
    const f = fixture();
    const part = { path: '0.7', type: 'document' as const, mimeType: 'text/plain', filename: 'staged.txt', size: 6, attachmentId: 'staged' };
    const message = { id: common.providerMessageId, threadId: 'thread', payload: { mimeType: part.mimeType, filename: part.filename, body: { attachmentId: part.attachmentId, size: part.size } } };
    const staged = await f.service.stageMessage({ ...common, connectorLeaseToken: '11111111-1111-4111-8111-111111111111', heartbeat: async () => undefined, gmail: { attachment: async () => new TextEncoder().encode('staged') } as never, message });
    expect(staged.refs).toHaveLength(1);
    expect(staged.staged).toHaveLength(1);
    expect(staged.availability).toBe('complete');
    expect(f.bindings.get(staged.staged[0]!.bindingKey)?.status).toBe('processing');
    expect(f.completed).toHaveLength(0);
  });

  test('attempts compensation for every staged target and aggregates failures', async () => {
    const f = fixture();
    const attempted: string[] = [];
    f.repository.compensateTarget = async (bindingKey) => { attempted.push(bindingKey); throw new Error(bindingKey); };
    const staged = ['first', 'second'].map((bindingKey) => ({ bindingKey, leaseToken: bindingKey, targetType: 'document' as const, targetKey: bindingKey, membershipKey }));
    await expect(f.service.compensate(staged, scopeKey)).rejects.toBeInstanceOf(AggregateError);
    expect(attempted).toEqual(['second', 'first']);
    expect(f.released).toEqual([]);
  });

  test('does not remove the recovery binding when compensation fails', async () => {
    const f = fixture();
    f.repository.complete = async () => false;
    f.repository.compensateTarget = async () => { throw new Error('compensation transaction failed'); };
    await expect(f.service.ingest({ ...common, part: { path: '0.9', type: 'document', mimeType: 'text/plain', filename: 'recoverable.txt', size: 3, data: 'YWJj' }, bytes: new TextEncoder().encode('abc') })).rejects.toThrow('compensation transaction failed');
    expect(f.bindings.size).toBe(1);
    expect(f.released).toHaveLength(0);
  });

  test('does not complete a receipt when canonical processing fails', async () => {
    const f = fixture();
    const failed = createEmailAttachmentIngestionService({ repository: f.repository, parse: async () => { throw new Error('extract failed'); }, publishScopeEvent: async () => undefined, publishCollectionEvent: async () => undefined });
    await expect(failed.ingest({ ...common, part: { path: '0.8', type: 'document', mimeType: 'text/plain', filename: 'bad.txt', size: 3, data: 'YmFk' }, bytes: new TextEncoder().encode('bad') })).rejects.toThrow('extract failed');
    expect(f.completed).toHaveLength(0);
    expect(f.bindings.size).toBe(0);
  });

  test('does not redownload a completed Gmail MIME source', async () => {
    const f = fixture();
    const part = { path: '0', type: 'document' as const, mimeType: 'text/plain', filename: 'cached.txt', size: 6, attachmentId: 'provider-part' };
    const completed = await f.service.ingest({ ...common, part, bytes: new TextEncoder().encode('cached') });
    let downloads = 0;
    const refs = await f.service.ingestMessage({ ...common, gmail: { attachment: async () => { downloads += 1; return new TextEncoder().encode('cached'); } } as never, message: { id: common.providerMessageId, threadId: 'thread', payload: { mimeType: part.mimeType, filename: part.filename, body: { attachmentId: part.attachmentId, size: part.size } } } });
    expect(refs).toEqual([completed]);
    expect(downloads).toBe(0);
  });

  test('preserves MIME order across partial recovery without reprocessing completed parts', async () => {
    const f = fixture();
    const message = { id: common.providerMessageId, threadId: 'thread', payload: { mimeType: 'multipart/mixed', parts: [
      { mimeType: 'text/plain', filename: 'first.txt', body: { attachmentId: 'first', size: 5 } },
      { mimeType: 'text/plain', filename: 'later.txt', body: { attachmentId: 'later', size: 5 } },
    ] } };
    const downloads: string[] = [];
    let failLater = true;
    const gmail = { attachment: async (_messageId: string, part: { attachmentId?: string }) => {
      downloads.push(part.attachmentId!);
      if (part.attachmentId === 'later' && failLater) throw new Error('temporary provider failure');
      return new TextEncoder().encode(part.attachmentId!);
    } } as never;
    await expect(f.service.ingestMessage({ ...common, gmail, message })).rejects.toThrow('temporary provider failure');
    expect(f.parsed).toHaveLength(1);
    failLater = false;
    const refs = await f.service.ingestMessage({ ...common, gmail, message });
    expect(downloads).toEqual(['first', 'later', 'later']);
    expect(f.parsed).toHaveLength(2);
    expect(refs.map(({ key }) => key)).toEqual([...f.bindings.values()].map(({ targetKey }) => targetKey));
  });

  test('mixes permanent failures with successful document and image parts in MIME order', async () => {
    const f = fixture();
    const png = Uint8Array.from([137, 80, 78, 71]);
    const message = { id: common.providerMessageId, threadId: 'thread', payload: { mimeType: 'multipart/mixed', parts: [
      { mimeType: 'application/pdf', filename: 'permanent.pdf', body: { attachmentId: 'bad', size: 3 } },
      { mimeType: 'text/plain', filename: 'document.txt', body: { attachmentId: 'doc', size: 3 } },
      { mimeType: 'image/png', filename: 'image.png', body: { attachmentId: 'image', size: png.byteLength } },
    ] } };
    const refs = await f.service.ingestMessage({ ...common, message, gmail: { attachment: async (_id: string, part: { attachmentId?: string }) => {
      if (part.attachmentId === 'bad') throw new GmailPermanentAttachmentError('ATTACHMENT_MALFORMED_PAYLOAD', 'bad source');
      return part.attachmentId === 'doc' ? new TextEncoder().encode('doc') : png;
    } } as never });
    expect(refs.map(({ type }) => type)).toEqual(['document', 'image']);
    expect(f.parsed).toHaveLength(1);
    expect(f.processed).toHaveLength(1);
  });

  test('fails completed metadata conflicts before download', async () => {
    const f = fixture();
    const part = { path: '0', type: 'document' as const, mimeType: 'text/plain', filename: 'stable.txt', size: 6, attachmentId: 'part' };
    await f.service.ingest({ ...common, part, bytes: new TextEncoder().encode('stable') });
    let downloads = 0;
    await expect(f.service.ingestMessage({ ...common, gmail: { attachment: async () => { downloads += 1; return new Uint8Array(); } } as never, message: { id: common.providerMessageId, threadId: 'thread', payload: { ...part, filename: 'changed.txt', body: { attachmentId: part.attachmentId, size: part.size } } } })).rejects.toMatchObject({ code: 'ATTACHMENT_CONFLICT' });
    expect(downloads).toBe(0);
  });

  test('trusts Gmail message-part byte immutability when replaying a completed source without a hash redownload', async () => {
    // Gmail message parts are immutable for a provider message ID and MIME path. Metadata is
    // checked before replay; re-downloading only to recompute a completed hash is unnecessary.
    const f = fixture();
    const part = { path: '0', type: 'document' as const, mimeType: 'text/plain', filename: 'immutable.txt', size: 4, data: Buffer.from('same').toString('base64url') };
    const first = await f.service.ingest({ ...common, part, bytes: new TextEncoder().encode('same') });
    const refs = await f.service.ingestMessage({ ...common, gmail: { attachment: async () => { throw new Error('completed part must not be fetched'); } } as never, message: { id: common.providerMessageId, threadId: 'thread', payload: { mimeType: part.mimeType, filename: part.filename, body: { size: part.size, data: Buffer.from('evil').toString('base64url') } } } });
    expect(refs).toEqual([first]);
  });

  test('skips only typed permanent attachment rejections and continues the message', async () => {
    const f = fixture();
    const message = { id: common.providerMessageId, threadId: 'thread', payload: { mimeType: 'multipart/mixed', parts: [
      { mimeType: 'application/pdf', filename: 'bad.pdf', body: { attachmentId: 'bad', size: 3 } },
      { mimeType: 'text/plain', filename: 'good.txt', body: { attachmentId: 'good', size: 4 } },
    ] } };
    const refs = await f.service.ingestMessage({ ...common, gmail: { attachment: async (_messageId: string, part: { attachmentId?: string }) => {
      if (part.attachmentId === 'bad') throw new GmailPermanentAttachmentError('ATTACHMENT_INVALID_BASE64URL', 'invalid payload');
      return new TextEncoder().encode('good');
    } } as never, message });
    expect(refs).toHaveLength(1);
    expect(f.parsed).toHaveLength(1);
  });

  test('classifies canonical payload validation as permanent but propagates canonical execution failures', async () => {
    const f = fixture();
    const message = { id: common.providerMessageId, threadId: 'thread', payload: { mimeType: 'text/plain', filename: 'bad.txt', body: { attachmentId: 'bad', size: 3 } } };
    const invalid = createEmailAttachmentIngestionService({ repository: f.repository, parse: async () => { throw new DocumentInputError('DOCUMENT_UPLOAD_INVALID', 'invalid', 'document-validate'); }, publishScopeEvent: async () => undefined, publishCollectionEvent: async () => undefined });
    await expect(invalid.ingestMessage({ ...common, gmail: { attachment: async () => new TextEncoder().encode('bad') } as never, message })).resolves.toEqual([]);

    const failed = createEmailAttachmentIngestionService({ repository: f.repository, parse: async () => { throw new Error('storage unavailable'); }, publishScopeEvent: async () => undefined, publishCollectionEvent: async () => undefined });
    await expect(failed.ingestMessage({ ...common, gmail: { attachment: async () => new TextEncoder().encode('bad') } as never, message })).rejects.toThrow('storage unavailable');
  });

  test('skips a structurally valid PNG with corrupt image data but propagates unknown sanitizer failures', async () => {
    const f = fixture();
    const bytes = new Uint8Array(await sharp({ create: { width: 3, height: 2, channels: 3, background: '#336699' } }).png().toBuffer());
    const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const imageDataTypeOffset = view.indexOf(Buffer.from('IDAT'));
    const imageDataLength = view.readUInt32BE(imageDataTypeOffset - 4);
    const compressedChecksumOffset = imageDataTypeOffset + 4 + imageDataLength - 1;
    bytes[compressedChecksumOffset] = bytes[compressedChecksumOffset]! ^ 0xff;
    const message = { id: common.providerMessageId, threadId: 'thread', payload: { mimeType: 'image/png', filename: 'bad.png', body: { attachmentId: 'bad', size: bytes.byteLength } } };
    const invalid = createEmailAttachmentIngestionService({ repository: f.repository, publishScopeEvent: async () => undefined, publishCollectionEvent: async () => undefined });
    await expect(invalid.ingestMessage({ ...common, gmail: { attachment: async () => bytes } as never, message })).resolves.toEqual([]);

    const failure = new Error('libvips runtime unavailable');
    const transient = createEmailAttachmentIngestionService({ repository: f.repository, sanitizeImage: async () => { throw failure; }, publishScopeEvent: async () => undefined, publishCollectionEvent: async () => undefined });
    await expect(transient.ingestMessage({ ...common, gmail: { attachment: async () => bytes } as never, message })).rejects.toBe(failure);
  });

  test('propagates transient provider attachment download failures', async () => {
    const f = fixture();
    const failure = new Error('provider unavailable');
    const message = { id: common.providerMessageId, threadId: 'thread', payload: { mimeType: 'text/plain', filename: 'retry.txt', body: { attachmentId: 'retry', size: 5 } } };
    await expect(f.service.ingestMessage({ ...common, gmail: { attachment: async () => { throw failure; } } as never, message })).rejects.toBe(failure);
  });

  test('permanently rejects real malformed TXT and DOCX bytes but retries injected extraction failures', async () => {
    const f = fixture();
    const deleted: string[] = [];
    const dependencies = {
      storage: { upload: async ({ key }: { key: string }) => ({ storageKey: key }), delete: async (key: string) => { deleted.push(key); } },
      getFolder: async (key: string) => ({ key, scopeKey } as never),
      logger: () => undefined,
    };
    const malformed = createEmailAttachmentIngestionService({ repository: f.repository, documentDependencies: dependencies, publishScopeEvent: async () => undefined, publishCollectionEvent: async () => undefined });
    const cases = [
      { mimeType: 'text/plain', filename: 'invalid.txt', bytes: Uint8Array.from([0xc3, 0x28]) },
      { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: 'invalid.docx', bytes: Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1]) },
    ];
    for (const [index, item] of cases.entries()) {
      const message = { id: `malformed-${index}`, threadId: 'thread', payload: { mimeType: item.mimeType, filename: item.filename, body: { attachmentId: `part-${index}`, size: item.bytes.byteLength } } };
      await expect(malformed.ingestMessage({ organizationKey, scopeKey, membershipKey, connectorKey, gmail: { attachment: async () => item.bytes } as never, message })).resolves.toEqual([]);
    }
    expect(deleted).toHaveLength(1);

    const failure = new Error('extraction provider unavailable');
    const transient = createEmailAttachmentIngestionService({ repository: f.repository, documentDependencies: { ...dependencies, actions: { extract: async () => { throw failure; } } }, publishScopeEvent: async () => undefined, publishCollectionEvent: async () => undefined });
    const bytes = new TextEncoder().encode('valid text');
    const message = { id: 'transient-extraction', threadId: 'thread', payload: { mimeType: 'text/plain', filename: 'retry.txt', body: { attachmentId: 'retry', size: bytes.byteLength } } };
    await expect(transient.ingestMessage({ organizationKey, scopeKey, membershipKey, connectorKey, gmail: { attachment: async () => bytes } as never, message })).rejects.toBe(failure);
  });

  test('uses a currently active membership instead of a stale connector creator', async () => {
    const f = fixture();
    const activeMembershipKey = 'cmrnlzf690006qc7kb8w2w8vf';
    f.repository.activeMembership = async () => activeMembershipKey;
    const part = { path: '0', type: 'document' as const, mimeType: 'text/plain', filename: 'active.txt', size: 6, attachmentId: 'provider-part' };
    await f.service.ingestMessage({ ...common, gmail: { attachment: async () => new TextEncoder().encode('active') } as never, message: { id: common.providerMessageId, threadId: 'thread', payload: { mimeType: part.mimeType, filename: part.filename, body: { attachmentId: part.attachmentId, size: part.size } } } });
    expect(f.claimedBy).toEqual([activeMembershipKey]);
  });

  test('runs real canonical document and Gallery processing with controlled external dependencies', async () => {
    const f = fixture();
    const documents: Document[] = [];
    const uploads: Array<{ key: string; mimeType: string; bytes: Uint8Array }> = [];
    const canonical = createEmailAttachmentIngestionService({
      repository: f.repository,
      documentDependencies: {
        storage: { upload: async (input) => { uploads.push(input); return { storageKey: input.key }; }, delete: async () => undefined },
        getFolder: async (key) => ({ key, scopeKey } as never),
        insert: async (document) => { documents.push(document); f.targets.set(document.key, document); return document; },
        embedBatch: async ({ texts }) => texts.map(() => Array(EMBEDDING_DIMENSIONS).fill(0.25)),
        logger: () => undefined,
      },
      imageDependencies: {
        storage: { upload: async (input) => { uploads.push(input); return { storageKey: input.key }; }, delete: async () => undefined },
        getImage: async () => null,
        hashBatch: async () => ['0123456789abcdef'],
        findCaption: async () => null,
        caption: async () => ({ caption: 'Controlled caption', score: 90 }),
        embed: async () => Array(EMBEDDING_DIMENSIONS).fill(0.5),
        persistImage: async ({ image }) => image,
      },
      publishScopeEvent: async () => undefined,
      publishCollectionEvent: async () => undefined,
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    });
    const text = new TextEncoder().encode('Canonical extraction text');
    const document = await canonical.ingest({ ...common, part: { path: '5.0', type: 'document', mimeType: 'text/plain', filename: 'canonical.txt', size: text.byteLength, data: Buffer.from(text).toString('base64url') }, bytes: text });
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({ key: document.key, scopeKey, folderKey: attachmentFolderKey, content: 'Canonical extraction text', mutationPolicy: 'user', managedPurpose: 'mail-attachment' });
    expect(documents[0]!.managedOwnerKey).toBe([...f.bindings.values()].find(({ targetKey }) => targetKey === document.key)!.key);

    const source = new Uint8Array(await sharp({ create: { width: 2, height: 3, channels: 3, background: '#123456' } }).png().toBuffer());
    const images: any[] = [];
    const imageService = createEmailAttachmentIngestionService({
      repository: f.repository,
      imageDependencies: { storage: { upload: async (input) => { uploads.push(input); return { storageKey: input.key }; }, delete: async () => undefined }, getImage: async () => null, hashBatch: async () => ['0123456789abcdef'], findCaption: async () => null, caption: async () => ({ caption: 'Controlled caption', score: 90 }), embed: async () => Array(EMBEDDING_DIMENSIONS).fill(0.5), persistImage: async ({ image }) => { images.push(image); return image; } },
      publishScopeEvent: async () => undefined, publishCollectionEvent: async () => undefined,
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    });
    const image = await imageService.ingest({ ...common, part: { path: '5.1', type: 'image', mimeType: 'image/png', filename: 'source.png', size: source.byteLength, data: Buffer.from(source).toString('base64url') }, bytes: source });
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ key: image.key, scopeKey, createdByKey: membershipKey, filename: 'source.png', mimeType: 'image/png', mutationPolicy: 'system-only', width: 2, height: 3, storageKey: expect.stringMatching(/\/original\.png$/) });
    expect(Buffer.from(uploads.at(-1)!.bytes).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(uploads.at(-1)).toMatchObject({ mimeType: 'image/png', key: expect.stringMatching(/\/original\.png$/) });
  });

  test('publishes image, affected collection content, and collection index once, but not on replay', async () => {
    const f = fixture();
    const events: string[] = [];
    const service = createEmailAttachmentIngestionService({ repository: f.repository, sanitizeImage: async () => ({ bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), coordinates: undefined }), processImage: async (input) => ({ key: input.imageKey } as never), publishScopeEvent: async (key, event) => { events.push(`scope:${key}:${event}`); }, publishCollectionEvent: async (key, event) => { events.push(`collection:${key}:${event}`); }, now: () => new Date('2026-08-25T12:00:00.000Z') });
    const input = { ...common, part: { path: '6', type: 'image' as const, mimeType: 'image/jpeg', filename: 'event.jpg', size: 4, data: '_9j_2Q' }, bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]) };
    await service.ingest(input);
    await service.ingest(input);
    expect(events).toEqual([
      `scope:${scopeKey}:image.changed`,
      'collection:cmrnlzf680005qc7ku7uxyc9d:collection.content.changed',
      'collection:cmrnlzf680005qc7ku7uxyc9d:collection.index.changed',
    ]);
  });

  test('recovers an aligned managed document target after an expired processing receipt', async () => {
    const f = fixture();
    const part = { path: '0.4', type: 'document' as const, mimeType: 'text/plain', filename: 'recover.txt', size: 7, data: 'cmVjb3Zlcg' };
    const first = await f.service.ingest({ ...common, part, bytes: new TextEncoder().encode('recover') });
    const [bindingKey, completedBinding] = [...f.bindings.entries()][0]!;
    f.bindings.set(bindingKey, { ...completedBinding, status: 'processing', leaseToken: '11111111-1111-4111-8111-111111111111', leaseExpiresAt: '2026-08-25T11:00:00.000Z' });
    f.targets.set(first.key, documentSchema.parse({ key: first.key, scopeKey, folderKey: attachmentFolderKey, name: part.filename, content: 'recover', extension: 'txt', mimeType: part.mimeType, sizeBytes: part.size, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), isFavorite: false, mutationPolicy: 'user', managedPurpose: 'mail-attachment', managedOwnerKey: bindingKey, createdAt: '2026-08-25T11:00:00.000Z', updatedAt: '2026-08-25T11:00:00.000Z' }));
    const parseCount = f.parsed.length;
    await expect(f.service.ingest({ ...common, part, bytes: new TextEncoder().encode('recover') })).resolves.toEqual(first);
    expect(f.parsed).toHaveLength(parseCount);
    expect(f.bindings.get(bindingKey)?.status).toBe('completed');
  });

  test('rejects changed metadata during expired receipt takeover even when bytes match', async () => {
    const f = fixture();
    const part = { path: '0.5', type: 'document' as const, mimeType: 'text/plain', filename: 'original.txt', size: 4, data: 'c2FtZQ' };
    await f.service.ingest({ ...common, part, bytes: new TextEncoder().encode('same') });
    const [bindingKey, completedBinding] = [...f.bindings.entries()][0]!;
    f.bindings.set(bindingKey, { ...completedBinding, status: 'processing', leaseToken: '11111111-1111-4111-8111-111111111111', leaseExpiresAt: '2026-08-25T11:00:00.000Z' });
    await expect(f.service.ingest({ ...common, part: { ...part, filename: 'changed.txt' }, bytes: new TextEncoder().encode('same') })).rejects.toMatchObject({ code: 'ATTACHMENT_CONFLICT', retryable: false });
  });

  test('repository rejects expired takeover with changed metadata before lease replacement', async () => {
    const bindingKey = 'cmrnlzf6a0007qc7k72v2gr8d';
    const targetKey = 'cmrnlzf6b0008qc7kfq0y1d6j';
    const existing = { _key: bindingKey, organizationKey, scopeKey, connectorKey, providerMessageId: common.providerMessageId, partPath: '0.6', contentHash: 'a'.repeat(64), sourceMimeType: 'text/plain', sourceFilename: 'original.txt', sourceSize: 4, targetType: 'document', targetKey, status: 'processing', leaseToken: '11111111-1111-4111-8111-111111111111', leaseExpiresAt: '2026-08-25T11:00:00.000Z', createdAt: '2026-08-25T10:00:00.000Z', updatedAt: '2026-08-25T10:00:00.000Z' };
    const queries: string[] = [];
    const repository = createEmailAttachmentRepository({ query: async (query: string) => { queries.push(query); return { next: async () => query.includes('LET existing = DOCUMENT') ? existing : undefined }; } } as never);
    await expect(repository.claim({ key: bindingKey, organizationKey, scopeKey, connectorKey, providerMessageId: common.providerMessageId, partPath: '0.6', contentHash: existing.contentHash, sourceMimeType: existing.sourceMimeType, sourceFilename: 'changed.txt', sourceSize: existing.sourceSize, targetType: 'document', targetKey }, membershipKey, '22222222-2222-4222-8222-222222222222', '2026-08-25T12:00:00.000Z', '2026-08-25T12:30:00.000Z')).rejects.toMatchObject({ code: 'ATTACHMENT_CONFLICT', retryable: false });
    expect(queries.some((query) => query.startsWith('UPSERT'))).toBe(false);
  });

  test('emits escaped AQL separators and clears folder covers before compensating an image target', async () => {
    const queries: string[] = [];
    const repository = createEmailAttachmentRepository({ query: async (query: string) => { queries.push(query); return { next: async () => query.includes('RETURN { storageKey: target.storageKey') ? { storageKey: 'attachment.jpg', captionKey: newId() } : undefined }; } } as never);
    await repository.compensateTarget('cmrnlzf6a0007qc7k72v2gr8d', '11111111-1111-4111-8111-111111111111', 'image', 'cmrnlzf6b0008qc7kfq0y1d6j', scopeKey, '2026-08-25T12:00:00.000Z');
    expect(queries.length).toBeGreaterThanOrEqual(5);
    expect(queries.some((query) => query.includes('FOR folder IN folders'))).toBe(true);
    expect(queries.some((query) => query.includes('REMOVE target IN images'))).toBe(true);
    for (const query of queries.filter((query) => query.includes('targetKey'))) {
      expect(query).not.toContain('\0');
      expect(query).toContain('CONCAT_SEPARATOR("\\u0000", "email-attachment-target"');
    }
  });

  test('keeps every attachment target AQL separator escaped in TypeScript source', async () => {
    const sources = await Promise.all([
      Bun.file(new URL('./attachment-ingestion.ts', import.meta.url)).text(),
      Bun.file(new URL('./repository.ts', import.meta.url)).text(),
      Bun.file(new URL('../ai/scopes/repository.ts', import.meta.url)).text(),
    ]);
    const separators = sources.flatMap((source) => {
      expect(source).not.toContain('\0');
      return [...source.matchAll(/CONCAT_SEPARATOR\("([^"]+)", "email-attachment-target"/g)].map((match) => match[1]);
    });
    expect(separators.length).toBeGreaterThanOrEqual(8);
    expect(separators.every((separator) => separator === '\\\\u0000')).toBe(true);
  });
});
