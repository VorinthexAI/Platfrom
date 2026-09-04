import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createBookRuntime } from './runtime';
import { observeToolExecution } from '@/lib/ai/events/runtime';
import { createBookService } from './service';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';

const scopeKey = newId(); const userKey = newId(); const organizationKey = 'organization'; const transactionKey = newId();
const receipt = { userKey, transactionKey, executionIdentity: 'a'.repeat(64), microSparks: 100_000_000 };
const generation = { organizationKey, scopeKey, generationRequestKey: 'create-1', generationBriefFingerprint: 'b'.repeat(64), topic: 'Reliable systems', goal: 'Understand retries', currentKnowledge: '', writingTone: 'Clear', chapterCount: 10 as const, language: 'English', archiveDocumentKeys: [], narratorVoiceKey: 'clear' as const, narrationPace: 1, fixedChargeReceipt: { ...receipt, toolSlug: 'book.create', replayed: false } };

describe('book billing receipt persistence', () => {
  test('persists the trusted create receipt on the book rather than generation input', async () => {
    let saved: any;
    const repository: any = { authorize: async () => {}, sourceDocuments: async () => [], create: async (_context: unknown, book: unknown) => { saved = book; return book; } };
    await createBookRuntime({ repository, id: newId, randomShareToken: () => 'x'.repeat(43), encryptShareReplay: () => 'v1:a:b:c' }).create(generation, { organizationKey, scopeKey, userKey });
    expect(saved.fixedChargeReceipt).toEqual(generation.fixedChargeReceipt);
    expect(saved.generationInput).not.toHaveProperty('fixedChargeReceipt');
  });

  test('passes the trusted generated-extension receipt into atomic acceptance', async () => {
    const bookKey = newId(); const extensionTransactionKey = newId(); let accepted: any;
    const current: any = { book: { key: bookKey, scopeKey, title: 'Book', description: 'Description', goal: 'Learn', audience: 'Reader', outcome: 'Knowledge', language: 'English', generationStage: 'complete', generationCompletedUnits: 1, generationTotalUnits: 1, generationAttempt: 0, estimatedMinutes: 10, chapterCount: 1, status: 'ready', embedding: Array(EMBEDDING_DIMENSIONS).fill(0), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, chapters: [{ chapter: { key: newId(), position: 1, title: 'Existing', description: 'Summary', status: 'audio-ready', content: 'Content', audioStorageKey: 'audio', audioDurationSeconds: 60 }, progress: null }] };
    const repository: any = { detail: async () => current, acceptExtension: async (_context: unknown, extension: unknown) => { accepted = extension; return { extension, book: { ...current.book, status: 'queued', chapterCount: 2, activeExtensionKey: (extension as any).key }, replayed: false }; } };
    const service = createBookService({ repository, generator: { create: async () => bookKey, write: async () => {} }, detach: () => {}, signUrl: async () => 'signed', publishChanged: async () => {} });
    const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as never;
    await observeToolExecution('book.extend', context, () => service.extend(bookKey, { organizationKey, scopeKey, mode: 'generate', chapterCount: 1, titles: ['Next'], requestKey: 'extend-1' }, userKey), { input: { mode: 'generate' }, idempotencyKey: 'extend-1', recorder: async () => {}, hash: async () => 'c'.repeat(64), charge: async (_key, input) => ({ status: 'applied', transaction: { key: extensionTransactionKey, eventKey: input.eventKey } }) as never });
    expect(accepted.fixedChargeReceipt).toEqual({ userKey, toolSlug: 'book.extend', transactionKey: extensionTransactionKey, executionIdentity: 'c'.repeat(64), microSparks: 30_000_000, replayed: false });
  });
});
