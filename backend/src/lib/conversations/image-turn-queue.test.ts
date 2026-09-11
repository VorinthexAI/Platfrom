import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { conversationImageTurnJobId, conversationImageTurnJobSchema, enqueueConversationImageTurn, processConversationImageTurn, recoverConversationImageTurnQueue } from './image-turn-queue';
import type { ConversationMessage } from './schemas';
import type { ConversationRepository } from './repository';
import type { ConversationAttachmentArtifact } from './attachment-artifacts';
import { recordActionCost, recordActionUsage } from '@/lib/ai/events/runtime';
import { SparkRepositoryError } from '@/lib/sparks/repository';

const teamKey = 'team', scopeKey = newId(), userKey = newId(), actorKey = newId(), conversationKey = newId(), assistantMessageKey = newId();
const input = { prompt: 'A quiet observatory', referenceImageKeys: [], size: '1024x1024' as const, quality: 'medium' as const, mode: 'default' as const };
const job = () => conversationImageTurnJobSchema.parse({ schemaVersion: 1, assistantMessageKey, conversationKey, teamKey, scopeKey, userKey, actorKey, requestKey: 'image-turn', input });
const stagedArtifact = (overrides: Partial<ConversationAttachmentArtifact> = {}): ConversationAttachmentArtifact => ({ key: newId(), ownerKey: actorKey, teamKey, scopeKey, userKey, conversationKey, requestKey: 'source-turn', userMessageKey: newId(), kind: 'image', filename: 'upload.png', mimeType: 'image/png', sizeBytes: 3, width: 1, height: 1, stagedStorageKey: 'pending/canonical.png', stagedSha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81', status: 'CLAIMED', attempts: 0, availableAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z', expiresAt: '2026-10-01T00:00:00.000Z', ...overrides });

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
    const result = await processConversationImageTurn(job(), { repository, images: { generateManaged: async () => ({ images: [{ key: 'c123456789', caption: 'A quiet observatory beneath the stars.' }] }) } as never, publishChanged: async (...args: unknown[]) => { events.push(args); }, now: () => '2026-09-03T00:00:00.000Z' });
    expect(result).toEqual({ imageKey: 'c123456789' });
    expect(completed[0]).toEqual([{ teamKey, scopeKey, userKey }, conversationKey, assistantMessageKey, 'c123456789', 'A quiet observatory beneath the stars.', '2026-09-03T00:00:00.000Z']);
    expect(events).toEqual([[userKey, 'conversation.changed']]);
  });

  test('resolves an owned canonical staged PNG as a trusted provider reference', async () => {
    const artifact = stagedArtifact(); let generated: any[] = [];
    const repository = { completeImageTurn: async () => ({} as never), failTurn: async () => false } as unknown as ConversationRepository;
    const result = await processConversationImageTurn({ ...job(), stagedImageArtifactKeys: [artifact.key] }, {
      repository, artifacts: { read: async () => artifact }, storage: { download: async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png', sizeBytes: 3 }) },
      images: { generateManaged: async (...args: any[]) => { generated = args; return { images: [{ key: 'c123456789' }] }; } } as never, publishChanged: async () => {}, now: () => '2026-09-02T00:00:00.000Z',
    });
    expect(result.imageKey).toBe('c123456789');
    expect(generated[0].referenceImageKeys).toEqual([]);
    expect(generated[3]).toEqual([{ identity: `artifact:${artifact.key}:${artifact.stagedSha256}`, inputReference: 'data:image/png;base64,AQID' }]);
  });

  test('rereads a staged reference when persistence wins the download race', async () => {
    const artifact = stagedArtifact(); const finalKey = newId(); let reads = 0; let generatedInput: any;
    const completed = { ...artifact, status: 'COMPLETED' as const, finalReference: { key: finalKey, kind: 'image' as const, filename: 'upload.png', mimeType: 'image/png' as const, sizeBytes: 3, width: 1, height: 1 } };
    await processConversationImageTurn({ ...job(), stagedImageArtifactKeys: [artifact.key] }, {
      repository: { completeImageTurn: async () => ({} as never), failTurn: async () => false } as unknown as ConversationRepository,
      artifacts: { read: async () => ++reads === 1 ? artifact : completed }, storage: { download: async () => { throw new Error('object deleted after persistence'); } },
      images: { generateManaged: async (value: any) => { generatedInput = value; return { images: [{ key: 'c123456789' }] }; } } as never, publishChanged: async () => {}, now: () => '2026-09-02T00:00:00.000Z',
    });
    expect(reads).toBe(2); expect(generatedInput.referenceImageKeys).toEqual([finalKey]);
  });

  test('rejects cross-owner staged references before generation', async () => {
    const artifact = stagedArtifact({ userKey: newId() }); let generated = false;
    await expect(processConversationImageTurn({ ...job(), stagedImageArtifactKeys: [artifact.key] }, {
      repository: { failTurn: async () => true } as unknown as ConversationRepository, artifacts: { read: async () => artifact }, storage: { download: async () => ({ bytes: new Uint8Array([1, 2, 3]) }) },
      images: { generateManaged: async () => { generated = true; return { images: [] }; } } as never, publishChanged: async () => {}, now: () => '2026-09-02T00:00:00.000Z',
    })).rejects.toThrow('does not belong');
    expect(generated).toBe(false);
  });

  test('re-establishes action billing in the worker with the durable request identity', async () => {
    const charges: Record<string, unknown>[] = [];
    const repository = { completeImageTurn: async () => ({} as never), failTurn: async () => {} } as unknown as ConversationRepository;
    await processConversationImageTurn(job(), {
      repository,
      images: { generateManaged: async () => { await recordActionCost('image', { operation: 'generate', count: 1 }); await recordActionUsage('image', { operation: 'generate', count: 1 }, { inputTokens: 0, outputTokens: 0, totalTokens: 0 }); return { images: [{ key: 'c123456789' }] }; } } as never,
      publishChanged: async () => {}, recordEvent: async () => {}, appScopeKey: newId(),
      billing: { getBalance: async () => 100_000_000, charge: async (_key, input) => { charges.push(input); return { status: 'applied', transaction: { key: newId() } } as never; } },
    });
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ kind: 'action', actionSlug: 'image', microSparks: 10_000_000 });
  });

  test('marks only terminal failures and recovery re-enqueues missing pending turns', async () => {
    let failures = 0;
    const repository = { failTurn: async () => { failures += 1; } } as unknown as ConversationRepository;
    const images = { generateManaged: async () => { throw new Error('provider failed'); } } as never;
    await expect(processConversationImageTurn(job(), { repository, images, terminalFailure: false, publishChanged: async () => {} })).rejects.toThrow('provider failed');
    expect(failures).toBe(0);
    await expect(processConversationImageTurn(job(), { repository, images, terminalFailure: true, publishChanged: async () => {} })).rejects.toThrow('provider failed');
    expect(failures).toBe(1);

  const recoveryArtifactKey = newId();
  const pending = { key: assistantMessageKey, conversationKey, teamKey, scopeKey, userKey, turnKey: 'image-turn', requestHash: 'a'.repeat(64), type: 'IMAGE', role: 'ASSISTANT', status: 'PENDING', content: JSON.stringify(input), imageReferenceArtifactKeys: [recoveryArtifactKey], attachments: [], attachmentStatus: 'NONE', retrievals: [], createdAt: '2026-09-03T00:00:00.000Z' } satisfies ConversationMessage;
    const added: unknown[] = [];
    const queue = { getJobs: async () => [], getJob: async () => undefined, add: async (...args: unknown[]) => { added.push(args); return { id: assistantMessageKey }; } };
    const recoveryRepository = { listPendingImageTurns: async () => [{ message: pending, actorKey }] } as unknown as ConversationRepository;
    await expect(recoverConversationImageTurnQueue({ repository: recoveryRepository, queue: queue as never })).resolves.toEqual({ enqueued: 1 });
    expect(added).toHaveLength(1);
    expect((added[0] as any[])[1].stagedImageArtifactKeys).toEqual([recoveryArtifactKey]);
  });

  test('publishes one reason-preserving funding event on a terminal worker-time billing failure', async () => {
    const events: unknown[][] = [];
    const operations: string[] = [];
    const failures: unknown[][] = [];
    const repository = { failTurn: async (...args: unknown[]) => { operations.push('persist'); failures.push(args); return true; } } as unknown as ConversationRepository;
    const images = { generateManaged: async () => { throw new SparkRepositoryError('OUTSTANDING_DEBT', 'debt'); } } as never;
    await expect(processConversationImageTurn(job(), {
      repository, images, terminalFailure: false,
      publishChanged: async (...args) => { operations.push(String(args[1])); events.push(args); },
    })).rejects.toMatchObject({ code: 'OUTSTANDING_DEBT' });
    expect(events).toEqual([]);

    await expect(processConversationImageTurn(job(), {
      repository, images, terminalFailure: true,
      publishChanged: async (...args) => { operations.push(String(args[1])); events.push(args); },
    })).rejects.toMatchObject({ code: 'OUTSTANDING_DEBT' });
    expect(events).toEqual([[userKey, 'spark.balance.required', 'OUTSTANDING_DEBT', assistantMessageKey], [userKey, 'conversation.changed']]);
    expect(operations).toEqual(['persist', 'spark.balance.required', 'conversation.changed']);
    expect(failures[0]?.at(-1)).toBe('OUTSTANDING_DEBT');
  });
});
