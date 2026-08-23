import { describe, expect, test } from 'bun:test';
import { createEmailRepository } from './repository';
import { archiveDocument, emailThreadPayloadSchema, emailTonePayloadSchema, encodeEmailToneContent } from './archive-payloads';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { newId } from '@/lib/ids';

const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const documentKey = 'cmrnlzf650002qc7k4p5zem5w';

describe('mail Archive repository attachments', () => {
  test('accepts only references resolved inside the authorized scope', async () => {
    let bindVars: Record<string, unknown> | undefined;
    const database = { query: async (_query: string, values: Record<string, unknown>) => { bindVars = values; return { all: async () => [{ type: 'document', key: documentKey, name: 'Plan' }] }; }, collection: () => ({}) };
    const repository = createEmailRepository(database as never);
    const refs = [{ type: 'document' as const, key: documentKey }];
    expect(await repository.resolveAttachments(scopeKey, refs)).toEqual(refs);
    expect(bindVars).toMatchObject({ scopeKey, refs });
  });

  test('rejects missing, cross-scope, and duplicate references', async () => {
    const database = { query: async () => ({ all: async () => [] }), collection: () => ({}) };
    const repository = createEmailRepository(database as never);
    await expect(repository.resolveAttachments(scopeKey, [{ type: 'image', key: documentKey }])).rejects.toThrow('authorized scope');
    await expect(repository.resolveAttachments(scopeKey, [{ type: 'document', key: documentKey }, { type: 'document', key: documentKey }])).rejects.toThrow('unique');
  });
});

describe('mail overview cursor pagination', () => {
  test('returns fifty rows and binds cursors to scope, filter, and normalized search', async () => {
    const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);
    const documents = Array.from({ length: 51 }, (_, index) => {
      const key = newId();
      const lastMessageAt = new Date(Date.parse('2026-08-23T12:00:00.000Z') - index * 1000).toISOString();
      const payload = emailThreadPayloadSchema.parse({ version: 1, kind: 'mail-thread', data: { accountKey: documentKey, providerThreadId: `thread-${index}`, subject: `Thread ${index}`, summary: 'Summary', intent: 'Review', priority: 'normal', state: 'needs_action', lastMessageAt, inInbox: true, isFavorite: false } });
      return archiveDocument({ key, scopeKey, folderKey: scopeKey, name: `Thread ${index}`, payload, embedding, createdAt: lastMessageAt, updatedAt: lastMessageAt });
    });
    const calls: Array<{ query: string; bindVars: Record<string, any> }> = [];
    const database = { query: async (query: string, bindVars: Record<string, any>) => { calls.push({ query, bindVars }); return { next: async () => ({ documents: calls.length === 1 ? documents.map(({ key, ...document }) => ({ ...document, _key: key })) : [], counts: { all: 51, important: 0, urgent: 0, needsAction: 51, filtered: 0, unread: 0, favorite: 0 } }) }; }, collection: () => ({}) };
    const repository = createEmailRepository(database as never);
    const first = await repository.overview(scopeKey, 'all', '  PLAN  ');
    expect(first.threads).toHaveLength(50);
    expect(first.nextCursor).toBeString();
    expect(first.counts).toMatchObject({ all: 51, needsAction: 51 });
    expect(calls[0]?.bindVars).toMatchObject({ scopeKey, filter: 'all', search: 'plan', pageSize: 51 });
    expect(calls[0]?.query).toContain('LIMIT @pageSize');
    await repository.overview(scopeKey, 'all', 'plan', first.nextCursor!);
    expect(calls[1]?.bindVars.after).toMatchObject({ scopeKey, filter: 'all', search: 'plan', key: first.threads.at(-1)!.key });
    await expect(repository.overview(scopeKey, 'urgent', 'plan', first.nextCursor!)).rejects.toThrow('another scope or query');
    await expect(repository.overview(newId(), 'all', 'plan', first.nextCursor!)).rejects.toThrow('another scope or query');
    await expect(repository.overview(scopeKey, 'all', 'different', first.nextCursor!)).rejects.toThrow('another scope or query');
  });
});

describe('mail tone persistence', () => {
  test('embeds placeholder edited content, skips populated tones, and seeds missing defaults without overwriting', async () => {
    const warmKey = 'c243153d93fec022e17d04bc4';
    const conciseKey = 'c8557168cd0ddd166ee24e569';
    const placeholder = Array(EMBEDDING_DIMENSIONS).fill(0);
    const populatedEmbedding = Array(EMBEDDING_DIMENSIONS).fill(0.9);
    const warm = { slug: 'warm' as const, name: 'Warm' as const, description: 'My calmer description.', instruction: 'Use my edited voice.' };
    const concise = { slug: 'concise' as const, name: 'Concise' as const, description: 'Already embedded.', instruction: 'Keep this existing tone.' };
    const edited = archiveDocument({ key: warmKey, scopeKey, folderKey: scopeKey, name: warm.name, payload: emailTonePayloadSchema.parse({ version: 1, kind: 'mail-tone', data: warm }), embedding: placeholder, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T01:00:00.000Z', mutationPolicy: 'user' });
    edited.content = encodeEmailToneContent(warm);
    const populated = archiveDocument({ key: conciseKey, scopeKey, folderKey: scopeKey, name: concise.name, payload: emailTonePayloadSchema.parse({ version: 1, kind: 'mail-tone', data: concise }), embedding: populatedEmbedding, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T01:00:00.000Z', mutationPolicy: 'user' });
    populated.content = encodeEmailToneContent(concise);
    const raw = ({ key, ...document }: Record<string, any>): Record<string, any> => ({ ...document, _key: key });
    const documents = [raw(edited), raw(populated)];
    const seeds: Record<string, any>[] = [];
    const updates: Array<{ key: string; patch: Record<string, any> }> = [];
    const embeddedContent: string[] = [];
    const database = { query: async (query: string, bindVars?: Record<string, any>) => {
      if (bindVars?.document) { seeds.push(bindVars.document); documents.push(bindVars.document); }
      return { all: async () => query.includes('FOR document IN documents') ? documents : [] };
    }, collection: () => ({ update: async (key: string, patch: Record<string, any>) => {
      updates.push({ key, patch });
      Object.assign(documents.find((document) => document._key === key)!, patch);
    } }) };
    const tones = await createEmailRepository(database as never).listTones(scopeKey, async (content) => {
      embeddedContent.push(content);
      return Array(EMBEDDING_DIMENSIONS).fill(embeddedContent.length / 10);
    });
    expect(embeddedContent[0]).toBe(edited.content);
    expect(embeddedContent).not.toContain(populated.content);
    expect(embeddedContent).toHaveLength(3);
    expect(updates).toEqual([{ key: warmKey, patch: { embedding: Array(EMBEDDING_DIMENSIONS).fill(0.1) } }]);
    expect(seeds).toHaveLength(2);
    expect(seeds.every(({ mutationPolicy, content }) => mutationPolicy === 'user' && content.includes('vorinthex-mail-tone'))).toBe(true);
    expect(seeds.map(({ _key }) => _key)).not.toContain(warmKey);
    expect(documents.find(({ _key }) => _key === warmKey)?.content).toBe(edited.content);
    expect(tones).toContainEqual(expect.objectContaining({ key: warmKey, slug: 'warm', description: warm.description, instruction: warm.instruction }));
  });

  test('selects an edited tone by slug through writingProfile', async () => {
    const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.5);
    const tone = { slug: 'warm' as const, name: 'Warm' as const, description: 'My calmer description.', instruction: 'Use my edited voice.' };
    const edited = archiveDocument({ key: 'c243153d93fec022e17d04bc4', scopeKey, folderKey: scopeKey, name: tone.name, payload: emailTonePayloadSchema.parse({ version: 1, kind: 'mail-tone', data: tone }), embedding, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T01:00:00.000Z', mutationPolicy: 'user' });
    edited.content = encodeEmailToneContent(tone);
    const database = { query: async (query: string) => ({ all: async () => query.includes('FOR document IN documents') ? [{ ...edited, key: undefined, _key: edited.key }] : [] }), collection: () => ({ update: async () => undefined }) };
    const profile = await createEmailRepository(database as never).writingProfile(scopeKey, undefined, 'warm', async () => embedding);
    expect(profile).toMatchObject({ slug: 'warm', tone: tone.instruction, style: tone.description, vocabulary: tone.instruction });
  });
});
