import { describe, expect, test } from 'bun:test';
import { completeEmailConnectorReconciliation, emailClearTrashJobId, emailPollingJobId, emailRepairJobId, emailRepairJobOptions, emailSyncJobSchema, emailWatchRenewalJobId, processEmailSyncJob } from './sync-queue';
import { GmailApiError } from './gmail';

const operationKey = '11111111-1111-4111-8111-111111111111';

describe('email synchronization jobs', () => {
  test('strictly validates notification jobs without credentials', () => {
    const job = emailSyncJobSchema.parse({ schemaVersion: 1, kind: 'notification', emailAddress: 'person@example.com', historyId: '123', messageId: 'message', subscription: 'subscription' });
    expect(job).not.toHaveProperty('accessToken');
    expect(() => emailSyncJobSchema.parse({ ...job, refreshToken: 'secret' })).toThrow();
    const repair = emailSyncJobSchema.parse({ schemaVersion: 1, kind: 'connector-reconciliation', organizationKey: 'org-1', scopeKey: 'cmrnlzf640001qc7kazsr96k5', connectorKey: 'cmrnlzf650002qc7k4p5zem5w', reason: 'trash', operation: { kind: 'trash', threadKeys: ['cmrnlzf650002qc7k4p5zem5w'] }, operationKey, requestedAt: '2026-08-23T12:00:00.000Z' });
    expect(() => emailSyncJobSchema.parse({ ...repair, accessToken: 'secret' })).toThrow();
  });

  test('dispatches durable connector and watch reconciliation to canonical service operations', async () => {
    const calls: unknown[] = [];
    const service = { reconcileSends: async (...args: unknown[]) => { calls.push(['reconcile-sends', ...args]); return { recovered: 1, pending: 0, busy: false }; }, subscribe: async (...args: unknown[]) => { calls.push(['subscribe', ...args]); return {}; } };
    const target = { organizationKey: 'org-1', scopeKey: 'cmrnlzf640001qc7kazsr96k5', connectorKey: 'cmrnlzf650002qc7k4p5zem5w' };
    expect(await processEmailSyncJob({ schemaVersion: 1, kind: 'connector-reconciliation', ...target, reason: 'send', sendDraftKey: target.connectorKey, operationKey, requestedAt: '2026-08-23T12:00:00.000Z' }, { connectors: {} as never, service: service as never })).toEqual({ synchronized: 1 });
    expect(await processEmailSyncJob({ schemaVersion: 1, kind: 'watch-reconciliation', ...target, operationKey, requestedAt: '2026-08-23T12:00:00.000Z' }, { connectors: {} as never, service: service as never })).toEqual({ renewed: 1 });
    expect(calls).toEqual([
      ['reconcile-sends', { userKey: 'system', organizationKey: target.organizationKey, scopeKey: target.scopeKey }, target.connectorKey, target.connectorKey],
      ['subscribe', { userKey: 'system', organizationKey: target.organizationKey, scopeKey: target.scopeKey }, target.connectorKey, undefined, true],
    ]);
  });

  test('uses collision-free operation IDs, bounded watch dedupe, and retries beyond a 30-minute lease', async () => {
    const first = emailRepairJobId({ connectorKey: 'connector', reason: 'send', operationKey });
    const second = emailRepairJobId({ connectorKey: 'connector', reason: 'send', operationKey: '22222222-2222-4222-8222-222222222222' });
    expect(first).not.toBe(second);
    expect(emailClearTrashJobId({ connectorKey: 'connector', operationKey })).not.toBe(emailClearTrashJobId({ connectorKey: 'connector', operationKey: '22222222-2222-4222-8222-222222222222' }));
    expect(emailWatchRenewalJobId('2026-08-23')).toBe(emailWatchRenewalJobId('2026-08-23'));
    expect(emailWatchRenewalJobId('2026-08-23')).not.toBe(emailWatchRenewalJobId('2026-08-24'));
    expect(emailPollingJobId('2026-08-23T12:00')).not.toBe(emailPollingJobId('2026-08-23T12:05'));
    expect(emailRepairJobOptions.removeOnComplete).toBe(true);
    const attempts = Number(emailRepairJobOptions.attempts);
    const delay = Number((emailRepairJobOptions.backoff as { delay: number }).delay);
    expect(Array.from({ length: attempts - 1 }, (_, index) => delay * 2 ** index).reduce((total, value) => total + value, 0)).toBeGreaterThan(30 * 60_000);
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

  test('schedules stable connector-specific notification jobs and dispatches each through canonical sync', async () => {
    const queued: Array<{ data: any; options: any }> = [];
    const connectors = { listSyncTargetsByEmail: async () => [{ organizationKey: 'org-1', scopeKey: 'scope-1', connectorKey: 'connector-1' }, { organizationKey: 'org-1', scopeKey: 'scope-1', connectorKey: 'connector-2' }] };
    const queue = { add: async (_name: string, data: any, options: any) => { queued.push({ data, options }); return { id: options.jobId }; } };
    const notification = { schemaVersion: 1 as const, kind: 'notification' as const, emailAddress: 'person@example.com', historyId: '123', messageId: 'message', subscription: 'subscription' };
    expect(await processEmailSyncJob(notification, { connectors: connectors as never, service: {} as never, queue: queue as never })).toEqual({ synchronized: 2 });
    expect(queued.map(({ data }) => data.kind)).toEqual(['connector-sync', 'connector-sync']);
    expect(queued[0]!.options.jobId).not.toBe(queued[1]!.options.jobId);
    const calls: unknown[] = [];
    await processEmailSyncJob(queued[0]!.data, { service: { sync: async (...args: unknown[]) => { calls.push(args); return { synced: 1 }; } } as never });
    expect(calls).toEqual([[{ userKey: 'system', organizationKey: 'org-1', scopeKey: 'scope-1' }, 'connector-1']]);
  });

  test('schedules connector-specific watch renewals', async () => {
    const queued: any[] = [];
    const connectors = { listWatchRenewalTargets: async () => [{ organizationKey: 'broken', scopeKey: 'scope-1', connectorKey: 'connector-1' }, { organizationKey: 'healthy', scopeKey: 'scope-2', connectorKey: 'connector-2' }] };
    const queue = { add: async (_name: string, data: any) => { queued.push(data); return { id: 'job' }; } };
    expect(await processEmailSyncJob({ schemaVersion: 1, kind: 'renew-watches', day: '2026-08-12' }, { connectors: connectors as never, service: {} as never, queue: queue as never })).toEqual({ renewed: 2 });
    expect(queued.map(({ kind, connectorKey }) => ({ kind, connectorKey }))).toEqual([{ kind: 'connector-watch-renewal', connectorKey: 'connector-1' }, { kind: 'connector-watch-renewal', connectorKey: 'connector-2' }]);
  });

  test('does not replay healthy connector work when aggregate scheduling retries', async () => {
    const connectors = { listSyncTargetsByEmail: async () => [{ organizationKey: 'broken', scopeKey: 'scope-1', connectorKey: 'connector-1' }, { organizationKey: 'healthy', scopeKey: 'scope-2', connectorKey: 'connector-2' }] };
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

  test('fans polling out into stable Outlook and iCloud connector jobs', async () => {
    const queued: any[] = [];
    const connectors = { listPollingTargets: async () => [{ organizationKey: 'org-1', scopeKey: 'scope-1', connectorKey: 'outlook-1' }, { organizationKey: 'org-1', scopeKey: 'scope-1', connectorKey: 'icloud-1' }] };
    const queue = { add: async (_name: string, data: any) => { queued.push(data); return { id: 'job' }; } };
    expect(await processEmailSyncJob({ schemaVersion: 1, kind: 'poll-connectors', bucket: '2026-08-24T12:00' }, { connectors: connectors as never, service: {} as never, queue: queue as never })).toEqual({ synchronized: 2 });
    expect(queued.map(({ connectorKey }) => connectorKey)).toEqual(['outlook-1', 'icloud-1']);
  });
});
