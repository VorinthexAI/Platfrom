import { describe, expect, test } from 'bun:test';
import { conversationArchiveProjectionJobId, conversationArchiveProjectionJobSchema, enqueueConversationArchiveProjection, processConversationArchiveProjection, recoverConversationArchiveProjectionQueue } from './archive-projection-queue';
import { conversationArchiveKey, type ConversationArchiveProjectionRepository, type ConversationArchiveSnapshot } from './archive-projection';
import { conversationMessageSchema, conversationSchema } from './schemas';

const job = {
  schemaVersion: 1 as const,
  conversationKey: 'cm12345678901234567890123', teamKey: 'team-1', scopeKey: 'cs12345678901234567890123',
  userKey: 'cu12345678901234567890123', actorKey: 'ca12345678901234567890123', desiredRevision: 4,
};
const timestamp = '2026-09-12T10:11:12.345Z';
const snapshot: ConversationArchiveSnapshot = {
  state: { key: conversationArchiveKey('state', job.conversationKey), conversationKey: job.conversationKey, teamKey: job.teamKey, scopeKey: job.scopeKey, userKey: job.userKey, actorKey: job.actorKey, desiredRevision: job.desiredRevision, projectedRevision: 3, createdAt: timestamp, updatedAt: timestamp },
  conversation: conversationSchema.parse({ key: job.conversationKey, teamKey: job.teamKey, scopeKey: job.scopeKey, userKey: job.userKey, name: 'Plan', isFavorite: false, createdAt: timestamp, updatedAt: timestamp }),
  messages: [conversationMessageSchema.parse({ key: 'cx12345678901234567890123', conversationKey: job.conversationKey, teamKey: job.teamKey, scopeKey: job.scopeKey, userKey: job.userKey, turnKey: 'turn-1', requestHash: 'a'.repeat(64), type: 'TEXT', role: 'USER', status: 'COMPLETED', content: 'Make a plan.', attachments: [], retrievals: [], createdAt: timestamp, completedAt: timestamp })],
  existing: { folders: [], documents: [] },
};

describe('conversation Archive projection queue', () => {
  test('uses strict v1 jobs and deterministic cuid-shaped ids', () => {
    expect(() => conversationArchiveProjectionJobSchema.parse({ ...job, message: 'secret' })).toThrow();
    expect(conversationArchiveProjectionJobId(job.conversationKey, job.desiredRevision)).toMatch(/^c[a-f0-9]{24}$/);
    expect(conversationArchiveProjectionJobId(job.conversationKey, job.desiredRevision)).toBe(conversationArchiveProjectionJobId(job.conversationKey, job.desiredRevision));
  });

  test('replaces a completed stale job before retrying the same pending revision', async () => {
    let removed = false; let added = false;
    const queue = {
      getJob: async () => ({ getState: async () => 'completed', remove: async () => { removed = true; } }),
      add: async (_name: string, _data: unknown, options: { jobId?: string }) => { expect(removed).toBe(true); added = true; return { id: options.jobId }; },
    } as any;

    await expect(enqueueConversationArchiveProjection(job, queue)).resolves.toEqual({ jobId: conversationArchiveProjectionJobId(job.conversationKey, job.desiredRevision) });
    expect(added).toBe(true);
  });

  test('prepares outside the repository commit, commits the fenced revision, then publishes both changes', async () => {
    const order: string[] = [];
    let committedDocuments = 0;
    const repository: ConversationArchiveProjectionRepository = {
      readSnapshot: async () => ({ status: 'ready', snapshot }),
      commit: async (received, projection) => { order.push('commit'); expect(received).toBe(snapshot); committedDocuments = projection.documents.length; return { status: 'committed', projectedRevision: 4 }; },
      deleteMissingSource: async () => 'stale', listPending: async () => [],
    };
    const result = await processConversationArchiveProjection(job, {
      repository,
      ask: async () => { order.push('ask'); return 'A concise plan was requested.'; },
      embedTexts: async (texts) => { order.push('embed'); return texts.map(() => [1]); },
      publishConversationChanged: async () => { order.push('conversation.changed'); },
      publishContentChanged: async () => { order.push('content.changed'); },
      now: () => timestamp,
    });
    expect(result).toEqual({ status: 'committed', projectedRevision: 4 });
    expect(committedDocuments).toBe(2);
    expect(order.slice(0, 3)).toEqual(['ask', 'embed', 'commit']);
    expect(new Set(order.slice(3))).toEqual(new Set(['conversation.changed', 'content.changed']));
  });

  test('does no provider work for a stale revision and cleans a vanished source', async () => {
    let calls = 0;
    const stale = await processConversationArchiveProjection(job, {
      repository: { readSnapshot: async () => ({ status: 'stale' }), commit: async () => { throw new Error('unexpected'); }, deleteMissingSource: async () => 'stale', listPending: async () => [] },
      ask: async () => { calls += 1; return 'x'; }, embedTexts: async () => { calls += 1; return []; },
    });
    expect(stale).toEqual({ status: 'stale' }); expect(calls).toBe(0);

    const events: string[] = [];
    const missing = await processConversationArchiveProjection(job, {
      repository: { readSnapshot: async () => ({ status: 'missing-source', state: snapshot.state }), commit: async () => { throw new Error('unexpected'); }, deleteMissingSource: async () => 'deleted', listPending: async () => [] },
      publishConversationChanged: async () => { events.push('conversation'); }, publishContentChanged: async () => { events.push('content'); },
    });
    expect(missing).toEqual({ status: 'deleted' }); expect(new Set(events)).toEqual(new Set(['conversation', 'content']));
  });

  test('recovery enqueues only pending revisions not already active', async () => {
    const added: Array<{ data: unknown; id: string | undefined }> = [];
    const id = conversationArchiveProjectionJobId(job.conversationKey, job.desiredRevision);
    const queue = {
      getJobs: async () => [{ data: job }],
      getJob: async () => null,
      add: async (_name: string, data: unknown, options: { jobId?: string }) => { added.push({ data, id: options.jobId }); return { id: options.jobId }; },
    } as any;
    const state2 = { ...snapshot.state, key: conversationArchiveKey('state', 'other'), conversationKey: 'co12345678901234567890123' };
    const repository = { listPending: async () => [snapshot.state, state2] } as ConversationArchiveProjectionRepository;
    expect(await recoverConversationArchiveProjectionQueue({ repository, queue })).toEqual({ enqueued: 1 });
    expect(added).toHaveLength(1);
    expect(added[0]!.id).not.toBe(id);
    expect(added[0]!.data).toMatchObject({ conversationKey: state2.conversationKey, desiredRevision: state2.desiredRevision });
  });
});
