import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { conversationImageTurnJobId, conversationImageTurnJobSchema, enqueueConversationImageTurn, processConversationImageTurn, recoverConversationImageTurnQueue } from './image-turn-queue';
import type { ConversationMessage } from './schemas';
import type { ConversationRepository } from './repository';
import { recordActionCost, recordActionUsage } from '@/lib/ai/events/runtime';

const organizationKey = 'organization', scopeKey = newId(), userKey = newId(), actorKey = newId(), conversationKey = newId(), assistantMessageKey = newId();
const input = { prompt: 'A quiet observatory', referenceImageKeys: [], size: '1024x1024' as const, quality: 'medium' as const, mode: 'default' as const };
const job = () => conversationImageTurnJobSchema.parse({ schemaVersion: 1, assistantMessageKey, conversationKey, organizationKey, scopeKey, userKey, actorKey, requestKey: 'image-turn', input });

describe('conversation image turn queue', () => {
  test('uses the assistant message as the deterministic job id and validates strict payloads', async () => {
    expect(conversationImageTurnJobId(assistantMessageKey)).toBe(assistantMessageKey);
    expect(() => conversationImageTurnJobSchema.parse({ ...job(), count: 2 })).toThrow('Unrecognized key');
    const calls: any[] = [];
    const queued = await enqueueConversationImageTurn(job(), { getJob: async () => undefined, add: async (...args: any[]) => { calls.push(args); return { id: args[2].jobId }; } } as never);
    expect(queued.jobId).toBe(assistantMessageKey); expect(calls[0]![2]).toMatchObject({ jobId: assistantMessageKey, attempts: 3 });
  });

  test('completes exactly one generated image and publishes the conversation change', async () => {
    const completed: unknown[] = []; const events: unknown[] = [];
    const repository = { completeImageTurn: async (...args: unknown[]) => { completed.push(args); return {} as never; }, failTurn: async () => { throw new Error('unexpected failure'); } } as unknown as ConversationRepository;
    const result = await processConversationImageTurn(job(), { repository, images: { generateManaged: async () => ({ images: [{ key: 'c123456789' }] }) } as never, publishChanged: async (...args: unknown[]) => { events.push(args); }, now: () => '2026-09-03T00:00:00.000Z' });
    expect(result).toEqual({ imageKey: 'c123456789' });
    expect(completed[0]).toEqual([{ organizationKey, scopeKey, userKey }, conversationKey, assistantMessageKey, 'c123456789', '2026-09-03T00:00:00.000Z']);
    expect(events).toEqual([[userKey, 'conversation.changed']]);
  });

  test('re-establishes action billing in the worker with the durable request identity', async () => {
    const charges: Record<string, unknown>[] = [];
    const repository = { completeImageTurn: async () => ({} as never), failTurn: async () => {} } as unknown as ConversationRepository;
    await processConversationImageTurn(job(), {
      repository,
      images: { generateManaged: async () => { await recordActionCost('image', { operation: 'generate', count: 1 }); await recordActionUsage('image', { operation: 'generate', count: 1 }, { inputTokens: 0, outputTokens: 0, totalTokens: 0 }); return { images: [{ key: 'c123456789' }] }; } } as never,
      publishChanged: async () => {}, recordEvent: async () => {},
      billing: { getBalance: async () => 100_000_000, charge: async (_key, input) => { charges.push(input); return { status: 'applied', transaction: { key: newId() } } as never; } },
    });
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ kind: 'action', actionSlug: 'image', microSparks: 30_000_000 });
  });

  test('marks only terminal failures and recovery re-enqueues missing pending turns', async () => {
    let failures = 0;
    const repository = { failTurn: async () => { failures += 1; } } as unknown as ConversationRepository;
    const images = { generateManaged: async () => { throw new Error('provider failed'); } } as never;
    await expect(processConversationImageTurn(job(), { repository, images, terminalFailure: false, publishChanged: async () => {} })).rejects.toThrow('provider failed');
    expect(failures).toBe(0);
    await expect(processConversationImageTurn(job(), { repository, images, terminalFailure: true, publishChanged: async () => {} })).rejects.toThrow('provider failed');
    expect(failures).toBe(1);

    const pending = { key: assistantMessageKey, conversationKey, organizationKey, scopeKey, userKey, turnKey: 'image-turn', requestHash: 'a'.repeat(64), type: 'IMAGE', role: 'ASSISTANT', status: 'PENDING', content: JSON.stringify(input), retrievals: [], createdAt: '2026-09-03T00:00:00.000Z' } satisfies ConversationMessage;
    const added: unknown[] = [];
    const queue = { getJobs: async () => [], getJob: async () => undefined, add: async (...args: unknown[]) => { added.push(args); return { id: assistantMessageKey }; } };
    const recoveryRepository = { listPendingImageTurns: async () => [{ message: pending, actorKey }] } as unknown as ConversationRepository;
    await expect(recoverConversationImageTurnQueue({ repository: recoveryRepository, queue: queue as never })).resolves.toEqual({ enqueued: 1 });
    expect(added).toHaveLength(1);
  });
});
