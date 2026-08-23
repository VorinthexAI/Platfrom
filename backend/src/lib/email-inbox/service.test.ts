import { describe, expect, test } from 'bun:test';
import { createEmailService } from './service';
import { GmailApiError } from './gmail';
import { decodeEmailCursor } from './repository';
import { newId } from '@/lib/ids';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';

const userKey = 'cmrnlzf650002qc7k4p5zem5w';
const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const actor = { userKey, organizationKey: 'org-1', scopeKey };
const now = '2026-08-11T12:00:00.000Z';
const sendLeaseToken = '11111111-1111-4111-8111-111111111111';
const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
const connector = { key: userKey, organizationKey: 'org-1', scopeKey, provider: 'gmail', providerAccountId: 'google-1', email: 'me@example.com', encryptedCredentials: 'cipher', encryptionKeyId: 'v1', accessTokenFingerprint: 'a'.repeat(64), scopes: ['email'], createdByMembershipKey: scopeKey, status: 'active', createdAt: now, updatedAt: now } as const;
const thread = { key: userKey, scopeKey, accountKey: userKey, providerThreadId: 'thread-1', subject: 'Project', summary: 'Summary', intent: 'Review', priority: 'normal', state: 'needs_action', lastMessageAt: now, embedding, isFavorite: false, createdAt: now, updatedAt: now } as const;
const message = { key: scopeKey, scopeKey, accountKey: userKey, threadKey: userKey, providerMessageId: 'message-1', from: 'sender@example.com', replyTo: 'replies@example.com', to: ['me@example.com'], subject: 'Project', body: 'Can you review?', summary: 'Can you review?', direction: 'inbound', sentAt: now, hasAttachments: false, messageIdHeader: '<source@example.com>', replyDepth: 0, embedding, createdAt: now, updatedAt: now } as const;
const draft = { key: userKey, scopeKey, threadKey: userKey, messageKey: scopeKey, generatedContent: 'I will review it.', status: 'sending', sendLeaseToken, embedding, createdAt: now, updatedAt: now } as const;

function serviceFor(sendRaw: () => Promise<{ id: string; threadId: string }>, existing: { id: string; threadId: string } | null = null, role: 'owner' | 'admin' | 'moderator' | 'viewer' = 'owner', subject: string = thread.subject, messages: unknown[] = [message], claimedDraft: any = draft, attachmentResources: any[] = []) {
  const finishes: unknown[][] = [];
  const connectorSelections: string[] = [];
  const connectorLeaseCalls: string[] = [];
  const repository = {
    claimDraft: async () => claimedDraft,
    getDraft: async () => claimedDraft,
    thread: async () => ({ thread: { ...thread, subject }, messages }),
    finishDraft: async (...input: unknown[]) => { finishes.push(input); return draft; },
    syncThread: async () => thread,
    attachmentResources: async () => attachmentResources,
    renewDraftLease: async () => true,
  };
  const connectors = {
    getExact: async (_organizationKey: string, _scopeKey: string, key: string) => { connectorSelections.push(key); return connector; },
    credentials: () => ({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: '2027-08-11T12:00:00.000Z' }),
    claimSend: async () => { connectorLeaseCalls.push('claim'); return true; },
    renewSend: async () => { connectorLeaseCalls.push('renew'); return true; },
    releaseSend: async () => { connectorLeaseCalls.push('release'); },
  };
  const gmail = { sendRaw, findMessageByRfc822Id: async () => existing, profile: async () => ({}), listThreads: async () => ({}), history: async () => ({}), thread: async () => ({}), modifyThread: async () => ({}), revoke: async () => undefined };
  const storage = { download: async () => ({ bytes: new TextEncoder().encode('attachment bytes') }) };
  return { finishes, connectorSelections, connectorLeaseCalls, service: createEmailService({ repository: repository as never, connectors: connectors as never, authorize: async () => ({ membershipKey: scopeKey, role }), client: () => gmail as never, embed: async () => embedding, storage: storage as never }) };
}

describe('email reply sending', () => {
  test('sends an RFC reply once and finalizes the claimed draft', async () => {
    let raw = '';
    const { service, finishes, connectorSelections, connectorLeaseCalls } = serviceFor(async (value?: unknown) => { raw = String(value); return { id: 'sent-1', threadId: 'thread-1' }; });
    expect(await service.sendDraft(actor, userKey)).toMatchObject({ sent: true, providerMessageId: 'sent-1' });
    expect(raw).toContain('To: replies@example.com');
    expect(raw).toContain('In-Reply-To: <source@example.com>');
    expect(finishes[0]).toEqual([userKey, sendLeaseToken, true, 'sent-1']);
    expect(connectorSelections).toEqual([thread.accountKey]);
    expect(connectorLeaseCalls).toEqual(['claim', 'renew', 'release']);
  });

  test('emits reviewed attachment references as multipart MIME bytes', async () => {
    let raw = '';
    const attachmentDraft = { ...draft, attachments: [{ type: 'document' as const, key: scopeKey }] };
    const resources = [{ type: 'document', key: scopeKey, name: 'Launch notes.txt', mimeType: 'text/plain', storageKey: 'documents/launch-notes' }];
    const { service } = serviceFor(async (value?: unknown) => { raw = String(value); return { id: 'sent-attachment', threadId: 'thread-1' }; }, null, 'owner', thread.subject, [message], attachmentDraft, resources);
    await service.sendDraft(actor, userKey);
    expect(raw).toContain('Content-Type: multipart/mixed');
    expect(raw).toContain('filename="Launch notes.txt"');
    expect(raw).toContain(Buffer.from('attachment bytes').toString('base64'));
  });

  test('releases the draft when Gmail rejects the send', async () => {
    const { service, finishes } = serviceFor(async () => { throw new GmailApiError(400); });
    await expect(service.sendDraft(actor, userKey)).rejects.toThrow('Gmail API request failed');
    expect(finishes).toEqual([[userKey, sendLeaseToken, false]]);
  });

  test('keeps an ambiguously sent draft leased for recovery', async () => {
    const { service, finishes } = serviceFor(async () => { throw new Error('connection reset'); });
    await expect(service.sendDraft(actor, userKey)).rejects.toThrow('connection reset');
    expect(finishes).toEqual([]);
  });

  test('recovers a prior provider send by deterministic Message-ID', async () => {
    let sends = 0;
    const { service, finishes } = serviceFor(async () => { sends += 1; return { id: 'duplicate', threadId: 'thread-1' }; }, { id: 'sent-before-crash', threadId: 'thread-1' });
    expect(await service.sendDraft(actor, userKey)).toMatchObject({ providerMessageId: 'sent-before-crash' });
    expect(sends).toBe(0);
    expect(finishes[0]).toEqual([userKey, sendLeaseToken, true, 'sent-before-crash']);
  });

  test('prevents viewer sessions from sending shared mail', async () => {
    const { service } = serviceFor(async () => ({ id: 'sent', threadId: 'thread-1' }), null, 'viewer');
    await expect(service.sendDraft(actor, userKey)).rejects.toThrow('may not perform');
  });

  test('does not access Gmail when the connector send lease is unavailable', async () => {
    let providerAccess = false;
    const repository = { getDraft: async () => draft, thread: async () => ({ thread, messages: [message] }) };
    const connectors = {
      claimSend: async () => false,
      getExact: async () => { providerAccess = true; return connector; },
    };
    const service = createEmailService({ repository: repository as never, connectors: connectors as never, authorize: async () => ({ membershipKey: scopeKey, role: 'owner' }) });
    await expect(service.sendDraft(actor, draft.key)).rejects.toThrow('another send is in progress');
    expect(providerAccess).toBe(false);
  });

  test('removes line breaks from provider-controlled reply headers', async () => {
    let raw = '';
    const { service } = serviceFor(async (value?: unknown) => { raw = String(value); return { id: 'sent', threadId: 'thread-1' }; }, null, 'owner', 'Project\r\nBcc: attacker@example.com');
    await service.sendDraft(actor, userKey);
    expect(raw).toContain('Subject: Re: Project Bcc: attacker@example.com\r\n');
    expect(raw).not.toContain('\r\nBcc: attacker@example.com\r\n');
  });

  test('requires a new review when a message arrives after drafting', async () => {
    const newer = { ...message, key: 'cmsp3gwac0009r07kdlin5eoi', providerMessageId: 'message-2', from: 'other@example.com', replyTo: undefined, sentAt: '2026-08-11T13:00:00.000Z' };
    const { service, finishes } = serviceFor(async () => ({ id: 'sent', threadId: 'thread-1' }), null, 'owner', thread.subject, [message, newer]);
    await expect(service.sendDraft(actor, userKey)).rejects.toThrow('newer message arrived');
    expect(finishes).toEqual([[userKey, sendLeaseToken, false]]);
  });
});

describe('email thread read state', () => {
  function threadService(role: 'owner' | 'viewer', threadMessages: unknown[] = [message]) {
    const calls: string[] = [];
    const connectorSelections: string[] = [];
    let unread = true;
    const repository = {
      thread: async () => ({ thread: { ...thread, unread }, messages: threadMessages }),
      readThreadPage: async () => ({ thread: { ...thread, unread }, messages: threadMessages, nextCursor: null }),
      markThreadRead: async () => { calls.push('repository.markThreadRead'); unread = false; },
    };
    const connectors = {
      getExact: async (_organizationKey: string, _scopeKey: string, key: string) => { connectorSelections.push(key); return connector; },
      credentials: () => ({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: '2027-08-11T12:00:00.000Z' }),
    };
    const gmail = { modifyThread: async () => { calls.push('gmail.modifyThread'); } };
    return { calls, connectorSelections, service: createEmailService({ repository: repository as never, connectors: connectors as never, authorize: async () => ({ membershipKey: scopeKey, role }), client: () => gmail as never, publishInboxChanged: async () => { calls.push('inbox.changed'); } }) };
  }

  test('explicitly marks an owner thread read and returns the bounded tool projection', async () => {
    const longMessage = { ...message, body: 'x'.repeat(8_001) };
    const { calls, connectorSelections, service } = threadService('owner', [longMessage]);
    const result = await service.markRead(actor, userKey);
    expect(result).toMatchObject({ thread: { key: userKey, unread: false }, messages: [{ key: scopeKey, bodyTruncated: true }] });
    expect(result.messages[0]?.body).toHaveLength(8_000);
    expect(calls).toEqual(['gmail.modifyThread', 'repository.markThreadRead', 'inbox.changed']);
    expect(connectorSelections).toEqual([thread.accountKey]);
  });

  test('restores Gmail UNREAD best-effort when local mark-read persistence fails', async () => {
    const modifications: unknown[][] = [];
    const repository = {
      thread: async () => ({ thread: { ...thread, unread: true }, messages: [message] }),
      markThreadRead: async () => { throw new Error('database unavailable'); },
    };
    const connectors = { getExact: async () => connector, credentials: () => ({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: '2027-08-11T12:00:00.000Z' }) };
    const gmail = { modifyThread: async (...input: unknown[]) => { modifications.push(input); } };
    const service = createEmailService({ repository: repository as never, connectors: connectors as never, authorize: async () => ({ membershipKey: scopeKey, role: 'owner' }), client: () => gmail as never });
    await expect(service.markRead(actor, userKey)).rejects.toThrow('database unavailable');
    expect(modifications).toEqual([
      ['thread-1', [], ['UNREAD']],
      ['thread-1', ['UNREAD'], []],
    ]);
  });

  test('rejects explicit viewer mark-read tool mutations', async () => {
    const { calls, service } = threadService('viewer');
    await expect(service.markRead(actor, userKey)).rejects.toThrow('may not perform');
    expect(calls).toEqual([]);
  });

  test('preserves the HTTP default read behavior for viewers without mutating', async () => {
    const fullBody = 'x'.repeat(9_000);
    const { calls, service } = threadService('viewer', [{ ...message, body: fullBody }]);
    const result = await service.threadForHttp(actor, userKey, true);
    expect(result).toMatchObject({ thread: { unread: true }, messages: [{ key: scopeKey, body: fullBody }] });
    expect('bodyTruncated' in result.messages[0]!).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('email synchronization', () => {
  const gmailMessage = (id: string, threadId: string) => ({
    id, threadId, labelIds: threadId === 'thread-2' ? ['SENT'] : ['INBOX', 'CATEGORY_PRIMARY'], internalDate: String(Date.parse(now)),
    payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: threadId === 'thread-2' ? 'my-alias@example.com' : 'sender@example.com' }, { name: 'To', value: 'me@example.com' }, { name: 'Subject', value: 'Review' }], body: { data: Buffer.from('Please review this.').toString('base64url') } },
  });

  test('synchronizes only the latest Gmail page and reconciles it when complete', async () => {
    const synced: unknown[] = [];
    const reconciled: unknown[] = [];
    const embeddedTexts: string[] = [];
    const repository = {
      syncThread: async (input: unknown) => { synced.push(input); return thread; },
      reconcileThreadMessages: async () => undefined,
      reconcileInbox: async (...input: unknown[]) => { reconciled.push(input); },
      deleteProviderThread: async () => undefined,
    };
    let page = 0;
    const gmail = {
      profile: async () => ({ emailAddress: 'me@example.com', historyId: 'history-2' }),
      listThreads: async () => { page += 1; return { threads: [{ id: 'thread-1' }] }; },
      history: async () => ({}),
      threadMetadata: async (id: string) => ({ id, messages: [gmailMessage(`message-${id}`, id)] }),
      message: async (id: string) => gmailMessage(id, id.replace('message-', '')),
    };
    const connectors = { getExact: async () => connector, credentials: () => ({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: '2027-08-11T12:00:00.000Z' }), markError: async () => undefined, markActive: async () => undefined, claimSync: async () => true, renewSync: async () => true, releaseSync: async () => undefined, setSyncState: async () => true };
    const service = createEmailService({
      repository: repository as never, connectors: connectors as never, authorize: async () => ({ membershipKey: scopeKey, role: 'owner' }), client: () => gmail as never,
      classify: async () => ({ priority: 'normal', state: 'needs_action', category: 'primary', intent: 'Review message' }),
      embed: async ({ text }) => { embeddedTexts.push(text); return embedding; },
    });
    expect(await service.sync(actor, connector.key)).toMatchObject({ synced: 1 });
    expect(synced).toHaveLength(1);
    expect(embeddedTexts).toContain('Review\n\nPlease review this.\n\nPlease review this.');
    expect(reconciled).toEqual([[scopeKey, userKey, ['thread-1']]]);
  });

  test('caps work at 100 threads and runs sequential batches of at most ten', async () => {
    let active = 0, maximum = 0, embedded = 0, publications = 0;
    const saved: unknown[] = [];
    const ids = Array.from({ length: 105 }, (_, index) => `thread-${index}`);
    const gmail = {
      profile: async () => ({ historyId: 'history-2' }),
      listThreads: async () => ({ threads: ids.map((id) => ({ id })), nextPageToken: 'more' }),
      threadMetadata: async (id: string) => {
        active += 1; maximum = Math.max(maximum, active);
        await Bun.sleep(1);
        active -= 1;
        return { id, messages: [gmailMessage(`message-${id}`, id)] };
      },
      message: async (id: string) => gmailMessage(id, id.replace('message-', '')),
    };
    const repository = { syncThread: async (input: unknown) => { saved.push(input); return thread; }, reconcileInbox: async () => undefined, deleteProviderThread: async () => undefined };
    const connectors = { getExact: async () => connector, credentials: () => ({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: '2027-08-11T12:00:00.000Z' }), claimSync: async () => true, renewSync: async () => true, releaseSync: async () => undefined, setSyncState: async () => true };
    const service = createEmailService({ repository: repository as never, connectors: connectors as never, authorize: async () => ({ membershipKey: scopeKey, role: 'owner' }), client: () => gmail as never, classify: async () => ({ priority: 'normal', state: 'needs_action', category: 'primary', intent: 'Review' }), embed: async () => { embedded += 1; return embedding; }, publishInboxChanged: async () => { publications += 1; } });
    expect(await service.sync(actor, connector.key)).toMatchObject({ synced: 100 });
    expect(saved).toHaveLength(100);
    expect(maximum).toBe(10);
    expect(embedded).toBe(200);
    expect(publications).toBe(1);
  });

  test('waits for every thread in a failed batch before marking the connector errored and releasing its lease', async () => {
    let releaseSibling!: () => void;
    const siblingGate = new Promise<void>((resolve) => { releaseSibling = resolve; });
    const events: string[] = [];
    const ids = Array.from({ length: 10 }, (_, index) => `thread-${index}`);
    const gmail = {
      profile: async () => ({ historyId: 'history-2' }),
      listThreads: async () => ({ threads: ids.map((id) => ({ id })) }),
      threadMetadata: async (id: string) => {
        if (id === 'thread-0') { events.push('failed'); throw new Error('thread failed'); }
        if (id === 'thread-1') { await siblingGate; events.push('sibling settled'); }
        return { id, messages: [gmailMessage(`message-${id}`, id)] };
      },
      message: async (id: string) => gmailMessage(id, id.replace('message-', '')),
    };
    const repository = { syncThread: async () => thread, reconcileInbox: async () => undefined, deleteProviderThread: async () => undefined };
    const connectors = {
      getExact: async () => connector,
      credentials: () => ({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: '2027-08-11T12:00:00.000Z' }),
      claimSync: async () => true,
      renewSync: async () => true,
      setSyncState: async (_key: string, state: string) => { events.push(`state:${state}`); return true; },
      releaseSync: async () => { events.push('released'); },
    };
    const service = createEmailService({ repository: repository as never, connectors: connectors as never, authorize: async () => ({ membershipKey: scopeKey, role: 'owner' }), client: () => gmail as never, classify: async () => ({ priority: 'normal', state: 'needs_action', category: 'primary', intent: 'Review' }), embed: async () => embedding, publishInboxChanged: async () => undefined });
    const releaseTimer = setTimeout(releaseSibling, 20);
    try {
      await expect(service.sync(actor, connector.key)).rejects.toThrow('Email synchronization batch failed');
    } finally {
      clearTimeout(releaseTimer);
      releaseSibling();
    }
    expect(events.indexOf('failed')).toBeLessThan(events.indexOf('sibling settled'));
    expect(events.indexOf('sibling settled')).toBeLessThan(events.indexOf('state:error'));
    expect(events.indexOf('state:error')).toBeLessThan(events.indexOf('released'));
  });

  test('persists incremental history overflow and consumes it before advancing history', async () => {
    const ids = Array.from({ length: 105 }, (_, index) => `changed-${index}`);
    const account: any = { ...connector, historyId: 'history-1', lastSyncedAt: now };
    const processed: string[] = [];
    const idleStates: Array<Record<string, any>> = [];
    let historyCalls = 0;
    const gmail = {
      profile: async () => ({ historyId: 'history-2' }),
      listThreads: async () => { throw new Error('full sync should not be queried'); },
      history: async (historyId: string) => {
        historyCalls += 1;
        expect(historyId).toBe('history-1');
        return { historyId: 'history-2', history: [{ id: 'change-set', messagesAdded: ids.map((threadId, index) => ({ message: { id: `message-${index}`, threadId } })) }] };
      },
      threadMetadata: async (id: string) => { processed.push(id); return { id, messages: [gmailMessage(`message-${id}`, id)] }; },
      message: async (id: string) => gmailMessage(id, id.replace('message-', '')),
    };
    const repository = { syncThread: async () => thread, reconcileInbox: async () => undefined, deleteProviderThread: async () => undefined };
    const connectors = {
      getExact: async () => account,
      credentials: () => ({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: '2027-08-11T12:00:00.000Z' }),
      claimSync: async () => true,
      renewSync: async () => true,
      releaseSync: async () => undefined,
      setSyncState: async (_key: string, state: string, input: Record<string, any>) => {
        if (state === 'idle') {
          idleStates.push(input);
          account.historyId = input.historyId;
          account.syncPendingHistoryId = input.pendingHistoryId ?? undefined;
          account.syncPendingThreadIds = input.pendingThreadIds ?? undefined;
        }
        return true;
      },
    };
    const service = createEmailService({ repository: repository as never, connectors: connectors as never, authorize: async () => ({ membershipKey: scopeKey, role: 'owner' }), client: () => gmail as never, classify: async () => ({ priority: 'normal', state: 'needs_action', category: 'primary', intent: 'Review' }), embed: async () => embedding, publishInboxChanged: async () => undefined });
    expect(await service.sync(actor, connector.key)).toMatchObject({ synced: 100 });
    expect(idleStates[0]).toMatchObject({ historyId: 'history-1', pendingHistoryId: 'history-2', pendingThreadIds: ids.slice(0, 5).reverse() });
    expect(await service.sync(actor, connector.key)).toMatchObject({ synced: 5 });
    expect(idleStates[1]).toMatchObject({ historyId: 'history-2', pendingHistoryId: null, pendingThreadIds: null });
    expect(historyCalls).toBe(1);
    expect(processed).toHaveLength(105);
    expect(new Set(processed)).toEqual(new Set(ids));
  });

  test('resolves deeply nested replies regardless of provider order', async () => {
    const resource = (id: string, messageId: string, inReplyTo?: string, references?: string) => ({
      ...gmailMessage(id, 'thread-nested'),
      payload: { ...gmailMessage(id, 'thread-nested').payload, headers: [...gmailMessage(id, 'thread-nested').payload.headers, { name: 'Message-ID', value: messageId }, ...(inReplyTo ? [{ name: 'In-Reply-To', value: inReplyTo }] : []), ...(references ? [{ name: 'References', value: references }] : [])] },
    });
    const messages = [resource('grandchild', '<grandchild@example.com>', '<missing@example.com>', '<root@example.com> <child@example.com>'), resource('root', '<root@example.com>'), resource('child', '<child@example.com>', '<root@example.com>')];
    let saved: any;
    const repository = { syncThread: async (input: unknown) => { saved = input; return thread; }, reconcileInbox: async () => undefined, deleteProviderThread: async () => undefined };
    const gmail = { profile: async () => ({ historyId: 'history-2' }), listThreads: async () => ({ threads: [{ id: 'thread-nested' }] }), threadMetadata: async () => ({ id: 'thread-nested', messages }), message: async (id: string) => messages.find((message) => message.id === id)! };
    const connectors = { getExact: async () => connector, credentials: () => ({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: '2027-08-11T12:00:00.000Z' }), claimSync: async () => true, renewSync: async () => true, releaseSync: async () => undefined, setSyncState: async () => true };
    const service = createEmailService({ repository: repository as never, connectors: connectors as never, authorize: async () => ({ membershipKey: scopeKey, role: 'owner' }), client: () => gmail as never, classify: async () => ({ priority: 'normal', state: 'needs_action', category: 'primary', intent: 'Review' }), embed: async () => embedding, publishInboxChanged: async () => undefined });
    await service.sync(actor, connector.key);
    expect(saved.messages.map(({ providerMessageId, parentMessageId, replyDepth }: any) => ({ providerMessageId, parentMessageId, replyDepth }))).toEqual([
      { providerMessageId: 'grandchild', parentMessageId: '<child@example.com>', replyDepth: 2 },
      { providerMessageId: 'root', parentMessageId: undefined, replyDepth: 0 },
      { providerMessageId: 'child', parentMessageId: '<root@example.com>', replyDepth: 1 },
    ]);
  });

  test('deletes a thread removed during incremental history', async () => {
    const deleted: unknown[] = [];
    const repository = {
      syncThread: async () => thread,
      reconcileInbox: async () => undefined,
      deleteProviderThread: async (...input: unknown[]) => { deleted.push(input); },
    };
    const gmail = {
      profile: async () => ({ emailAddress: 'me@example.com', historyId: 'history-2' }),
      listThreads: async () => ({ threads: [] }),
      history: async () => ({ history: [{ id: 'h-1', messagesDeleted: [{ message: { id: 'gone-message', threadId: 'gone-thread' } }] }] }),
      threadMetadata: async () => { throw new GmailApiError(404); },
    };
    const connectors = { getExact: async () => ({ ...connector, historyId: 'history-1', lastSyncedAt: now }), credentials: () => ({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: '2027-08-11T12:00:00.000Z' }), markError: async () => undefined, markActive: async () => undefined, claimSync: async () => true, renewSync: async () => true, releaseSync: async () => undefined, setSyncState: async () => true };
    const service = createEmailService({ repository: repository as never, connectors: connectors as never, authorize: async () => ({ membershipKey: scopeKey, role: 'owner' }), client: () => gmail as never });
    expect(await service.sync(actor, connector.key)).toMatchObject({ synced: 0 });
    expect(deleted).toEqual([[scopeKey, userKey, 'gone-thread']]);
  });
});

describe('inbox watch subscription', () => {
  test('registers and persists a Gmail watch without exposing credentials', async () => {
    const previous = process.env.GMAIL_PUBSUB_TOPIC;
    process.env.GMAIL_PUBSUB_TOPIC = 'projects/example/topics/inbox';
    try {
      const writes: unknown[] = [];
      const connectors = { getExact: async () => connector, credentials: () => ({ accessToken: 'secret-access', refreshToken: 'secret-refresh', tokenType: 'Bearer', expiresAt: '2027-08-11T12:00:00.000Z' }), updateWatch: async (...args: unknown[]) => { writes.push(args); } };
      const gmail = { watch: async (topic: string) => { expect(topic).toBe('projects/example/topics/inbox'); return { historyId: '123', expiration: String(Date.parse('2026-08-24T12:00:00.000Z')) }; } };
      const service = createEmailService({ connectors: connectors as never, repository: {} as never, authorize: async () => ({ membershipKey: scopeKey, role: 'owner' }), client: () => gmail as never });
      const result = await service.subscribe(actor, connector.key);
      expect(result).toEqual({ watchExpiresAt: '2026-08-24T12:00:00.000Z' });
      expect(JSON.stringify(result)).not.toContain('secret');
      expect(writes).toEqual([[userKey, { historyId: '123', expiration: String(Date.parse('2026-08-24T12:00:00.000Z')) }]]);
    } finally {
      if (previous === undefined) delete process.env.GMAIL_PUBSUB_TOPIC; else process.env.GMAIL_PUBSUB_TOPIC = previous;
    }
  });
});

describe('new email drafting', () => {
  test('includes the edited selected tone in reply and new draft prompts', async () => {
    const prompts: string[] = [];
    const profile = { key: userKey, tone: 'Use my edited voice.', style: 'My calmer description.', structure: 'My calmer description.', vocabulary: 'Use my edited voice.', conventions: 'Use my edited voice.' };
    const profileCalls: unknown[][] = [];
    const repository = {
      thread: async () => ({ thread, messages: [message] }),
      writingProfile: async (...input: unknown[]) => { profileCalls.push(input); return profile; },
      resolveAttachments: async () => [],
      createDraft: async (input: any) => ({ key: userKey, createdAt: now, updatedAt: now, ...input }),
    };
    const service = createEmailService({ repository: repository as never, connectors: { listAuthorizedScope: async () => [connector] } as never, authorize: async () => ({ membershipKey: scopeKey, role: 'owner' }), embed: async () => embedding, ask: (async (_organizationKey: string, input: { systemPrompt: string }) => { prompts.push(input.systemPrompt); return { output: { text: 'Draft body.' } }; }) as never });
    await service.draft(actor, { threadKey: userKey, tone: 'warm' });
    await service.draftNew(actor, { to: ['person@example.com'], subject: 'Plan', tone: 'warm' });
    expect(profileCalls.map(([, , slug]) => slug)).toEqual(['warm', 'warm']);
    expect(prompts).toHaveLength(2);
    expect(prompts.every((prompt) => prompt.includes('Use my edited voice.') && prompt.includes('My calmer description.'))).toBe(true);
  });

  test('rejects a new draft when no provider account can own it', async () => {
    let created: any;
    const repository = {
      resolveAttachments: async () => [],
      createDraft: async (input: any) => { created = input; return { key: userKey, createdAt: now, updatedAt: now, ...input }; },
    };
    const service = createEmailService({ repository: repository as never, connectors: { listAuthorizedScope: async () => [] } as never, authorize: async () => ({ membershipKey: scopeKey, role: 'owner' }), embed: async () => embedding, ask: (async () => ({ output: { text: 'A provider-independent draft.' } })) as never });
    await expect(service.draftNew(actor, { to: ['person@example.com'], subject: 'Plan', tone: 'direct' })).rejects.toThrow('No connected Gmail account');
    expect(created).toBeUndefined();
  });

  test('validates attachment ownership and persists a generated Archive draft through the canonical service', async () => {
    const created: any[] = [];
    const repository = {
      resolveAttachments: async (_scopeKey: string, refs: unknown[]) => refs,
      createDraft: async (input: any) => { created.push(input); return { key: userKey, createdAt: now, updatedAt: now, ...input }; },
    };
    const connectors = { listAuthorizedScope: async () => [connector], credentials: () => ({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: '2027-08-11T12:00:00.000Z' }) };
    const service = createEmailService({ repository: repository as never, connectors: connectors as never, authorize: async () => ({ membershipKey: scopeKey, role: 'owner' }), client: () => ({}) as never, embed: async () => embedding, ask: (async () => ({ output: { text: 'Please review the plan.' } })) as never });
    const result = await service.draftNew(actor, { to: ['person@example.com'], subject: 'Plan', tone: 'direct', attachments: [{ type: 'document', key: userKey }] });
    expect(result).toMatchObject({ variant: 'new', subject: 'Plan', generatedContent: 'Please review the plan.', attachments: [{ type: 'document', key: userKey }] });
    expect(created[0]).toMatchObject({ scopeKey, accountKey: connector.key, variant: 'new', status: 'generated' });
  });

  test('rejects viewers before attachment resolution or generation', async () => {
    let called = false;
    const repository = { resolveAttachments: async () => { called = true; return []; } };
    const service = createEmailService({ repository: repository as never, connectors: {} as never, authorize: async () => ({ membershipKey: scopeKey, role: 'viewer' }) });
    await expect(service.draftNew(actor, { to: ['person@example.com'], subject: 'Plan', tone: 'direct' })).rejects.toThrow('may not perform');
    expect(called).toBe(false);
  });

  test('requires an exact connector when multiple inboxes are active', async () => {
    const other = { ...connector, key: 'cmsp3gwac0009r07kdlin5eoi', providerAccountId: 'google-2', email: 'other@example.com' };
    const repository = { resolveAttachments: async () => [], createDraft: async () => { throw new Error('must not persist'); } };
    const service = createEmailService({ repository: repository as never, connectors: { listAuthorizedScope: async () => [connector, other] } as never, authorize: async () => ({ membershipKey: scopeKey, role: 'owner' }) });
    await expect(service.draftNew(actor, { to: ['person@example.com'], subject: 'Plan', tone: 'direct' })).rejects.toThrow('connectorKey is required');
  });
});

describe('multi-inbox account authorization', () => {
  test('returns a sanitized account root without querying thread pages', async () => {
    let queried = false;
    const account = { ...connector, syncPendingHistoryId: 'pending', syncPendingThreadIds: ['thread'], syncLeaseToken: '11111111-1111-4111-8111-111111111111', syncLeaseExpiresAt: now };
    const unassigned = { key: userKey, scopeKey, variant: 'new', accountKey: scopeKey, to: ['person@example.com'], subject: 'Legacy', generatedContent: 'Body', status: 'generated', embedding, createdAt: now, updatedAt: now };
    const repository = { overview: async () => { queried = true; return {}; }, listDrafts: async () => [], listUnassignedDrafts: async () => [unassigned] };
    const service = createEmailService({ repository: repository as never, connectors: { listAuthorizedScope: async () => [account] } as never, authorize: async () => ({ membershipKey: scopeKey, role: 'viewer' }) });
    const result = await service.overview(actor, {});
    expect(result).toMatchObject({ selectedAccount: null, threads: [], drafts: [], unassignedDrafts: [{ key: unassigned.key, accountKey: scopeKey }], accounts: [{ key: connector.key, email: connector.email }] });
    expect(queried).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/encryptedCredentials|createdByMembershipKey|syncLease|syncPending/);
  });

  test('rejects cross-scope connector selectors before provider access', async () => {
    let providerAccess = false;
    const connectors = { getExact: async () => null, credentials: () => { providerAccess = true; throw new Error('must not decrypt'); } };
    const service = createEmailService({ repository: {} as never, connectors: connectors as never, authorize: async () => ({ membershipKey: scopeKey, role: 'owner' }) });
    await expect(service.sync(actor, connector.key)).rejects.toThrow('No connected Gmail account');
    expect(providerAccess).toBe(false);
  });

  test('does not resurrect a connector disconnected during credential refresh', async () => {
    let providerClientCreated = false;
    const connectors = {
      getExact: async () => connector,
      credentials: () => ({ accessToken: 'expired', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: '2026-01-01T00:00:00.000Z' }),
      updateCredentials: async () => null,
    };
    const service = createEmailService({
      repository: {} as never, connectors: connectors as never, authorize: async () => ({ membershipKey: scopeKey, role: 'owner' }),
      refreshCredentials: async () => ({ accessToken: 'fresh', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: '2027-01-01T00:00:00.000Z' }),
      client: () => { providerClientCreated = true; return {} as never; },
    });
    await expect(service.sync(actor, connector.key)).rejects.toThrow('changed while refreshing credentials');
    expect(providerClientCreated).toBe(false);
  });

  test('treats an exact cross-scope disconnect as absent', async () => {
    const service = createEmailService({
      repository: {} as never, connectors: { getExact: async () => null } as never,
      authorize: async () => ({ membershipKey: scopeKey, role: 'owner' }), publishInboxChanged: async () => undefined,
    });
    await expect(service.disconnect(actor, connector.key)).resolves.toEqual({ disconnected: true });
  });

  test('assigns a legacy provider-independent draft to the sole connector before sending', async () => {
    const assigned: unknown[][] = [];
    const legacyDraft = { key: userKey, scopeKey, variant: 'new' as const, accountKey: scopeKey, to: ['person@example.com'], subject: 'Plan', generatedContent: 'Body', status: 'generated' as const, embedding, createdAt: now, updatedAt: now };
    const claimed = { ...legacyDraft, accountKey: connector.key, status: 'sending' as const, sendLeaseToken };
    const repository = {
      getDraft: async () => legacyDraft,
      assignDraftConnector: async (...input: unknown[]) => { assigned.push(input); return { ...legacyDraft, accountKey: connector.key }; },
      claimDraft: async () => claimed,
      renewDraftLease: async () => true,
      finishDraft: async () => claimed,
      attachmentResources: async () => [],
      syncThread: async () => thread,
    };
    const connectors = {
      listAuthorizedScope: async () => [connector],
      getExact: async () => connector,
      credentials: () => ({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: '2027-08-11T12:00:00.000Z' }),
      claimSend: async () => true,
      renewSend: async () => true,
      releaseSend: async () => undefined,
    };
    const gmail = { findMessageByRfc822Id: async () => null, sendRaw: async () => ({ id: 'sent', threadId: 'sent-thread' }) };
    const service = createEmailService({ repository: repository as never, connectors: connectors as never, authorize: async () => ({ membershipKey: scopeKey, role: 'owner' }), client: () => gmail as never, embed: async () => embedding, publishInboxChanged: async () => undefined });
    await expect(service.sendDraft(actor, legacyDraft.key)).resolves.toMatchObject({ sent: true });
    expect(assigned).toEqual([[scopeKey, legacyDraft.key, connector.key]]);
  });

  test('explicitly assigns only through an authorized scope connector and publishes the change', async () => {
    const calls: unknown[] = [];
    const assigned = { key: userKey, scopeKey, variant: 'new' as const, accountKey: connector.key, to: ['person@example.com'], subject: 'Plan', generatedContent: 'Body', status: 'generated' as const, embedding, createdAt: now, updatedAt: now };
    const repository = { assignDraftConnector: async (...args: unknown[]) => { calls.push(args); return assigned; } };
    const service = createEmailService({
      repository: repository as never, connectors: { listAuthorizedScope: async () => [connector] } as never,
      authorize: async () => ({ membershipKey: scopeKey, role: 'owner' }), publishInboxChanged: async (key) => { calls.push(['publish', key]); },
    });
    await expect(service.assignDraft(actor, { draftKey: userKey, connectorKey: connector.key })).resolves.toMatchObject({ accountKey: connector.key });
    expect(calls).toEqual([[scopeKey, userKey, connector.key], ['publish', scopeKey]]);
  });

  test('disconnect destroys only the exact local binding without provider cleanup', async () => {
    const calls: string[] = [];
    const connectors = {
      getExact: async () => connector,
      revoke: async (key: string) => { calls.push(`revoke:${key}`); return true; },
    };
    let providerClientCreated = false;
    const service = createEmailService({ repository: {} as never, connectors: connectors as never, authorize: async () => ({ membershipKey: scopeKey, role: 'owner' }), client: () => { providerClientCreated = true; return {} as never; }, publishInboxChanged: async () => undefined });
    await expect(service.disconnect(actor, connector.key)).resolves.toEqual({ disconnected: true });
    expect(calls).toEqual([`revoke:${connector.key}`]);
    expect(providerClientCreated).toBe(false);
  });

  test('does not disconnect a connector while its send lease is active', async () => {
    const service = createEmailService({
      repository: {} as never,
      connectors: { getExact: async () => connector, revoke: async () => false } as never,
      authorize: async () => ({ membershipKey: scopeKey, role: 'owner' }),
    });
    await expect(service.disconnect(actor, connector.key)).rejects.toThrow('changed while disconnecting');
  });
});

describe('model-safe email thread reads', () => {
  test('returns at most 50 messages with bounded bodies and explicit truncation', async () => {
    const child = { ...message, key: 'cmsp3gwac0009r07kdlin5eoi', providerMessageId: 'message-2', messageIdHeader: '<child@example.com>', inReplyTo: '<source@example.com>', parentMessageId: '<source@example.com>', replyDepth: 1, body: 'x'.repeat(9_000) };
    let received: unknown[] = [];
    const repository = { readThreadPage: async (...input: unknown[]) => { received = input; return { thread, messages: [message, child], nextCursor: 'next' }; } };
    const service = createEmailService({ repository: repository as never, connectors: {} as never, authorize: async () => ({ membershipKey: scopeKey, role: 'viewer' }) });
    const output = await service.threadForTool(actor, userKey, 'cursor-1');
    expect(received).toEqual([scopeKey, userKey, 50, 'cursor-1']);
    expect(output.messages[1]?.body).toHaveLength(8_000);
    expect(output.messages[1]?.bodyTruncated).toBe(true);
    expect(output.messages[1]?.replyDepth).toBe(1);
    expect(output.messages[1]?.parentMessageId).toBe('<source@example.com>');
    expect(output.nextCursor).toBe('next');
    expect(output.truncated).toBe(true);
  });

  test('includes exact 8k bodies without per-message truncation', async () => {
    const exact = { ...message, body: 'x'.repeat(8_000) };
    const repository = { readThreadPage: async () => ({ thread, messages: [exact], nextCursor: null }) };
    const service = createEmailService({ repository: repository as never, connectors: {} as never, authorize: async () => ({ membershipKey: scopeKey, role: 'viewer' }) });
    const output = await service.threadForTool(actor, userKey);
    expect(output.messages[0]).toMatchObject({ body: exact.body, bodyTruncated: false });
    expect(output.nextCursor).toBeNull();
    expect(output.truncated).toBe(false);
  });

  test('includes exactly 64k and continues before the first message over budget', async () => {
    const messages = Array.from({ length: 9 }, (_, index) => ({ ...message, key: newId(), providerMessageId: `message-${index}`, body: index < 8 ? 'x'.repeat(8_000) : 'y' }));
    const repository = { readThreadPage: async (_scopeKey: string, _threadKey: string, _limit: number, cursor?: string) => {
      const afterKey = cursor ? decodeEmailCursor(cursor, userKey).key : undefined;
      const start = afterKey ? messages.findIndex(({ key }) => key === afterKey) + 1 : 0;
      return { thread, messages: messages.slice(start), nextCursor: null };
    } };
    const service = createEmailService({ repository: repository as never, connectors: {} as never, authorize: async () => ({ membershipKey: scopeKey, role: 'viewer' }) });
    const output = await service.threadForTool(actor, userKey);
    expect(output.messages).toHaveLength(8);
    expect(output.messages.reduce((total, item) => total + item.body.length, 0)).toBe(64_000);
    expect(decodeEmailCursor(output.nextCursor!, userKey).key).toBe(messages[7]!.key);
    expect(output.truncated).toBe(true);
    const continuation = await service.threadForTool(actor, userKey, output.nextCursor!);
    expect(continuation.messages.map(({ key }) => key)).toEqual([messages[8]!.key]);
    expect(continuation.nextCursor).toBeNull();
  });

  test('does not partially emit or skip a message when multiple bodies exceed 64k', async () => {
    const messages = Array.from({ length: 10 }, (_, index) => ({ ...message, key: newId(), providerMessageId: `message-${index}`, body: 'x'.repeat(7_500) }));
    const repository = { readThreadPage: async () => ({ thread, messages, nextCursor: 'repository-next' }) };
    const service = createEmailService({ repository: repository as never, connectors: {} as never, authorize: async () => ({ membershipKey: scopeKey, role: 'viewer' }) });
    const output = await service.threadForTool(actor, userKey);
    expect(output.messages).toHaveLength(8);
    expect(output.messages.every(({ body }) => body.length === 7_500)).toBe(true);
    expect(decodeEmailCursor(output.nextCursor!, userKey).key).toBe(messages[7]!.key);
  });

  test('returns all 50 bounded messages and the repository continuation cursor', async () => {
    const messages = Array.from({ length: 50 }, (_, index) => ({ ...message, key: newId(), providerMessageId: `message-${index}`, body: 'x' }));
    let received: unknown[] = [];
    const repository = { readThreadPage: async (...input: unknown[]) => { received = input; return { thread, messages, nextCursor: 'page-2' }; } };
    const service = createEmailService({ repository: repository as never, connectors: {} as never, authorize: async () => ({ membershipKey: scopeKey, role: 'viewer' }) });
    const output = await service.threadForTool(actor, userKey, 'page-1');
    expect(received).toEqual([scopeKey, userKey, 50, 'page-1']);
    expect(output.messages).toHaveLength(50);
    expect(output.nextCursor).toBe('page-2');
  });

  test('includes an oversized first message once and terminates empty pages', async () => {
    let page = 0;
    const oversized = { ...message, body: 'x'.repeat(65_000) };
    const repository = { readThreadPage: async () => ++page === 1
      ? { thread, messages: [oversized], nextCursor: null }
      : { thread, messages: [], nextCursor: 'repeated-cursor' } };
    const service = createEmailService({ repository: repository as never, connectors: {} as never, authorize: async () => ({ membershipKey: scopeKey, role: 'viewer' }) });
    const first = await service.threadForTool(actor, userKey);
    expect(first.messages).toHaveLength(1);
    expect(first.messages[0]).toMatchObject({ body: 'x'.repeat(8_000), bodyTruncated: true });
    expect(first.nextCursor).toBeNull();
    const empty = await service.threadForTool(actor, userKey, 'repeated-cursor');
    expect(empty.messages).toEqual([]);
    expect(empty.nextCursor).toBeNull();
  });

  test('authorizes viewer tool reads without mutating read state', async () => {
    const calls: string[] = [];
    const repository = {
      readThreadPage: async () => { calls.push('repository.readThreadPage'); return { thread: { ...thread, unread: true }, messages: [message], nextCursor: null }; },
      markThreadRead: async () => { calls.push('repository.markThreadRead'); },
    };
    const service = createEmailService({ repository: repository as never, connectors: {} as never, authorize: async () => ({ membershipKey: scopeKey, role: 'viewer' }) });
    expect(await service.threadForTool(actor, userKey)).toMatchObject({ thread: { unread: true } });
    expect(calls).toEqual(['repository.readThreadPage']);
  });
});
