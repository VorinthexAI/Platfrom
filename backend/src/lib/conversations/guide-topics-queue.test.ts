import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { SparkRepositoryError } from '@/lib/sparks/repository';
import type { ConversationMessage } from './schemas';
import type { ConversationRepository } from './repository';
import { conversationGuideTopicsJobId, enqueueConversationGuideTopics, processConversationGuideTopics, recoverConversationGuideTopicsQueue } from './guide-topics-queue';

const teamKey = newId(), scopeKey = newId(), userKey = newId(), actorKey = newId(), conversationKey = newId(), assistantMessageKey = newId();
const job = { schemaVersion: 1 as const, assistantMessageKey, conversationKey, teamKey, scopeKey, userKey, actorKey, generation: 2 };
const message = { key: assistantMessageKey, conversationKey, teamKey, scopeKey, userKey, turnKey: 'turn', requestHash: 'a'.repeat(64), type: 'TEXT', role: 'ASSISTANT', status: 'COMPLETED', content: 'Completed answer', attachments: [], attachmentStatus: 'NONE', retrievals: [], guideTopics: { status: 'PENDING' }, guideMode: 'recommend', guideContext: { mode: 'recommend', guides: [] }, guideTopicGeneration: 2, createdAt: '2026-09-12T00:00:00.000Z', completedAt: '2026-09-12T00:00:01.000Z' } satisfies ConversationMessage;

describe('conversation guide topics queue', () => {
  test('uses deterministic generation-fenced job identities and strict jobs', async () => {
    const added: unknown[][] = [];
    const queue = { getJob: async () => undefined, add: async (...args: unknown[]) => { added.push(args); return { id: conversationGuideTopicsJobId(assistantMessageKey, 2) }; } };
    const first = await enqueueConversationGuideTopics(job, queue as never);
    const second = await enqueueConversationGuideTopics(job, queue as never);
    expect(first).toEqual(second); expect(added[0]?.[2]).toMatchObject({ attempts: 3, jobId: first.jobId, backoff: { type: 'exponential' } });
    await expect(enqueueConversationGuideTopics({ ...job, answer: 'forged' }, queue as never)).rejects.toThrow('Unrecognized key');
  });

  test('reloads authoritative context, commits before publishing, and fences stale work', async () => {
    const operations: string[] = []; let supplied: any;
    const repository = {
      readGuideTopicSnapshot: async () => ({ message, question: 'Vad kan jag göra nu?', recentTopicLabels: ['Tidigare'] }),
      commitGuideTopics: async () => { operations.push('commit'); return true; },
    } as unknown as ConversationRepository;
    const result = await processConversationGuideTopics(job, { repository, run: (async (_name: string, _skill: string, input: unknown, dependencies: unknown) => { supplied = { input, dependencies }; return { mode: 'topics', guideMode: 'explain', topics: [1, 2, 3].map((value) => ({ key: newId(), label: `Ämne ${value}`, question: `Fråga ${value}?` })) }; }) as never, publishChanged: async () => { operations.push('publish'); } });
    expect(result).toEqual({ status: 'committed' }); expect(operations).toEqual(['commit', 'publish']);
    expect(supplied.input).toEqual({ mode: 'topics', question: 'Vad kan jag göra nu?', answer: 'Completed answer', guideContext: message.guideContext, recentTopicLabels: ['Tidigare'] });
    expect(supplied.dependencies.requestKey).toBe(`guide-topics:${assistantMessageKey}:2`);
    let called = false;
    await expect(processConversationGuideTopics(job, { repository: { readGuideTopicSnapshot: async () => null } as unknown as ConversationRepository, run: (async () => { called = true; }) as never })).resolves.toEqual({ status: 'stale' });
    expect(called).toBe(false);
  });

  test('retries transient failures but terminalizes and publishes funding failures', async () => {
    let failures = 0; const publications: unknown[][] = [];
    const repository = { readGuideTopicSnapshot: async () => ({ message, question: 'Question', recentTopicLabels: [] }), failGuideTopics: async () => { failures += 1; return true; } } as unknown as ConversationRepository;
    const failedRun = (async () => { throw new Error('provider unavailable'); }) as never;
    await expect(processConversationGuideTopics(job, { repository, run: failedRun, terminalFailure: false })).rejects.toThrow('provider unavailable'); expect(failures).toBe(0);
    const insufficient = (async () => { throw new SparkRepositoryError('INSUFFICIENT_BALANCE', 'private'); }) as never;
    await expect(processConversationGuideTopics(job, { repository, run: insufficient, terminalFailure: true, publishChanged: async (...args: unknown[]) => { publications.push(args); } })).resolves.toEqual({ status: 'failed' });
    expect(failures).toBe(1); expect(publications).toContainEqual([userKey, 'spark.balance.required', 'INSUFFICIENT_BALANCE', assistantMessageKey]); expect(publications).toContainEqual([userKey, 'conversation.changed']);
  });

  test('recovers every durable pending generation not already active', async () => {
    const added: unknown[][] = [];
    const queue = { getJobs: async () => [], getJob: async () => undefined, add: async (...args: unknown[]) => { added.push(args); return { id: 'job' }; } };
    const repository = { listPendingGuideTopics: async () => [{ message, actorKey }] } as unknown as ConversationRepository;
    await expect(recoverConversationGuideTopicsQueue({ repository, queue: queue as never })).resolves.toEqual({ enqueued: 1 });
    expect(added[0]?.[1]).toEqual(job);
  });
});
