import { describe, expect, test } from 'bun:test';
import { completeEmailConnectorReconciliation, emailClearTrashJobId, emailInitialSyncJobId, emailRepairJobId, emailRepairJobOptions, emailSyncJobSchema, emailWatchJobOptions, emailWatchRenewalJobId, enqueueEmailInitialSync, enqueueEmailSyncContinuation, initialSyncJobSchema, processEmailSyncJob, recoverEmailSyncQueue } from './sync-queue';
import { GmailApiError } from './gmail';

const operationKey = '11111111-1111-4111-8111-111111111111';

describe('email synchronization jobs', () => {
  test('strictly validates notification jobs without credentials', () => {
    const job = emailSyncJobSchema.parse({ schemaVersion: 1, kind: 'notification', emailAddress: 'person@example.com', historyId: '123', messageId: 'message', subscription: 'subscription' });
    expect(job).not.toHaveProperty('accessToken');
    expect(() => emailSyncJobSchema.parse({ ...job, refreshToken: 'secret' })).toThrow();
    const repair = emailSyncJobSchema.parse({ schemaVersion: 1, kind: 'connector-reconciliation', organizationKey: 'org-1', scopeKey: 'cmrnlzf640001qc7kazsr96k5', connectorKey: 'cmrnlzf650002qc7k4p5zem5w', reason: 'trash', operation: { kind: 'trash', threadKeys: ['cmrnlzf650002qc7k4p5zem5w'] }, operationKey, requestedAt: '2026-08-23T12:00:00.000Z' });
    expect(() => emailSyncJobSchema.parse({ ...repair, accessToken: 'secret' })).toThrow();
    const initial = initialSyncJobSchema.parse({ schemaVersion: 1, kind: 'initial-sync', organizationKey: 'org-1', scopeKey: 'cmrnlzf640001qc7kazsr96k5', connectorKey: 'cmrnlzf650002qc7k4p5zem5w', operationKey, requestedAt: '2026-08-23T12:00:00.000Z' });
    expect(() => initialSyncJobSchema.parse({ ...initial, credentials: { accessToken: 'secret' } })).toThrow();
  });

  test('dispatches durable connector and watch reconciliation to canonical service operations', async () => {
    const calls: unknown[] = [];
    const service = { reconcileSends: async (...args: unknown[]) => { calls.push(['reconcile-sends', ...args]); return { recovered: 1, pending: 0, busy: false }; }, registerWatch: async (...args: unknown[]) => { calls.push(['register-watch', ...args]); return {}; } };
    const target = { organizationKey: 'org-1', scopeKey: 'cmrnlzf640001qc7kazsr96k5', connectorKey: 'cmrnlzf650002qc7k4p5zem5w' };
    expect(await processEmailSyncJob({ schemaVersion: 1, kind: 'connector-reconciliation', ...target, reason: 'send', sendDraftKey: target.connectorKey, operationKey, requestedAt: '2026-08-23T12:00:00.000Z' }, { connectors: {} as never, service: service as never })).toEqual({ synchronized: 1 });
    expect(await processEmailSyncJob({ schemaVersion: 1, kind: 'watch-reconciliation', ...target, operationKey, requestedAt: '2026-08-23T12:00:00.000Z' }, { connectors: {} as never, service: service as never })).toEqual({ renewed: 1 });
    expect(calls).toEqual([
      ['reconcile-sends', { userKey: 'system', organizationKey: target.organizationKey, scopeKey: target.scopeKey }, target.connectorKey, target.connectorKey],
      ['register-watch', { userKey: 'system', organizationKey: target.organizationKey, scopeKey: target.scopeKey }, target.connectorKey, undefined, true],
    ]);
  });

  test('uses collision-free operation IDs, bounded watch dedupe, and retries beyond a 30-minute lease', async () => {
    const first = emailRepairJobId({ connectorKey: 'connector', reason: 'send', operationKey });
    const second = emailRepairJobId({ connectorKey: 'connector', reason: 'send', operationKey: '22222222-2222-4222-8222-222222222222' });
    expect(first).not.toBe(second);
    expect(emailClearTrashJobId({ connectorKey: 'connector', operationKey })).not.toBe(emailClearTrashJobId({ connectorKey: 'connector', operationKey: '22222222-2222-4222-8222-222222222222' }));
    expect(emailInitialSyncJobId({ connectorKey: 'connector', operationKey })).not.toBe(emailInitialSyncJobId({ connectorKey: 'connector', operationKey: '22222222-2222-4222-8222-222222222222' }));
    expect(emailWatchRenewalJobId('2026-08-23')).toBe(emailWatchRenewalJobId('2026-08-23'));
    expect(emailWatchRenewalJobId('2026-08-23')).not.toBe(emailWatchRenewalJobId('2026-08-24'));
    expect(emailRepairJobOptions.removeOnComplete).toBe(true);
    expect(emailWatchJobOptions.removeOnFail).toBe(true);
    const attempts = Number(emailRepairJobOptions.attempts);
    const delay = Number((emailRepairJobOptions.backoff as { delay: number }).delay);
    expect(Array.from({ length: attempts - 1 }, (_, index) => delay * 2 ** index).reduce((total, value) => total + value, 0)).toBeGreaterThan(30 * 60_000);
  });

  test('durably enqueues each OAuth lifecycle and routes only to the internal initial-sync service', async () => {
    const queued: Array<{ name: string; data: any; options: any }> = [];
    const queue = { add: async (name: string, data: any, options: any) => { queued.push({ name, data, options }); return { id: options.jobId }; } };
    const target = { organizationKey: 'org-1', scopeKey: 'cmrnlzf640001qc7kazsr96k5', connectorKey: 'cmrnlzf650002qc7k4p5zem5w' };
    const first = await enqueueEmailInitialSync({ ...target, operationKey }, queue as never);
    const second = await enqueueEmailInitialSync({ ...target, operationKey: '22222222-2222-4222-8222-222222222222' }, queue as never);
    expect(first.jobId).not.toBe(second.jobId);
    expect(queued.map(({ name }) => name)).toEqual(['initial-sync', 'initial-sync']);
    const calls: unknown[] = [];
    const service = { initialSync: async (...args: unknown[]) => { calls.push(args); return { synced: 1 }; }, sync: async () => { throw new Error('public sync must not be called'); }, ingestSubscriptionNotification: async () => { throw new Error('subscription ingestion must not be called'); } };
    expect(await processEmailSyncJob(queued[0]!.data, { service: service as never })).toEqual({ synchronized: 1 });
    expect(calls).toEqual([[{ userKey: 'system', organizationKey: target.organizationKey, scopeKey: target.scopeKey }, target.connectorKey]]);
    await expect(processEmailSyncJob(queued[0]!.data, { service: { initialSync: async () => ({ synced: 100, initialSyncCompleted: false }) } as never })).rejects.toThrow('remains incomplete');
  });

  test('removes waiting intents but leaves active jobs to converge on retry', async () => {
    let removed = 0;
    const queue = (state: string) => ({ add: async () => ({ id: 'job' }), getJob: async () => ({ getState: async () => state, remove: async () => { removed += 1; } }) });
    expect(await completeEmailConnectorReconciliation('job', queue('delayed') as never)).toBe(true);
    expect(await completeEmailConnectorReconciliation('job', queue('active') as never)).toBe(false);
    expect(removed).toBe(1);
  });

  test('fails connector repair jobs that report busy so BullMQ retries past the active lease', async () => {
    const target = { organizationKey: 'org-1', scopeKey: 'cmrnlzf640001qc7kazsr96k5', connectorKey: 'cmrnlzf650002qc7k4p5zem5w' };
    await expect(processEmailSyncJob({ schemaVersion: 1, kind: 'connector-reconciliation', ...target, reason: 'send', sendDraftKey: target.connectorKey, operationKey, requestedAt: '2026-08-23T12:00:00.000Z' }, { connectors: {} as never, service: { reconcileSends: async () => ({ recovered: 0, pending: 0, busy: true }) } as never })).rejects.toThrow('remains incomplete');
  });

  test('dispatches thread and clear-Trash continuations to canonical non-recursive operations', async () => {
    const calls: unknown[] = [];
    const target = { organizationKey: 'org-1', scopeKey: 'cmrnlzf640001qc7kazsr96k5', connectorKey: 'cmrnlzf650002qc7k4p5zem5w' };
    const service = {
      setReadState: async (...args: unknown[]) => { calls.push(['read', ...args]); return { succeeded: 1, failed: 0, repairPending: 0 }; },
      clearTrash: async (...args: unknown[]) => { calls.push(['clear', ...args]); return { providerMessagesDeleted: 3 }; },
    };
    expect(await processEmailSyncJob({ schemaVersion: 1, kind: 'connector-reconciliation', ...target, reason: 'read-state', operation: { kind: 'read-state', threadKeys: [target.connectorKey], isRead: true }, operationKey, requestedAt: '2026-08-23T12:00:00.000Z' }, { service: service as never })).toEqual({ synchronized: 1 });
    const messages = [{ id: 'provider-message', threadId: 'provider-thread' }];
    const trashSnapshotAt = '2026-08-23T11:59:00.000Z';
    expect(await processEmailSyncJob({ schemaVersion: 1, kind: 'clear-trash-continuation', ...target, operationKey, requestedAt: '2026-08-23T12:00:00.000Z', trashSnapshotAt, messages }, { service: service as never })).toEqual({ cleared: 3 });
    expect(calls).toEqual([
      ['read', { userKey: 'system', organizationKey: target.organizationKey, scopeKey: target.scopeKey }, { threadKeys: [target.connectorKey], isRead: true }, true],
      ['clear', { userKey: 'system', organizationKey: target.organizationKey, scopeKey: target.scopeKey }, { connectorKey: target.connectorKey }, true, messages, undefined, trashSnapshotAt],
    ]);
  });

  test('keeps clear-Trash jobs failed for non-retryable permission and configuration errors', async () => {
    const target = { organizationKey: 'org-1', scopeKey: 'cmrnlzf640001qc7kazsr96k5', connectorKey: 'cmrnlzf650002qc7k4p5zem5w' };
    const job = { schemaVersion: 1 as const, kind: 'clear-trash-continuation' as const, ...target, operationKey, requestedAt: '2026-08-23T12:00:00.000Z', trashSnapshotAt: '2026-08-23T11:59:00.000Z', messages: [] };
    await expect(processEmailSyncJob(job, { service: { clearTrash: async () => { throw new GmailApiError(403, ['forbidden']); } } as never })).rejects.toMatchObject({ status: 403 });
    await expect(processEmailSyncJob(job, { service: { clearTrash: async () => { throw new GmailApiError(400, ['invalidArgument']); } } as never })).rejects.toMatchObject({ status: 400 });
  });

  test('completes definitive thread failures but retries repair-pending outcomes', async () => {
    const target = { organizationKey: 'org-1', scopeKey: 'cmrnlzf640001qc7kazsr96k5', connectorKey: 'cmrnlzf650002qc7k4p5zem5w' };
    const job = { schemaVersion: 1 as const, kind: 'connector-reconciliation' as const, ...target, reason: 'trash' as const, operation: { kind: 'trash' as const, threadKeys: [target.connectorKey] }, operationKey, requestedAt: '2026-08-23T12:00:00.000Z' };
    await expect(processEmailSyncJob(job, { service: { trashThread: async () => ({ succeeded: 0, failed: 1, repairPending: 0 }) } as never })).resolves.toEqual({ synchronized: 0 });
    await expect(processEmailSyncJob(job, { service: { trashThread: async () => ({ succeeded: 0, failed: 0, repairPending: 1 }) } as never })).rejects.toThrow('remains incomplete');
  });

  test('retries a delayed thread repair when the canonical operation reports an active connector lease', async () => {
    const target = { organizationKey: 'org-1', scopeKey: 'cmrnlzf640001qc7kazsr96k5', connectorKey: 'cmrnlzf650002qc7k4p5zem5w' };
    const job = { schemaVersion: 1 as const, kind: 'connector-reconciliation' as const, ...target, reason: 'read-state' as const, operation: { kind: 'read-state' as const, threadKeys: [target.connectorKey], isRead: true }, operationKey, requestedAt: '2026-08-23T12:00:00.000Z' };
    let repairQueued: boolean | undefined;
    const service = { setReadState: async (_actor: unknown, _input: unknown, queued: boolean) => { repairQueued = queued; return { succeeded: 0, failed: 0, repairPending: 1, items: [{ threadKey: target.connectorKey, status: 'repairPending', error: 'Email synchronization or sending is already running' }] }; } };
    await expect(processEmailSyncJob(job, { service: service as never })).rejects.toThrow('remains incomplete');
    expect(repairQueued).toBe(true);
  });

  test('schedules strict connector-specific notification jobs and dispatches without calling sync', async () => {
    const queued: Array<{ data: any; options: any }> = [];
    const marked: unknown[] = [];
    const connectorOne = 'cmrnlzf650002qc7k4p5zem5w', connectorTwo = 'cmrnlzf650002qc7k4p5zem6x';
    const connectors = { listSyncTargetsByEmail: async () => [{ organizationKey: 'org-1', scopeKey: 'scope-1', connectorKey: connectorOne }, { organizationKey: 'org-1', scopeKey: 'scope-1', connectorKey: connectorTwo }], markNotificationPending: async (...args: unknown[]) => { marked.push(args); return true; } };
    const queue = { add: async (_name: string, data: any, options: any) => { queued.push({ data, options }); return { id: options.jobId }; } };
    const notification = { schemaVersion: 1 as const, kind: 'notification' as const, emailAddress: 'person@example.com', historyId: '123', messageId: 'message', subscription: 'subscription' };
    expect(await processEmailSyncJob(notification, { connectors: connectors as never, service: {} as never, queue: queue as never })).toEqual({ synchronized: 2 });
    expect(queued.map(({ data }) => data.kind)).toEqual(['connector-notification', 'connector-notification']);
    expect(queued.map(({ data }) => data.notificationHistoryId)).toEqual(['123', '123']);
    expect(marked).toEqual([[connectorOne, '123'], [connectorTwo, '123']]);
    expect(() => emailSyncJobSchema.parse({ ...queued[0]!.data, unknown: true })).toThrow();
    expect(queued[0]!.options.jobId).not.toBe(queued[1]!.options.jobId);
    const calls: unknown[] = [];
    await processEmailSyncJob(queued[0]!.data, { connectors: connectors as never, service: { sync: async () => { throw new Error('sync must not be called'); }, ingestSubscriptionNotification: async (...args: unknown[]) => { calls.push(args); return { synced: 1 }; } } as never });
    expect(calls).toEqual([[{ userKey: 'system', organizationKey: 'org-1', scopeKey: 'scope-1' }, connectorOne, '123']]);
    expect(marked).toEqual([[connectorOne, '123'], [connectorTwo, '123']]);
  });

  test('deduplicates duplicate PubSub delivery while distinct and out-of-order notifications converge through persisted cursor', async () => {
    const target = { organizationKey: 'org-1', scopeKey: 'scope-1', connectorKey: 'cmrnlzf650002qc7k4p5zem5w' };
    const connectors = { listSyncTargetsByEmail: async () => [target], markNotificationPending: async () => true, clearPendingNotification: async () => true };
    const queued = new Map<string, any>();
    const queue = { add: async (_name: string, data: any, options: any) => { queued.set(options.jobId, data); return { id: options.jobId }; } };
    const notification = (messageId: string, historyId: string) => ({ schemaVersion: 1 as const, kind: 'notification' as const, emailAddress: 'person@example.com', historyId, messageId, subscription: 'subscription' });
    await processEmailSyncJob(notification('newer', '30'), { connectors: connectors as never, service: {} as never, queue: queue as never });
    await processEmailSyncJob(notification('older', '20'), { connectors: connectors as never, service: {} as never, queue: queue as never });
    await processEmailSyncJob(notification('newer', '30'), { connectors: connectors as never, service: {} as never, queue: queue as never });
    expect(queued.size).toBe(2);

    let persistedCursor = 10;
    const observed: number[] = [];
    const service = { ingestSubscriptionNotification: async () => { observed.push(persistedCursor); persistedCursor = 30; return { synced: persistedCursor === 30 ? 1 : 0 }; } };
    for (const job of [...queued.values()].reverse()) await processEmailSyncJob(job, { connectors: connectors as never, service: service as never });
    expect(observed).toEqual([10, 30]);
    expect(persistedCursor).toBe(30);
  });

  test('retries subscription continuation jobs when the canonical service reports a busy connector', async () => {
    const target = { organizationKey: 'org-1', scopeKey: 'scope-1', connectorKey: 'cmrnlzf650002qc7k4p5zem5w', sourceKey: 'a'.repeat(64), requestedAt: '2026-08-23T12:00:00.000Z' };
    await expect(processEmailSyncJob({ schemaVersion: 1, kind: 'connector-sync', ...target }, { service: { continueSubscription: async () => ({ synced: 0, busy: true }) } as never })).rejects.toThrow('synchronization is busy');
  });

  test('durably schedules deterministic history continuation work through subscription ingestion', async () => {
    const queued: Array<{ data: any; options: any }> = [];
    const queue = { add: async (_name: string, data: any, options: any) => { queued.push({ data, options }); return { id: options.jobId }; } };
    const input = { organizationKey: 'org-1', scopeKey: 'cmrnlzf640001qc7kazsr96k5', connectorKey: 'cmrnlzf650002qc7k4p5zem5w', pendingHistoryId: 'history-2', pendingThreadIds: Array.from({ length: 5 }, (_, index) => `thread-${index}`) };
    const first = await enqueueEmailSyncContinuation(input, queue as never);
    const second = await enqueueEmailSyncContinuation(input, queue as never);
    expect(first.jobId).toBe(second.jobId);
    expect(queued[0]!.data).toMatchObject({ kind: 'connector-sync', organizationKey: input.organizationKey, scopeKey: input.scopeKey, connectorKey: input.connectorKey });
    const calls: unknown[] = [];
    await processEmailSyncJob(queued[0]!.data, { service: { continueSubscription: async (...args: unknown[]) => { calls.push(args); return { synced: 5 }; } } as never });
    expect(calls).toEqual([[{ userKey: 'system', organizationKey: input.organizationKey, scopeKey: input.scopeKey }, input.connectorKey]]);
  });

  test('schedules connector-specific watch renewals', async () => {
    const queued: any[] = [];
    const connectors = { listWatchRenewalTargets: async () => [{ organizationKey: 'broken', scopeKey: 'scope-1', connectorKey: 'connector-1' }, { organizationKey: 'healthy', scopeKey: 'scope-2', connectorKey: 'connector-2' }] };
    const queue = { add: async (_name: string, data: any) => { queued.push(data); return { id: 'job' }; } };
    expect(await processEmailSyncJob({ schemaVersion: 1, kind: 'renew-watches', day: '2026-08-12' }, { connectors: connectors as never, service: {} as never, queue: queue as never })).toEqual({ renewed: 2 });
    expect(queued.map(({ kind, connectorKey }) => ({ kind, connectorKey }))).toEqual([{ kind: 'connector-watch-renewal', connectorKey: 'connector-1' }, { kind: 'connector-watch-renewal', connectorKey: 'connector-2' }]);
  });

  test('keeps every watch renewal and reconciliation failure failed so BullMQ can retry it', async () => {
    const target = { organizationKey: 'org-1', scopeKey: 'cmrnlzf640001qc7kazsr96k5', connectorKey: 'cmrnlzf650002qc7k4p5zem5w' };
    const failure = new GmailApiError(403, ['forbidden']);
    const service = { registerWatch: async () => { throw failure; } };
    await expect(processEmailSyncJob({ schemaVersion: 1, kind: 'connector-watch-renewal', ...target, sourceKey: 'a'.repeat(64), requestedAt: '2026-08-23T12:00:00.000Z' }, { service: service as never })).rejects.toBe(failure);
    await expect(processEmailSyncJob({ schemaVersion: 1, kind: 'watch-reconciliation', ...target, operationKey, requestedAt: '2026-08-23T12:00:00.000Z' }, { service: service as never })).rejects.toBe(failure);
  });

  test('does not replay healthy connector work when aggregate scheduling retries', async () => {
    const connectors = { listSyncTargetsByEmail: async () => [{ organizationKey: 'broken', scopeKey: 'scope-1', connectorKey: 'connector-1' }, { organizationKey: 'healthy', scopeKey: 'scope-2', connectorKey: 'connector-2' }], markNotificationPending: async () => true };
    const uniqueJobs = new Map<string, any>();
    let firstAttempt = true;
    const queue = { add: async (_name: string, data: any, options: any) => { if (firstAttempt && data.connectorKey === 'connector-1') throw new Error('queue unavailable'); uniqueJobs.set(options.jobId, data); return { id: options.jobId }; } };
    const notification = { schemaVersion: 1 as const, kind: 'notification' as const, emailAddress: 'person@example.com', historyId: '123', messageId: 'message', subscription: 'subscription' };
    await expect(processEmailSyncJob(notification, { connectors: connectors as never, service: {} as never, queue: queue as never })).rejects.toThrow('1 account');
    firstAttempt = false;
    await processEmailSyncJob(notification, { connectors: connectors as never, service: {} as never, queue: queue as never });
    expect(uniqueJobs.size).toBe(2);
    expect([...uniqueJobs.values()].filter(({ connectorKey }) => connectorKey === 'connector-2')).toHaveLength(1);
  });

  test('recovers incomplete initial syncs and durable notification markers with deterministic jobs', async () => {
    const queued: Array<{ queue: string; name: string; data: any; options: any }> = [];
    const jobs = new Map<string, { state: string; removed: boolean }>();
    let removals = 0;
    const add = (queue: string) => async (name: string, data: any, options: any) => { queued.push({ queue, name, data, options }); jobs.set(options.jobId, { state: 'waiting', removed: false }); return { id: options.jobId }; };
    const getJob = async (jobId: string) => {
      const job = jobs.get(jobId);
      return job && !job.removed ? { getState: async () => job.state, remove: async () => { job.removed = true; removals += 1; } } : undefined;
    };
    const targets = [
      { organizationKey: 'org-1', scopeKey: 'cmrnlzf640001qc7kazsr96k5', connectorKey: 'cmrnlzf650002qc7k4p5zem5w', initialSyncCompleted: false },
      { organizationKey: 'org-1', scopeKey: 'cmrnlzf640001qc7kazsr96k5', connectorKey: 'cmrnlzf650002qc7k4p5zem6x', initialSyncCompleted: true, pendingNotificationHistoryId: '456' },
      { organizationKey: 'org-1', scopeKey: 'cmrnlzf640001qc7kazsr96k5', connectorKey: 'cmrnlzf650002qc7k4p5zem7y', initialSyncCompleted: true, pendingHistoryId: '789' },
    ];
    const dependencies = { connectors: { listSyncRecoveryTargets: async () => targets } as never, initialQueue: { add: add('initial'), getJob } as never, syncQueue: { add: add('sync'), getJob } as never };
    expect(await recoverEmailSyncQueue(dependencies)).toEqual({ enqueued: 3 });
    expect(queued.map(({ queue, name }) => [queue, name])).toEqual([['initial', 'initial-sync'], ['sync', 'connector-notification'], ['sync', 'connector-sync']]);
    const firstIds = queued.map(({ options }) => options.jobId);
    for (const jobId of firstIds) jobs.get(jobId)!.state = 'failed';
    queued.length = 0;
    await recoverEmailSyncQueue(dependencies);
    expect(queued.map(({ options }) => options.jobId)).toEqual(firstIds);
    expect(removals).toBe(3);
    expect(queued[0]!.options.removeOnComplete).toBe(true);
  });

  test('safely drains persisted jobs from the removed connector polling scheduler', async () => {
    const queued: any[] = [];
    const queue = { add: async (_name: string, data: any) => { queued.push(data); return { id: 'job' }; } };
    expect(await processEmailSyncJob({ schemaVersion: 1, kind: 'poll-connectors', bucket: '2026-08-24T12:00' }, { connectors: {} as never, service: {} as never, queue: queue as never })).toEqual({ synchronized: 0 });
    expect(queued).toEqual([]);
  });
});
