import { expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { createBookRuntime } from './runtime';

test('persists accepted audio book intent without waiting for embedding providers', async () => {
  const scopeKey = newId(), userKey = newId();
  const persisted: Array<{ book: any; context: any; sources: any[] }> = [];
  let embeddingCalls = 0;
  const repository = {
    authorize: async () => {},
    sourceDocuments: async () => [{ key: newId(), name: 'Practice notes', content: 'A useful source about deliberate practice.', updatedAt: '2026-08-27T12:00:00.000Z' }],
    create: async (_context: unknown, book: any, context: any, sources: any[]) => { persisted.push({ book, context, sources }); return book; },
  };
  const runtime = createBookRuntime({
    repository: repository as never,
    embed: async () => { embeddingCalls += 1; throw new Error('embedding provider must not block acceptance'); },
    id: newId,
    now: () => '2026-08-27T12:00:00.000Z',
  });

  await runtime.create({ teamKey: 'team', scopeKey, generationRequestKey: 'request', generationBriefFingerprint: 'a'.repeat(64), topic: 'Build useful habits', goal: 'Create a durable daily practice', currentKnowledge: '', writingTone: 'Clear and practical', chapterCount: 10, language: 'English', archiveDocumentKeys: [newId()], narratorVoiceKey: 'clear', narrationPace: 1 }, { teamKey: 'team', scopeKey, userKey });

  expect(persisted).toHaveLength(1);
  expect(persisted[0]!.book.audience).toBe('No prior knowledge provided');
  expect(persisted[0]!.book.generationTotalUnits).toBe(33);
  expect(persisted[0]!.book.generationInput).not.toHaveProperty('chapterImages');
  expect(persisted[0]!.book.embedding).toEqual(Array(EMBEDDING_DIMENSIONS).fill(0));
  expect(persisted[0]!.context.embedding).toEqual(Array(EMBEDDING_DIMENSIONS).fill(0));
  expect(persisted[0]!.sources[0].embedding).toEqual(Array(EMBEDDING_DIMENSIONS).fill(0));
  expect(embeddingCalls).toBe(0);
});
