import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { archiveDocument, decodeEmailDraft, decodeEmailTone, emailArchivePayloadContent, emailAttachmentRefsSchema, emailContactPayloadSchema, emailDraftPayloadSchema, emailRulePayloadSchema, emailTonePayloadSchema, emailWritingProfilePayloadSchema, encodeArchivePayload, encodeEmailToneContent, legacyEmailArchiveContent } from './archive-payloads';

const key = 'cmrnlzf650002qc7k4p5zem5w';
const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const now = '2026-08-20T09:00:00.000Z';
const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);
const envelopeDocument = (payload: unknown, name = 'Mail') => archiveDocument({ key, scopeKey, folderKey: scopeKey, name, content: encodeArchivePayload(payload), embedding, createdAt: now, updatedAt: now });

describe('mail Archive payload codecs', () => {
  test('round-trips a strict versioned new draft without embedding bytes in content', () => {
    const payload = emailDraftPayloadSchema.parse({ version: 1, kind: 'mail-new-draft', data: { variant: 'new', accountKey: key, to: ['person@example.com'], subject: 'Hello', generatedContent: 'Body', status: 'generated', attachments: [{ type: 'document', key }] } });
    const document = envelopeDocument(payload, 'Hello');
    expect(decodeEmailDraft(document)).toMatchObject({ key, scopeKey, variant: 'new', creationSource: 'manual', subject: 'Hello', attachments: [{ type: 'document', key }] });
    expect(document.content).not.toContain('embedding');
  });

  test('preserves exact blank authored draft fields', () => {
    const payload = emailDraftPayloadSchema.parse({ version: 1, kind: 'mail-new-draft', data: { variant: 'new', accountKey: key, to: ['person@example.com'], subject: '', generatedContent: '(Empty message)', finalContent: '', status: 'edited' } });
    const document = envelopeDocument(payload, '(No subject)');
    expect(decodeEmailDraft(document)).toMatchObject({ subject: '', finalContent: '', status: 'edited' });
  });

  test('persists a validated Archive representation only for its exact email payload', () => {
    const payload = emailDraftPayloadSchema.parse({ version: 1, kind: 'mail-new-draft', data: { variant: 'new', accountKey: key, to: ['person@example.com'], subject: 'Hello', generatedContent: 'Body', status: 'generated' } });
    const content = emailArchivePayloadContent(payload);
    const representation = { content, embedding, contentChunks: ['semantic email'], chunkEmbeddings: [embedding], semanticChunkCount: 1, semanticContentHash: 'a'.repeat(64) };
    const document = archiveDocument({ key, scopeKey, folderKey: scopeKey, name: 'Hello', content, representation, createdAt: now, updatedAt: now });
    expect(document).toMatchObject(representation);
    expect(() => archiveDocument({ key, scopeKey, folderKey: scopeKey, name: 'Hello', content: 'Different', representation, createdAt: now, updatedAt: now })).toThrow('does not match');
  });

  test('rejects duplicate and overlapping new-draft recipients case-insensitively', () => {
    const base = { variant: 'new' as const, accountKey: key, subject: 'Hello', generatedContent: 'Body', status: 'generated' as const };
    expect(() => emailDraftPayloadSchema.parse({ version: 1, kind: 'mail-new-draft', data: { ...base, to: ['A@example.com', 'a@example.com'] } })).toThrow('Duplicate TO');
    expect(() => emailDraftPayloadSchema.parse({ version: 1, kind: 'mail-new-draft', data: { ...base, to: ['a@example.com'], bcc: ['A@example.com'] } })).toThrow('already present in TO');
  });

  test('round-trips safe reply mode and resolved recipients with compatibility defaults', () => {
    const payload = emailDraftPayloadSchema.parse({ version: 1, kind: 'mail-reply-draft', data: { variant: 'reply', replyMode: 'reply_all', threadKey: key, messageKey: scopeKey, to: ['person@example.com'], cc: ['copy@example.com'], generatedContent: 'Body', status: 'generated' } });
    const document = envelopeDocument(payload, 'Reply');
    expect(decodeEmailDraft(document)).toMatchObject({ creationSource: 'manual', replyMode: 'reply_all', to: ['person@example.com'], cc: ['copy@example.com'] });
    const automatic = emailDraftPayloadSchema.parse({ version: 1, kind: 'mail-reply-draft', data: { ...payload.data, creationSource: 'subscription' } });
    expect(automatic.data.creationSource).toBe('subscription');
    const legacy = emailDraftPayloadSchema.parse({ version: 1, kind: 'mail-reply-draft', data: { threadKey: key, messageKey: scopeKey, generatedContent: 'Body', status: 'generated' } });
    expect(legacy.data).toMatchObject({ replyMode: 'reply', to: [], cc: [] });
    expect(() => emailDraftPayloadSchema.parse({ version: 1, kind: 'mail-new-draft', data: { variant: 'new', creationSource: 'subscription', accountKey: key, to: ['person@example.com'], subject: 'Hello', generatedContent: 'Body', status: 'generated' } })).toThrow();
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
    const tone = { slug: 'warm' as const, name: 'Warm' as const, instruction: 'Sound human.' };
    const document = envelopeDocument(emailTonePayloadSchema.parse({ version: 1, kind: 'mail-tone', data: tone }), tone.name);
    document.content = `# Warm\n\n<!-- vorinthex-mail-tone {"version":1,"slug":"warm"} -->\n\nLegacy description.\n\n## Instruction\n\nOpen with appreciation and use plain language.`;
    expect(decodeEmailTone(document)).toMatchObject({ slug: 'warm', name: 'Warm', instruction: 'Open with appreciation and use plain language.' });
    expect(decodeEmailTone(document)).not.toHaveProperty('description');
    expect(encodeEmailToneContent(tone)).not.toContain('Legacy description');
    expect(() => emailTonePayloadSchema.parse({ version: 1, kind: 'mail-tone', data: { ...tone, description: 'Removed' } })).toThrow();
    expect(document.mutationPolicy).toBe('user');
    expect(() => decodeEmailTone({ ...document, content: document.content.replace('"warm"', '"invented"') })).toThrow();
  });

  test('creates ordinary mail documents and retains the legacy tone backfill', async () => {
    const payload = emailDraftPayloadSchema.parse({ version: 1, kind: 'mail-new-draft', data: { variant: 'new', accountKey: key, to: ['person@example.com'], subject: 'Hello', generatedContent: 'Body', status: 'generated' } });
    expect(archiveDocument({ key, scopeKey, folderKey: scopeKey, name: 'Draft', content: emailArchivePayloadContent(payload), embedding, createdAt: now, updatedAt: now }).mutationPolicy).toBe('user');
    const migration = await Bun.file(new URL('../../db/arango-migrate.ts', import.meta.url)).text();
    expect(migration).toContain('payload.kind == "mail-tone"');
    expect(migration).toContain('mutationPolicy: "user"');
    expect(migration).toContain('vorinthex-mail-tone');
  });

  test('projects current and legacy email envelopes into user-facing Archive text', () => {
    const payload = emailDraftPayloadSchema.parse({ version: 1, kind: 'mail-new-draft', data: { variant: 'new', accountKey: key, to: ['person@example.com'], subject: 'Hello', generatedContent: 'Readable body', status: 'generated' } });
    expect(emailArchivePayloadContent(payload)).toContain('Readable body');
    expect(legacyEmailArchiveContent(JSON.stringify(payload))).toBe(emailArchivePayloadContent(payload));
    const legacy = { type: 'mail-reply-context', version: 1, emailDraftKey: key, intent: 'Arrange a meeting', context: { recipientName: 'Hugo', relationship: 'Professional contact', relevantPoints: ['Prefers mornings'] } };
    const content = legacyEmailArchiveContent(JSON.stringify(legacy));
    expect(content).toContain('Arrange a meeting');
    expect(content).toContain('Recipient Name');
    expect(content).not.toContain('emailDraftKey');
    expect(content?.trim().startsWith('{')).toBe(false);
  });
});
