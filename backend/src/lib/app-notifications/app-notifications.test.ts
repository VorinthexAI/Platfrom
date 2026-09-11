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
    expect(notificationListInputSchema.parse({})).toEqual({ limit: 25, mailbox: 'inbox' });
    expect(notificationListInputSchema.parse({ cursor: newId(), limit: 10, mailbox: 'sent' })).toMatchObject({ limit: 10, mailbox: 'sent' });
    expect(() => notificationListInputSchema.parse({ userKey: newId() })).toThrow('Unrecognized key');
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
    const result = await createAppNotificationService({ repository, embed, enqueue: async (key) => { enqueued = key; } }).notify({ title: 'Ready', message: 'Open the app.', userKeys: [target], notifyAll: false }, actor.value, 'request-1');
    expect(calls[0]).toEqual({ teamKey: actor.value.teamKey, scopeKey: actor.value.runtimeScopeKey, requested: [target] });
    expect(enqueued).toBe(result.key);
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
    expect(queries[1]?.query).toContain('FOR inbox IN @recipientInboxes');
    expect(queries[1]?.query).toContain('INTO userInboxThreads');
    expect(queries[1]?.query).toContain('INTO userInboxMessages');
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
    const service = createAppNotificationService({ repository, embed: async (text) => { order.push(`embed:${text}`); return Array(EMBEDDING_DIMENSIONS).fill(0.25); }, enqueue: async (key) => { order.push(`enqueue:${key}`); } });
    await service.notifyStorageRetentionWarning({ userKey: 'user', paymentPastDueAt: '2026-01-01T00:00:00.000Z', wipeDueAt: '2026-04-01T00:00:00.000Z', monthlyCostSparks: '180', now: '2026-02-03T00:00:00.000Z' });
    expect(order).toEqual(['embed:Your storage needs Sparks\n\nYour stored data costs 180 Sparks a month and will be deleted in 57 days unless Sparks are refilled.', 'persist', 'enqueue:warning-1']);
    expect(persisted).toMatchObject({ expectedPaymentPastDueAt: '2026-01-01T00:00:00.000Z', expectedWipeDueAt: '2026-04-01T00:00:00.000Z', warningDayStart: '2026-02-03T00:00:00.000Z', embedding: expect.any(Array) });

    order.length = 0;
    repository.createStorageRetentionWarning = async () => { order.push('persist'); return { key: 'history', recipients: 1, deliveries: 0, replayed: false }; };
    await service.notifyStorageRetentionWarning({ userKey: 'user', paymentPastDueAt: '2026-01-01T00:00:00.000Z', wipeDueAt: '2026-04-01T00:00:00.000Z', monthlyCostSparks: '180', now: '2026-02-04T00:00:00.000Z' });
    expect(order.at(-1)).toBe('persist');
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
    await expect(createAppNotificationService({ repository: ownRepository, embed }).notify({ title: 'Ready', message: 'Body', userKeys: [viewer.userKey], notifyAll: false }, viewer.value, 'request')).resolves.toMatchObject({ recipients: 1 });
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
    const service = createAppNotificationService({ repository, embed, enqueue: async (key) => { enqueued.push(key); } });
    await service.notify({ title: 'Ready', message: 'Body', userKeys: [actor.userKey], notifyAll: false }, actor.value, 'retry');
    replayed = false;
    deliveries = 0;
    await service.notify({ title: 'History only', message: 'Body', userKeys: [actor.userKey], notifyAll: false }, actor.value, 'history');
    expect(enqueued).toEqual(['notification-1']);
  });

  test('lists only through the authenticated member context', async () => {
    const actor = context();
    const calls: unknown[] = [];
    const service = createAppNotificationService({ inbox: { list: async (...args: unknown[]) => { calls.push(args); return { items: [], unreadCount: 0, nextCursor: null }; } } as any });
    await expect(service.list({ limit: 25, mailbox: 'sent' }, actor.value)).resolves.toMatchObject({ unreadCount: 0 });
    expect(calls).toEqual([[{ limit: 25, mailbox: 'sent' }, actor.value]]);
    await expect(service.list({}, { ...actor.value, principal: { kind: 'system' } })).rejects.toThrow('Active team membership');
  });

  test('sources every queued push from its managed Signal thread and message', async () => {
    let source = '';
    const repository = createAppNotificationRepository({ query: async (query: string) => {
      source = query;
      return { all: async () => [] };
    } } as never);

    await expect(repository.pendingDeliveries('notification-1')).resolves.toEqual([]);
    expect(source).toContain('DOCUMENT(userInboxThreads, delivery.signalThreadKey)');
    expect(source).toContain('DOCUMENT(userInboxMessages, delivery.signalMessageKey)');
    expect(source).toContain('title: thread.subject, message: signalMessage.body');
    expect(source).not.toContain('notification.title');
    expect(source).not.toContain('notification.message');
  });

  test('suppresses device deliveries for active users without removing their history', async () => {
    const activeUserKey = newId();
    const suppressed: string[][] = [];
    let reads = 0;
    const repository = {
      pendingDeliveries: async () => reads++ === 0 ? [{ key: 'delivery-1', userKey: activeUserKey, tokenCiphertext: 'unused', projectId: newId(), title: 'Ready', message: 'Body', notificationKey: 'notification-1' }] : [],
      suppressDeliveries: async (keys: string[]) => { suppressed.push(keys); },
    } as any;
    await expect(processAppNotificationJob({ kind: 'send', notificationKey: 'notification-1', check: 1 }, repository, async () => new Set([activeUserKey]))).resolves.toEqual({ processed: 0, suppressed: 1 });
    expect(suppressed).toEqual([['delivery-1']]);
  });

  test('suppresses every active device while delivering and mapping tickets for inactive users', async () => {
    process.env.EXPO_PUSH_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    const activeUserKey = newId();
    const inactiveUserKey = newId();
    const projectId = newId();
    const delivery = (key: string, userKey: string, token: string) => ({ key, userKey, tokenCiphertext: encryptPushToken(token), projectId, title: 'Ready', message: 'Body', notificationKey: 'notification-1', signalThreadKey: 'thread-1', signalMessageKey: 'message-1' });
    const initial = [delivery('active-1', activeUserKey, 'ExpoPushToken[active-1]'), delivery('active-2', activeUserKey, 'ExpoPushToken[active-2]'), delivery('inactive-1', inactiveUserKey, 'ExpoPushToken[inactive-1]'), delivery('inactive-2', inactiveUserKey, 'ExpoPushToken[inactive-2]')];
    let reads = 0;
    const suppressed: string[][] = [];
    const recorded: unknown[] = [];
    const sent: unknown[] = [];
    const scheduled: unknown[] = [];
    const repository = {
      pendingDeliveries: async () => reads++ === 0 ? initial : [],
      suppressDeliveries: async (keys: string[]) => { suppressed.push(keys); },
      recordTickets: async (results: unknown) => { recorded.push(results); },
    } as any;
    const result = await processAppNotificationJob({ kind: 'send', notificationKey: 'notification-1', check: 3 }, repository, async () => new Set([activeUserKey]), {
      sendPush: async (messages) => { sent.push(messages); return [{ status: 'ok', id: 'receipt-1' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }]; },
      schedule: async (...args) => { scheduled.push(args); },
    });
    expect(result).toEqual({ processed: 2, suppressed: 2 });
    expect(suppressed).toEqual([['active-1', 'active-2']]);
    expect(sent).toEqual([[
      { to: 'ExpoPushToken[inactive-1]', title: 'Ready', body: 'Body', data: { v: '2', target: 'signal-inbox', notificationKey: 'notification-1', signalThreadKey: 'thread-1', signalMessageKey: 'message-1' } },
      { to: 'ExpoPushToken[inactive-2]', title: 'Ready', body: 'Body', data: { v: '2', target: 'signal-inbox', notificationKey: 'notification-1', signalThreadKey: 'thread-1', signalMessageKey: 'message-1' } },
    ]]);
    expect(recorded).toEqual([[
      { key: 'inactive-1', status: 'receipt_pending', receiptId: 'receipt-1', deviceNotRegistered: false },
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
