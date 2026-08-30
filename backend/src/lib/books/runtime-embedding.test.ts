import { expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { createBookRuntime } from './runtime';

test('persists accepted audio book intent without waiting for embedding providers', async () => {
  const scopeKey = newId(), userKey = newId();
  const persisted: Array<{ book: any; context: any; sources: any[]; share: any }> = [];
  let embeddingCalls = 0;
  const token = 'A'.repeat(43); let encryptedValue: unknown;
  const repository = {
    authorize: async () => {},
    sourceDocuments: async () => [{ key: newId(), name: 'Practice notes', content: 'A useful source about deliberate practice.', updatedAt: '2026-08-27T12:00:00.000Z' }],
    create: async (_context: unknown, book: any, context: any, sources: any[], share: any) => { persisted.push({ book, context, sources, share }); return book; },
  };
  const runtime = createBookRuntime({
    repository: repository as never,
    embed: async () => { embeddingCalls += 1; throw new Error('embedding provider must not block acceptance'); },
    randomShareToken: () => token,
    encryptShareReplay: (value) => { encryptedValue = value; return 'v1:a:b:c'; },
    id: newId,
    now: () => '2026-08-27T12:00:00.000Z',
  });

  await runtime.create({ organizationKey: 'organization', scopeKey, generationRequestKey: 'request', generationBriefFingerprint: 'a'.repeat(64), topic: 'Build useful habits', goal: 'Create a durable daily practice', currentKnowledge: '', writingTone: 'Clear and practical', chapterCount: 10, language: 'English', archiveDocumentKeys: [newId()], narratorVoiceKey: 'clear', narrationPace: 1 }, { organizationKey: 'organization', scopeKey, userKey });

  expect(persisted).toHaveLength(1);
  expect(persisted[0]!.book.audience).toBe('No prior knowledge provided');
  expect(persisted[0]!.book.generationTotalUnits).toBe(33);
  expect(persisted[0]!.book.generationInput).not.toHaveProperty('chapterImages');
  expect(persisted[0]!.book.embedding).toEqual(Array(EMBEDDING_DIMENSIONS).fill(0));
  expect(persisted[0]!.context.embedding).toEqual(Array(EMBEDDING_DIMENSIONS).fill(0));
  expect(persisted[0]!.sources[0].embedding).toEqual(Array(EMBEDDING_DIMENSIONS).fill(0));
  expect(persisted[0]!.share).toMatchObject({ sourceType: 'book', sourceKey: persisted[0]!.book.key, permission: 'read', revokedAt: '2026-08-27T12:00:00.000Z', responseCiphertext: 'v1:a:b:c' });
  expect(persisted[0]!.share.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  expect(encryptedValue).toEqual({ token });
  expect(JSON.stringify(persisted[0])).not.toContain(token);
  expect(embeddingCalls).toBe(0);
});
