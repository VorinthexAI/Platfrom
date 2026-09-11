import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { ConversationAttachmentArtifact, ConversationAttachmentArtifactRepository } from './attachment-artifacts';
import { conversationAttachmentPersistenceJobSchema, enqueueConversationAttachmentPersistence, processConversationAttachmentPersistence, recoverConversationAttachmentPersistenceQueue } from './attachment-persistence-queue';

const artifactKey = newId(), userMessageKey = newId(), userKey = newId(), conversationKey = newId(), now = new Date('2026-09-01T00:00:00.000Z');
const job = () => conversationAttachmentPersistenceJobSchema.parse({ schemaVersion: 1, artifactKey, userMessageKey });
const artifact = { key: artifactKey, ownerKey: newId(), teamKey: 'team', scopeKey: newId(), userKey, conversationKey, requestKey: 'turn', userMessageKey, kind: 'document', filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 3, documentContent: 'abc', stagedStorageKey: 'pending/notes', stagedSha256: 'a'.repeat(64), status: 'PROCESSING', attempts: 1, availableAt: now.toISOString(), leaseToken: 'lease', leaseExpiresAt: new Date(now.getTime() + 300_000).toISOString(), createdAt: now.toISOString(), expiresAt: '2026-10-01T00:00:00.000Z' } as ConversationAttachmentArtifact;

describe('conversation attachment durable outbox', () => {
  test('queues only durable identities with deterministic artifact job IDs', async () => {
    const calls: any[] = [];
    await expect(enqueueConversationAttachmentPersistence(job(), { getJob: async () => undefined, add: async (...args: any[]) => { calls.push(args); return { id: args[2].jobId }; } } as never)).resolves.toEqual({ jobId: artifactKey });
    expect(calls[0][1]).toEqual(job()); expect(calls[0][2]).toMatchObject({ jobId: artifactKey, attempts: 5 }); expect(JSON.stringify(calls[0][1])).not.toContain('documentContent');
  });

  test('removes a retained terminal BullMQ shell before durable recovery republishes the same artifact', async () => {
    let removed = false; let added = false;
    await enqueueConversationAttachmentPersistence(job(), { getJob: async () => ({ getState: async () => 'completed', remove: async () => { removed = true; } }), add: async () => { expect(removed).toBe(true); added = true; return { id: artifactKey }; } } as never);
    expect(added).toBe(true);
  });

  test('fences completion and publishes after independent message settlement', async () => {
    const order: string[] = [];
    const artifacts = { lease: async () => artifact, renew: async () => true, complete: async (_key: string, token: string) => { order.push(`complete:${token}`); return true; }, retry: async () => false, settleMessage: async () => { order.push('settle'); return { userKey, conversationKey, status: 'COMPLETED', references: [] }; } } as unknown as ConversationAttachmentArtifactRepository;
    await expect(processConversationAttachmentPersistence(job(), { artifacts, token: () => 'lease', now: () => now, persist: async () => { order.push('persist'); return { key: newId(), kind: 'document', filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 3 }; }, storage: { delete: async () => { order.push('cleanup'); } }, publishChanged: async () => { order.push('publish'); } })).resolves.toEqual({ references: 1 });
    expect(order).toEqual(['persist', 'complete:lease', 'cleanup', 'settle', 'publish']);
  });

  test('retains retry state and rejects a lost lease fence', async () => {
    let retried = false;
    const artifacts = { lease: async () => artifact, renew: async () => true, complete: async () => false, retry: async (_key: string, token: string) => { expect(token).toBe('lease'); retried = true; return true; }, settleMessage: async () => ({ userKey, conversationKey, status: 'PENDING', references: [] }) } as unknown as ConversationAttachmentArtifactRepository;
    await expect(processConversationAttachmentPersistence(job(), { artifacts, token: () => 'lease', now: () => now, persist: async () => ({ key: newId(), kind: 'document', filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 3 }), publishChanged: async () => undefined })).rejects.toThrow('fence');
    expect(retried).toBe(true);
  });

  test('recovers exclusively from durable artifact state and cleans expired rows', async () => {
    const recoverable = { ...artifact, status: 'CLAIMED', leaseToken: undefined, leaseExpiresAt: undefined } as ConversationAttachmentArtifact; const added: any[] = [];
    const artifacts = { listRecoverable: async () => [recoverable], listExpired: async () => [], removeExpired: async () => false } as unknown as ConversationAttachmentArtifactRepository;
    const queue = { getJobs: async () => [], getJob: async () => undefined, add: async (...args: any[]) => { added.push(args); return { id: artifactKey }; } };
    await expect(recoverConversationAttachmentPersistenceQueue({ artifacts, queue: queue as never, now: () => now })).resolves.toEqual({ enqueued: 1, expired: 0 });
    expect(added[0][1]).toEqual(job());
  });

  test('aborts and cannot complete after heartbeat fencing is lost', async () => {
    let completed = false; let retried = false; let observedSignal: AbortSignal | undefined;
    const artifacts = { lease: async () => artifact, renew: async () => false, complete: async () => { completed = true; return true; }, retry: async () => { retried = true; return false; } } as unknown as ConversationAttachmentArtifactRepository;
    await expect(processConversationAttachmentPersistence(job(), {
      artifacts, token: () => 'lease', now: () => now,
      scheduleLeaseRenewal: (renew) => { renew(); return () => {}; },
      persist: async (_record, _context, dependencies) => { observedSignal = dependencies?.signal; await Bun.sleep(0); return { key: newId(), kind: 'document', filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 3 }; },
    })).rejects.toThrow('fence');
    expect(observedSignal?.aborted).toBe(true); expect(completed).toBe(false); expect(retried).toBe(true);
  });
});
