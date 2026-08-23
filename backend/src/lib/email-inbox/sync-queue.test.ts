import { describe, expect, test } from 'bun:test';
import { emailSyncJobSchema, processEmailSyncJob } from './sync-queue';

describe('email synchronization jobs', () => {
  test('strictly validates notification jobs without credentials', () => {
    const job = emailSyncJobSchema.parse({ schemaVersion: 1, kind: 'notification', emailAddress: 'person@example.com', historyId: '123', messageId: 'message', subscription: 'subscription' });
    expect(job).not.toHaveProperty('accessToken');
    expect(() => emailSyncJobSchema.parse({ ...job, refreshToken: 'secret' })).toThrow();
  });

  test('synchronizes every active scope resolved from persisted accounts', async () => {
    const actors: unknown[] = [];
    const selectors: string[] = [];
    const connectors = { listSyncTargetsByEmail: async () => [{ organizationKey: 'org-1', scopeKey: 'scope-1', connectorKey: 'connector-1' }, { organizationKey: 'org-1', scopeKey: 'scope-1', connectorKey: 'connector-2' }] };
    const service = { sync: async (actor: unknown, connectorKey: string) => { actors.push(actor); selectors.push(connectorKey); return {}; } };
    expect(await processEmailSyncJob({ schemaVersion: 1, kind: 'notification', emailAddress: 'person@example.com', historyId: '123', messageId: 'message', subscription: 'subscription' }, { connectors: connectors as never, service: service as never })).toEqual({ synchronized: 2 });
    expect(actors).toEqual([{ userKey: 'system', organizationKey: 'org-1', scopeKey: 'scope-1' }, { userKey: 'system', organizationKey: 'org-1', scopeKey: 'scope-1' }]);
    expect(selectors).toEqual(['connector-1', 'connector-2']);
  });

  test('attempts every watch renewal before retrying failed accounts', async () => {
    const attempted: string[] = [];
    const connectors = { listWatchRenewalTargets: async () => [{ organizationKey: 'broken', scopeKey: 'scope-1', connectorKey: 'connector-1' }, { organizationKey: 'healthy', scopeKey: 'scope-2', connectorKey: 'connector-2' }] };
    const service = { subscribe: async (actor: { organizationKey: string }, connectorKey: string) => { attempted.push(`${actor.organizationKey}:${connectorKey}`); if (actor.organizationKey === 'broken') throw new Error('revoked'); } };
    await expect(processEmailSyncJob({ schemaVersion: 1, kind: 'renew-watches', day: '2026-08-12' }, { connectors: connectors as never, service: service as never })).rejects.toThrow('1 account');
    expect(attempted).toEqual(['broken:connector-1', 'healthy:connector-2']);
  });

  test('attempts every matching scope before retrying notification failures', async () => {
    const attempted: string[] = [];
    const connectors = { listSyncTargetsByEmail: async () => [{ organizationKey: 'broken', scopeKey: 'scope-1', connectorKey: 'connector-1' }, { organizationKey: 'healthy', scopeKey: 'scope-2', connectorKey: 'connector-2' }] };
    const service = { sync: async (actor: { organizationKey: string }, connectorKey: string) => { attempted.push(`${actor.organizationKey}:${connectorKey}`); if (actor.organizationKey === 'broken') throw new Error('busy'); } };
    await expect(processEmailSyncJob({ schemaVersion: 1, kind: 'notification', emailAddress: 'person@example.com', historyId: '123', messageId: 'message', subscription: 'subscription' }, { connectors: connectors as never, service: service as never })).rejects.toThrow('1 account');
    expect(attempted).toEqual(['broken:connector-1', 'healthy:connector-2']);
  });
});
