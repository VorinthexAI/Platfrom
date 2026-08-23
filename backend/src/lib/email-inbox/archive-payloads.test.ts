import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { archiveDocument, decodeEmailDraft, decodeEmailTone, emailAttachmentRefsSchema, emailContactPayloadSchema, emailDraftPayloadSchema, emailRulePayloadSchema, emailTonePayloadSchema, emailWritingProfilePayloadSchema, encodeArchivePayload, encodeEmailToneContent } from './archive-payloads';

const key = 'cmrnlzf650002qc7k4p5zem5w';
const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const now = '2026-08-20T09:00:00.000Z';
const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);

describe('mail Archive payload codecs', () => {
  test('round-trips a strict versioned new draft without embedding bytes in content', () => {
    const payload = emailDraftPayloadSchema.parse({ version: 1, kind: 'mail-new-draft', data: { variant: 'new', accountKey: key, to: ['person@example.com'], subject: 'Hello', generatedContent: 'Body', status: 'generated', attachments: [{ type: 'document', key }] } });
    const document = archiveDocument({ key, scopeKey, folderKey: scopeKey, name: 'Hello', payload, embedding, createdAt: now, updatedAt: now });
    expect(decodeEmailDraft(document)).toMatchObject({ key, scopeKey, variant: 'new', subject: 'Hello', attachments: [{ type: 'document', key }] });
    expect(document.content).not.toContain('embedding');
  });

  test('rejects unknown fields, versions, attachment kinds, and more than twenty refs', () => {
    const base = { version: 1, kind: 'mail-new-draft', data: { variant: 'new', accountKey: key, to: ['person@example.com'], subject: 'Hello', generatedContent: 'Body', status: 'generated' } };
    expect(() => emailDraftPayloadSchema.parse({ ...base, extra: true })).toThrow();
    expect(() => encodeArchivePayload({ ...base, extra: true })).toThrow();
    expect(() => emailDraftPayloadSchema.parse({ ...base, version: 2 })).toThrow();
    expect(() => emailAttachmentRefsSchema.parse([{ type: 'file', key }])).toThrow();
    expect(() => emailAttachmentRefsSchema.parse(Array.from({ length: 21 }, () => ({ type: 'document', key })))).toThrow();
  });

  test('preserves strict custom writing profiles as protected Archive payloads', () => {
    expect(emailWritingProfilePayloadSchema.parse({ version: 1, kind: 'mail-writing-profile', data: { name: 'Founder', description: 'Personal style', tone: 'Calm', style: 'Plain', structure: 'Short', vocabulary: 'Simple', conventions: 'Sign with first name' } }).kind).toBe('mail-writing-profile');
    expect(() => emailWritingProfilePayloadSchema.parse({ version: 1, kind: 'mail-writing-profile', data: { name: 'Incomplete' } })).toThrow();
  });

  test('accepts strict migrated contact and rule payloads', () => {
    expect(emailContactPayloadSchema.parse({ version: 1, kind: 'mail-contact', data: { email: 'person@example.com', name: 'Person' } }).kind).toBe('mail-contact');
    expect(emailRulePayloadSchema.parse({ version: 1, kind: 'mail-rule', data: { name: 'Priority', description: 'Founder mail', condition: 'From founder', instruction: 'Prioritize it', action: 'prioritize', config: {}, isEnabled: true } }).kind).toBe('mail-rule');
    expect(() => emailRulePayloadSchema.parse({ version: 1, kind: 'mail-rule', data: { name: 'Incomplete' } })).toThrow();
  });

  test('decodes user-edited Markdown tones while preserving strict canonical metadata', () => {
    const tone = { slug: 'warm' as const, name: 'Warm' as const, description: 'Friendly and considerate.', instruction: 'Sound human.' };
    const document = archiveDocument({ key, scopeKey, folderKey: scopeKey, name: tone.name, payload: emailTonePayloadSchema.parse({ version: 1, kind: 'mail-tone', data: tone }), embedding, createdAt: now, updatedAt: now, mutationPolicy: 'user' });
    document.content = encodeEmailToneContent(tone).replace('Friendly and considerate.', 'Friendly, calm, and concise.').replace('Sound human.', 'Open with appreciation and use plain language.');
    expect(decodeEmailTone(document)).toMatchObject({ slug: 'warm', name: 'Warm', description: 'Friendly, calm, and concise.', instruction: 'Open with appreciation and use plain language.' });
    expect(document.mutationPolicy).toBe('user');
    expect(() => decodeEmailTone({ ...document, content: document.content.replace('"warm"', '"invented"') })).toThrow();
  });

  test('keeps non-tone mail documents hidden and includes the tone backfill migration', async () => {
    const payload = emailDraftPayloadSchema.parse({ version: 1, kind: 'mail-new-draft', data: { variant: 'new', accountKey: key, to: ['person@example.com'], subject: 'Hello', generatedContent: 'Body', status: 'generated' } });
    expect(archiveDocument({ key, scopeKey, folderKey: scopeKey, name: 'Draft', payload, embedding, createdAt: now, updatedAt: now }).mutationPolicy).toBe('system-only');
    const migration = await Bun.file(new URL('../../db/arango-migrate.ts', import.meta.url)).text();
    expect(migration).toContain('payload.kind == "mail-tone"');
    expect(migration).toContain('mutationPolicy: "user"');
    expect(migration).toContain('vorinthex-mail-tone');
  });
});
