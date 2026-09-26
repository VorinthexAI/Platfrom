import { afterEach, describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { appNotifyInputSchema, expoPushTokenSchema, notificationListInputSchema } from './contracts';
import { createAppNotificationService, storageRetentionWarningContent } from './service';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { decryptPushToken, encryptPushToken, pushTokenHash } from './token-crypto';
import { getExpoPushReceipts, sendExpoPush } from './expo-provider';
import { processAppNotificationJob } from './queue';
import { createAppNotificationRepository } from './repository';

const originalEncryptionKey = process.env.EXPO_PUSH_TOKEN_ENCRYPTION_KEY;
afterEach(() => { process.env.EXPO_PUSH_TOKEN_ENCRYPTION_KEY = originalEncryptionKey; });
const embed = async () => Array(EMBEDDING_DIMENSIONS).fill(0.25);

function context(role: 'owner' | 'moderator' | 'viewer' = 'owner') {
  const userKey = newId();
  const teamKey = newId();
  return {
    userKey,
    value: {
      teamKey,
      runtimeScopeKey: newId(),
      principal: {
        kind: 'member',
        user: { key: userKey },
        userTeam: { key: newId(), teamKey: teamKey, userId: userKey, status: 'active', teamRole: role },
      },
    } as any,
  };
}

describe('app notifications', () => {
  test('requires exactly one recipient mode and rejects untrusted fields', () => {
    expect(appNotifyInputSchema.parse({ title: 'Ready', message: 'Your work is ready.', notifyAll: true })).toMatchObject({ notifyAll: true });
    expect(() => appNotifyInputSchema.parse({ title: 'Ready', message: 'Body' })).toThrow();
    expect(() => appNotifyInputSchema.parse({ title: 'Ready', message: 'Body', notifyAll: true, userKeys: ['user'] })).toThrow();
    expect(() => appNotifyInputSchema.parse({ title: 'Ready', message: 'Body', notifyAll: true, teamKey: 'forged' })).toThrow('Unrecognized key');
  });

  test('keeps notification history pagination and read state strict', () => {
    expect(notificationListInputSchema.parse({ readState: 'unread' })).toEqual({ readState: 'unread', limit: 10 });
    expect(notificationListInputSchema.parse({ cursor: newId(), limit: 10, readState: 'read' })).toMatchObject({ limit: 10, readState: 'read' });
    expect(() => notificationListInputSchema.parse({ readState: 'urgent' })).toThrow();
    expect(() => notificationListInputSchema.parse({ userKey: newId(), readState: 'unread' })).toThrow('Unrecognized key');
  });

  test('accepts current and legacy Expo token forms but rejects arbitrary strings', () => {
    expect(expoPushTokenSchema.parse('ExpoPushToken[abc123]')).toBe('ExpoPushToken[abc123]');
    expect(expoPushTokenSchema.parse('ExponentPushToken[abc123]')).toBe('ExponentPushToken[abc123]');
    expect(() => expoPushTokenSchema.parse('not-a-token')).toThrow();
  });

  test('encrypts stored push tokens and uses a stable lookup hash', () => {
    process.env.EXPO_PUSH_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    const token = 'ExpoPushToken[secret]';
    const encrypted = encryptPushToken(token);
    expect(encrypted).not.toContain(token);
    expect(decryptPushToken(encrypted)).toBe(token);
    expect(pushTokenHash(token)).toHaveLength(64);
  });

  test('constrains explicit recipients to active users in the authenticated team', async () => {
    const actor = context();
    const target = newId();
    const calls: unknown[] = [];
    const repository = {
      resolveRecipientUserKeys: async (teamKey: string, scopeKey: string, requested?: string[]) => { calls.push({ teamKey, scopeKey, requested }); return [target]; },
      createNotification: async (...args: unknown[]) => { calls.push(args); return { key: newId(), recipients: 1, deliveries: 1, replayed: false }; },
    } as any;
    let enqueued = '';
    const published: unknown[] = [];
    const result = await createAppNotificationService({ repository, embed, enqueue: async (key) => { enqueued = key; }, publishChanged: async (...args) => { published.push(args); } }).notify({ title: 'Ready', message: 'Open the app.', userKeys: [target], notifyAll: false }, actor.value, 'request-1');
    expect(calls[0]).toEqual({ teamKey: actor.value.teamKey, scopeKey: actor.value.runtimeScopeKey, requested: [target] });
    expect(enqueued).toBe(result.key);
    expect(published).toEqual([[target, 'communication.changed']]);
  });

  test('persists one history projection per recipient independently of device deliveries', async () => {
    const queries: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    let call = 0;
    const repository = createAppNotificationRepository({ query: async (query: string, bindVars?: Record<string, unknown>) => {
      queries.push({ query, bindVars });
      call += 1;
      return call === 1 ? { next: async () => undefined } : { next: async () => ({ deliveries: 0 }) };
    } } as never);
    const actor = context();
    const recipientUserKeys = [newId(), newId()];
    const result = await repository.createNotification({ title: 'Ready', message: 'Open the app.', userKeys: recipientUserKeys, notifyAll: false }, { actorUserKey: actor.userKey, teamKey: actor.value.teamKey, scopeKey: actor.value.runtimeScopeKey, idempotencyKey: 'request-1' }, recipientUserKeys, await embed());
    expect(result).toMatchObject({ recipients: 2, deliveries: 0, replayed: false });
    expect(queries[1]?.query).toContain('INTO appNotificationRecipients');
    expect(queries[1]?.query).toContain('FOR recipient IN @recipients');
    expect(queries[1]?.query).toContain('INTO userNotifications');
    expect(queries[1]?.query).not.toContain('INTO userInboxMessages');
  });

  test('formats ceil elapsed days with friendly singular and plural grammar', () => {
    expect(storageRetentionWarningContent('180', '2026-04-03T12:00:00.000Z', '2026-02-05T12:00:00.001Z')?.message).toBe('Your stored data costs 180 Sparks a month and will be deleted in 57 days unless Sparks are refilled.');
    expect(storageRetentionWarningContent('1', '2026-04-03T12:00:00.000Z', '2026-04-02T12:00:00.000Z')?.message).toBe('Your stored data costs 1 Spark a month and will be deleted in 1 day unless Sparks are refilled.');
    expect(storageRetentionWarningContent('0', '2026-04-03T12:00:00.000Z', '2026-04-02T12:00:00.000Z')).toBeNull();
    expect(storageRetentionWarningContent('0.5', '2026-04-03T12:00:00.000Z', '2026-04-03T12:00:00.000Z')).toBeNull();
  });

  test('embeds title and message, persists before enqueueing push, and skips pushless history', async () => {
    const order: string[] = [];
    let persisted: any;
    const repository = { async createStorageRetentionWarning(input: unknown) { order.push('persist'); persisted = input; return { key: 'warning-1', recipients: 1, deliveries: 2, replayed: false }; } } as any;
    const service = createAppNotificationService({ repository, embed: async (text) => { order.push(`embed:${text}`); return Array(EMBEDDING_DIMENSIONS).fill(0.25); }, enqueue: async (key) => { order.push(`enqueue:${key}`); }, publishChanged: async (userKey, event) => { order.push(`publish:${userKey}:${event}`); } });
    await service.notifyStorageRetentionWarning({ userKey: 'user', paymentPastDueAt: '2026-01-01T00:00:00.000Z', wipeDueAt: '2026-04-01T00:00:00.000Z', monthlyCostSparks: '180', now: '2026-02-03T00:00:00.000Z' });
    expect(order).toEqual(['embed:Your storage needs Sparks\n\nYour stored data costs 180 Sparks a month and will be deleted in 57 days unless Sparks are refilled.', 'persist', 'publish:user:communication.changed', 'enqueue:warning-1']);
    expect(persisted).toMatchObject({ expectedPaymentPastDueAt: '2026-01-01T00:00:00.000Z', expectedWipeDueAt: '2026-04-01T00:00:00.000Z', warningDayStart: '2026-02-03T00:00:00.000Z', embedding: expect.any(Array) });

    order.length = 0;
    repository.createStorageRetentionWarning = async () => { order.push('persist'); return { key: 'history', recipients: 1, deliveries: 0, replayed: false }; };
    await service.notifyStorageRetentionWarning({ userKey: 'user', paymentPastDueAt: '2026-01-01T00:00:00.000Z', wipeDueAt: '2026-04-01T00:00:00.000Z', monthlyCostSparks: '180', now: '2026-02-04T00:00:00.000Z' });
    expect(order.slice(-2)).toEqual(['persist', 'publish:user:communication.changed']);
  });

  test('notifies the inbox owner of inbound Signal mail without a member actor', async () => {
    const order: string[] = [];
    const created: unknown[] = [];
    const userKey = newId();
    const teamKey = newId();
    const scopeKey = newId();
    const repository = {
      createNotification: async (...args: unknown[]) => { created.push(args); order.push('persist'); return { key: 'inbound-1', recipients: 1, deliveries: 1, replayed: false }; },
    } as any;
    const service = createAppNotificationService({ repository, embed: async (text) => { order.push(`embed:${text}`); return Array(EMBEDDING_DIMENSIONS).fill(0.25); }, enqueue: async (key) => { order.push(`enqueue:${key}`); }, publishChanged: async (key, event) => { order.push(`publish:${key}:${event}`); } });
    await service.notifyInboundEmail({ userKey, teamKey, scopeKey, title: 'Invoice', message: 'billing@example.com: Receipt attached', idempotencyKey: 'inbox.inbound:connector:message', connectorKey: 'connector-1', threadKey: 'thread-1', messageKey: 'message-1' });
    expect(order).toEqual(['embed:Invoice\n\nbilling@example.com: Receipt attached', 'persist', `publish:${userKey}:communication.changed`, 'enqueue:inbound-1']);
    expect(created[0]).toEqual([{ title: 'Invoice', message: 'billing@example.com: Receipt attached', userKeys: [userKey], notifyAll: false }, { actorUserKey: userKey, teamKey, scopeKey, idempotencyKey: 'inbox.inbound:connector:message', destination: { kind: 'email-thread', connectorKey: 'connector-1', threadKey: 'thread-1', messageKey: 'message-1' } }, [userKey], expect.any(Array)]);
  });

  test('atomically fences one warning per UTC day and lifecycle while persisting embedding metadata and delivery rows', async () => {
    const queries: Array<{ query: string; bind?: Record<string, unknown> }> = [];
    const repository = createAppNotificationRepository({ query: async (query: string, bind?: Record<string, unknown>) => { queries.push({ query, bind }); return { next: async () => ({ key: 'warning', deliveries: 1 }) }; } } as never);
    const result = await repository.createStorageRetentionWarning({ userKey: 'user', expectedPaymentPastDueAt: '2026-01-01T00:00:00.000Z', expectedWipeDueAt: '2026-04-01T00:00:00.000Z', title: 'Title', message: 'Message', embedding: Array(EMBEDDING_DIMENSIONS).fill(0.5), now: '2026-02-03T00:00:00.000Z', warningDayStart: '2026-02-03T00:00:00.000Z' });
    expect(result).toMatchObject({ recipients: 1, deliveries: 1 });
    const source = queries[0]!.query;
    expect(source).toContain('state.warningSentAt < @warningDayStart');
    expect(source).toContain('state.paymentPastDueAt == @expectedPaymentPastDueAt && state.wipeDueAt == @expectedWipeDueAt');
    expect(source).toContain('state.wipeDueAt > @now');
    expect(source).toContain('user.microSparkBalance) < state.minimumBalanceMicroSparks');
    expect(source.indexOf('UPDATE state WITH')).toBeLessThan(source.indexOf('INTO appNotifications'));
    expect(source).toContain('INTO appNotificationRecipients');
    expect(source).toContain('INTO pushDeliveries');
    expect(queries[0]!.bind).toMatchObject({ embeddingProvider: 'openrouter', embeddingDimensions: EMBEDDING_DIMENSIONS });
  });

  test('requires moderator authority for notifyAll and rejects unknown explicit users', async () => {
    const viewer = context('viewer');
    const service = createAppNotificationService({ repository: { resolveRecipientUserKeys: async () => [] } as any, embed, enqueue: async () => {} });
    await expect(service.notify({ title: 'Notice', message: 'Body', notifyAll: true }, viewer.value, 'request')).rejects.toThrow('Moderator');

    const owner = context('owner');
    await expect(service.notify({ title: 'Notice', message: 'Body', userKeys: [newId()], notifyAll: false }, owner.value, 'request')).rejects.toThrow('Every recipient');
  });

  test('allows a viewer to notify only themselves and rejects duplicate or substituted repository results', async () => {
    const viewer = context('viewer');
    let created = 0;
    const ownRepository = { resolveRecipientUserKeys: async () => [viewer.userKey], createNotification: async () => { created += 1; return { key: newId(), recipients: 1, deliveries: 0, replayed: false }; } } as any;
    await expect(createAppNotificationService({ repository: ownRepository, embed, publishChanged: async () => {} }).notify({ title: 'Ready', message: 'Body', userKeys: [viewer.userKey], notifyAll: false }, viewer.value, 'request')).resolves.toMatchObject({ recipients: 1 });
    expect(created).toBe(1);

    const owner = context('owner');
    const first = newId();
    const second = newId();
    const service = (resolved: string[]) => createAppNotificationService({ repository: { resolveRecipientUserKeys: async () => resolved, createNotification: async () => { throw new Error('must not persist'); } } as any, embed });
    await expect(service([first, first]).notify({ title: 'Ready', message: 'Body', userKeys: [first, second], notifyAll: false }, owner.value, 'request')).rejects.toThrow('Every recipient');
    await expect(service([first, newId()]).notify({ title: 'Ready', message: 'Body', userKeys: [first, second], notifyAll: false }, owner.value, 'request')).rejects.toThrow('Every recipient');
  });

  test('rejects inactive and cross-team member contexts', async () => {
    const actor = context();
    const repository = { resolveRecipientUserKeys: async () => [actor.userKey] } as any;
    const service = createAppNotificationService({ repository, embed });
    await expect(service.notify({ title: 'Ready', message: 'Body', userKeys: [actor.userKey], notifyAll: false }, { ...actor.value, principal: { ...actor.value.principal, userTeam: { ...actor.value.principal.userTeam, status: 'inactive' } } }, 'request')).rejects.toThrow('Active team membership');
    await expect(service.notify({ title: 'Ready', message: 'Body', userKeys: [actor.userKey], notifyAll: false }, { ...actor.value, principal: { ...actor.value.principal, userTeam: { ...actor.value.principal.userTeam, teamKey: newId() } } }, 'request')).rejects.toThrow('Active team membership');
  });

  test('re-enqueues persisted idempotent replays but skips notifications without device deliveries', async () => {
    const actor = context();
    const enqueued: string[] = [];
    let replayed = true;
    let deliveries = 2;
    const repository = {
      resolveRecipientUserKeys: async () => [actor.userKey],
      createNotification: async () => ({ key: 'notification-1', recipients: 1, deliveries, replayed }),
    } as any;
    const published: string[] = [];
    const service = createAppNotificationService({ repository, embed, enqueue: async (key) => { enqueued.push(key); }, publishChanged: async (key) => { published.push(key); } });
    await service.notify({ title: 'Ready', message: 'Body', userKeys: [actor.userKey], notifyAll: false }, actor.value, 'retry');
    replayed = false;
    deliveries = 0;
    await service.notify({ title: 'History only', message: 'Body', userKeys: [actor.userKey], notifyAll: false }, actor.value, 'history');
    expect(enqueued).toEqual(['notification-1']);
    expect(published).toEqual([actor.userKey]);
  });

  test('publishes every persisted recipient without push devices and preserves success when publication fails', async () => {
    const actor = context();
    const recipients = [newId(), newId()];
    const attempts: string[] = [];
    const repository = { resolveRecipientUserKeys: async () => recipients, createNotification: async () => ({ key: 'notification-1', recipients: 2, deliveries: 0, replayed: false }) } as any;
    await expect(createAppNotificationService({ repository, embed, publishChanged: async (key) => { attempts.push(key); throw new Error('SSE unavailable'); } }).notify({ title: 'Ready', message: 'Body', notifyAll: true }, actor.value, 'request')).resolves.toMatchObject({ deliveries: 0 });
    expect(attempts).toEqual(recipients);
  });

  test('sources every queued push from the recipient user notification', async () => {
    let source = '';
    const repository = createAppNotificationRepository({ query: async (query: string) => {
      source = query;
      return { all: async () => [] };
    } } as never);

    await expect(repository.pendingDeliveries('notification-1')).resolves.toEqual([]);
    expect(source).toContain('FOR item IN userNotifications FILTER item.sourceKey == delivery.notificationKey');
    expect(source).toContain('title: notification.title, message: notification.message');
    expect(source).not.toContain('userInboxThreads');
  });

  test('delivers device pushes even when the recipient is present in the app', async () => {
    process.env.EXPO_PUSH_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    const activeUserKey = newId();
    const sent: unknown[] = [];
    let reads = 0;
    const repository = {
      pendingDeliveries: async () => reads++ === 0 ? [{ key: 'delivery-1', userKey: activeUserKey, tokenCiphertext: encryptPushToken('ExpoPushToken[active-1]'), projectId: newId(), title: 'Ready', message: 'Body', notificationKey: 'notification-1' }] : [],
      recordTickets: async () => undefined,
    } as any;
    await expect(processAppNotificationJob({ kind: 'send', notificationKey: 'notification-1', check: 1 }, repository, async () => new Set([activeUserKey]), {
      sendPush: async (messages) => { sent.push(messages); return [{ status: 'ok', id: 'receipt-1' }]; },
      schedule: async () => undefined,
      deepLinkUrl: 'https://app.example.com/capability/signal',
    })).resolves.toEqual({ processed: 1 });
    expect(sent).toHaveLength(1);
  });

  test('delivers every queued device and maps tickets without suppressing in-app recipients', async () => {
    process.env.EXPO_PUSH_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    const activeUserKey = newId();
    const inactiveUserKey = newId();
    const projectId = newId();
    const delivery = (key: string, userKey: string, token: string) => ({ key, userKey, tokenCiphertext: encryptPushToken(token), projectId, title: 'Ready', message: 'Body', notificationKey: 'notification-1', signalThreadKey: 'thread-1', signalMessageKey: 'message-1' });
    const initial = [delivery('active-1', activeUserKey, 'ExpoPushToken[active-1]'), delivery('active-2', activeUserKey, 'ExpoPushToken[active-2]'), delivery('inactive-1', inactiveUserKey, 'ExpoPushToken[inactive-1]'), delivery('inactive-2', inactiveUserKey, 'ExpoPushToken[inactive-2]')];
    let reads = 0;
    const recorded: unknown[] = [];
    const sent: unknown[] = [];
    const scheduled: unknown[] = [];
    const repository = {
      pendingDeliveries: async () => reads++ === 0 ? initial : [],
      recordTickets: async (results: unknown) => { recorded.push(results); },
    } as any;
    const result = await processAppNotificationJob({ kind: 'send', notificationKey: 'notification-1', check: 3 }, repository, async () => new Set([activeUserKey]), {
      sendPush: async (messages) => { sent.push(messages); return messages.map((message, index) => index % 2 === 0 ? { status: 'ok' as const, id: `receipt-${index}` } : { status: 'error' as const, details: { error: 'DeviceNotRegistered' } }); },
      schedule: async (...args) => { scheduled.push(args); },
      deepLinkUrl: 'https://app.example.com/capability/signal',
    });
    expect(result).toEqual({ processed: 4 });
    expect(sent).toEqual([[
      { to: 'ExpoPushToken[active-1]', title: 'Ready', body: 'Body', data: { v: '4', url: 'https://app.example.com/capability/signal', notificationKey: 'notification-1' } },
      { to: 'ExpoPushToken[active-2]', title: 'Ready', body: 'Body', data: { v: '4', url: 'https://app.example.com/capability/signal', notificationKey: 'notification-1' } },
      { to: 'ExpoPushToken[inactive-1]', title: 'Ready', body: 'Body', data: { v: '4', url: 'https://app.example.com/capability/signal', notificationKey: 'notification-1' } },
      { to: 'ExpoPushToken[inactive-2]', title: 'Ready', body: 'Body', data: { v: '4', url: 'https://app.example.com/capability/signal', notificationKey: 'notification-1' } },
    ]]);
    expect(recorded).toEqual([[
      { key: 'active-1', status: 'receipt_pending', receiptId: 'receipt-0', deviceNotRegistered: false },
      { key: 'active-2', status: 'failed', error: 'DeviceNotRegistered', deviceNotRegistered: true },
      { key: 'inactive-1', status: 'receipt_pending', receiptId: 'receipt-2', deviceNotRegistered: false },
      { key: 'inactive-2', status: 'failed', error: 'DeviceNotRegistered', deviceNotRegistered: true },
    ]]);
    expect((scheduled[0] as unknown[])?.[0]).toBe('receipts');
  });

  test('records available receipts, leaves missing receipts pending, and schedules another check', async () => {
    const pending = [{ key: 'one', receiptId: 'receipt-ok' }, { key: 'two', receiptId: 'receipt-failed' }, { key: 'three', receiptId: 'receipt-missing' }];
    let reads = 0;
    const recorded: unknown[] = [];
    const scheduled: unknown[] = [];
    const repository = {
      pendingReceipts: async () => reads++ === 0 ? pending : [pending[2]],
      recordReceipts: async (results: unknown) => { recorded.push(results); },
    } as any;
    const result = await processAppNotificationJob({ kind: 'receipts', notificationKey: 'notification-1', check: 1 }, repository, async () => new Set(), {
      getReceipts: async () => ({
        'receipt-ok': { status: 'ok' },
        'receipt-failed': { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
      }),
      schedule: async (...args) => { scheduled.push(args); },
    });
    expect(result).toEqual({ processed: 3 });
    expect(recorded).toEqual([[
      { key: 'one', status: 'accepted', deviceNotRegistered: false },
      { key: 'two', status: 'failed', error: 'DeviceNotRegistered', deviceNotRegistered: true },
    ]]);
    expect(scheduled[0]).toEqual(['receipts', { kind: 'receipts', notificationKey: 'notification-1', check: 2 }, expect.objectContaining({ delay: 15 * 60_000, jobId: 'receipts-notification-1-2' })]);
  });

  test('parses Expo tickets and receipts without treating tickets as delivery', async () => {
    const requests: string[] = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push(String(url));
      return new Response(JSON.stringify(String(url).endsWith('getReceipts')
        ? { data: { receipt: { status: 'error', details: { error: 'DeviceNotRegistered' } } } }
        : { data: [{ status: 'ok', id: 'receipt' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    expect(await sendExpoPush([{ to: 'ExpoPushToken[token]', title: 'Ready', body: 'Body', data: { notificationKey: 'key' } }], fetcher)).toEqual([{ status: 'ok', id: 'receipt' }]);
    expect((await getExpoPushReceipts(['receipt'], fetcher)).receipt?.details?.error).toBe('DeviceNotRegistered');
    expect(requests).toHaveLength(2);
  });
});
