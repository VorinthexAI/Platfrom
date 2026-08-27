import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { emailAttachmentSchema } from '@/lib/db/email-attachments.node';
import { emailDraftRecordSchema, emailMessageRecordSchema, emailReplyContextRecordSchema, emailThreadRecordSchema, emailToneRecordSchema } from '@/lib/db/email-records.node';
import { exportEmailThreadToArchive } from './exports';

const key = 'cmrnlzf640001qc7kazsr96k5';
const otherKey = 'cmrnlzf650002qc7k4p5zem5w';
const now = '2026-08-27T12:00:00.000Z';
const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);
const base = { key, scopeKey: otherKey, embedding, createdAt: now, updatedAt: now };

describe('canonical email persistence schemas', () => {
  test('strictly validates every dedicated aggregate without Archive fields', () => {
    const thread = { ...base, accountKey: key, providerThreadId: 'thread', subject: 'Subject', summary: 'Summary', intent: 'Reply', priority: 'normal', state: 'needs_action', lastMessageAt: now };
    const message = { ...base, accountKey: key, threadKey: key, providerMessageId: 'message', from: 'a@example.com', to: ['b@example.com'], subject: 'Subject', body: 'Body', summary: 'Summary', direction: 'inbound', sentAt: now, hasAttachments: false };
    const draft = { ...base, variant: 'new', accountKey: key, to: ['b@example.com'], subject: 'Subject', generatedContent: 'Body', status: 'generated' };
    expect(emailThreadRecordSchema.parse(thread)).toMatchObject({ unread: false, inboxCategory: 'Important' });
    expect(emailMessageRecordSchema.parse(message)).toMatchObject({ unread: false, replyDepth: 0, attachmentAvailability: 'none' });
    expect(emailDraftRecordSchema.parse(draft)).toMatchObject({ creationSource: 'manual' });
    expect(emailToneRecordSchema.parse({ ...base, name: 'Direct', instruction: 'Be direct.' })).toMatchObject({ isFavorite: false });
    expect(emailReplyContextRecordSchema.parse({ ...base, name: 'Hours', text: 'No Fridays.' })).toBeTruthy();
    for (const schema of [emailThreadRecordSchema, emailMessageRecordSchema, emailDraftRecordSchema, emailToneRecordSchema, emailReplyContextRecordSchema]) expect(() => schema.parse({ ...base, extra: true })).toThrow();
    expect(() => emailThreadRecordSchema.parse({ ...thread, content: '{}' })).toThrow();
  });

  test('keeps attachment storage canonical and export identities one-way', () => {
    const completed = { key, organizationKey: 'organization', scopeKey: otherKey, connectorKey: key, providerMessageId: 'message', partPath: '1.2', contentHash: 'a'.repeat(64), kind: 'image', filename: 'photo.png', mimeType: 'image/png', sizeBytes: 4, storageKey: `email/${otherKey}/${key}`, status: 'completed', galleryImageKey: otherKey, createdAt: now, updatedAt: now };
    expect(emailAttachmentSchema.parse(completed)).toMatchObject({ storageKey: `email/${otherKey}/${key}` });
    expect(() => emailAttachmentSchema.parse({ ...completed, archiveDocumentKey: otherKey })).toThrow();
    expect(() => emailAttachmentSchema.parse({ ...completed, status: 'processing' })).toThrow();
    expect(emailAttachmentSchema.parse({ ...completed, status: 'processing', galleryImageKey: undefined, leaseToken: '11111111-1111-4111-8111-111111111111', leaseExpiresAt: now })).toBeTruthy();
  });

  test('creates scoped Archive copies with independent identity', () => {
    const thread = emailThreadRecordSchema.parse({ ...base, accountKey: key, providerThreadId: 'thread', subject: 'Subject', summary: 'Summary', intent: 'Reply', priority: 'normal', state: 'needs_action', lastMessageAt: now });
    const exported = exportEmailThreadToArchive(thread, { scopeKey: otherKey, exportKey: 'cmrnlzf660003qc7kmember001', folderKey: key, exportedAt: now });
    expect(exported.key).not.toBe(thread.key);
    expect(JSON.parse(exported.content)).toMatchObject({ kind: 'mail-thread', data: { providerThreadId: 'thread' } });
    expect(() => exportEmailThreadToArchive(thread, { scopeKey: otherKey, exportKey: thread.key, folderKey: key, exportedAt: now })).toThrow('independent');
  });
});
