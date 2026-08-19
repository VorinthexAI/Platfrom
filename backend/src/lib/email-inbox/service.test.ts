import { describe, expect, test } from 'bun:test';
import { createEmailService } from './service';
import { GmailApiError } from './gmail';
import { decodeEmailCursor } from './repository';
import { newId } from '@/lib/ids';

const userKey = 'cmrnlzf650002qc7k4p5zem5w';
const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const actor = { userKey, organizationKey: 'org-1', scopeKey };
const now = '2026-08-11T12:00:00.000Z';
const embedding = Array.from({ length: 4096 }, () => 0);
const connector = { key: userKey, organizationKey: 'org-1', scopeKey, provider: 'gmail', providerAccountId: 'google-1', email: 'me@example.com', encryptedCredentials: 'cipher', encryptionKeyId: 'v1', accessTokenFingerprint: 'a'.repeat(64), scopes: ['email'], createdByMembershipKey: scopeKey, status: 'active', createdAt: now, updatedAt: now } as const;
const thread = { key: userKey, scopeKey, accountKey: scopeKey, providerThreadId: 'thread-1', subject: 'Project', summary: 'Summary', intent: 'Review', priority: 'normal', state: 'needs_action', lastMessageAt: now, embedding, isFavorite: false, deletedAt: null, createdAt: now, updatedAt: now } as const;
const message = { key: scopeKey, scopeKey, accountKey: scopeKey, threadKey: userKey, providerMessageId: 'message-1', from: 'sender@example.com', replyTo: 'replies@example.com', to: ['me@example.com'], subject: 'Project', body: 'Can you review?', summary: 'Can you review?', direction: 'inbound', sentAt: now, hasAttachments: false, messageIdHeader: '<source@example.com>', replyDepth: 0, embedding, createdAt: now, updatedAt: now } as const;
const draft = { key: userKey, scopeKey, threadKey: userKey, messageKey: scopeKey, generatedContent: 'I will review it.', status: 'sending', embedding, createdAt: now, updatedAt: now } as const;

function serviceFor(sendRaw: () => Promise<{ id: string; threadId: string }>, existing: { id: string; threadId: string } | null = null, role: 'owner' | 'admin' | 'moderator' | 'viewer' = 'owner', subject: string = thread.subject, messages: unknown[] = [message]) {
  const finishes: unknown[][] = [];
  const repository = {
    claimDraft: async () => draft,
    thread: async () => ({ thread: { ...thread, subject }, messages }),
    finishDraft: async (...input: unknown[]) => { finishes.push(input); return draft; },
    syncThread: async () => thread,
  };
  const connectors = { find: async () => connector, credentials: () => ({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: '2027-08-11T12:00:00.000Z' }) };
  const gmail = { sendRaw, findMessageByRfc822Id: async () => existing, profile: async () => ({}), listThreads: async () => ({}), history: async () => ({}), thread: async () => ({}), modifyThread: async () => ({}), revoke: async () => undefined };
  return { finishes, service: createEmailService({ repository: repository as never, connectors: connectors as never, authorize: async () => ({ membershipKey: scopeKey, role }), client: () => gmail as never, embed: async () => embedding }) };
}

describe('email reply sending', () => {
  test('sends an RFC reply once and finalizes the claimed draft', async () => {
    let raw = '';
    const { service, finishes } = serviceFor(async (value?: unknown) => { raw = String(value); return { id: 'sent-1', threadId: 'thread-1' }; });
    expect(await service.sendDraft(actor, userKey)).toMatchObject({ sent: true, providerMessageId: 'sent-1' });
    expect(raw).toContain('To: replies@example.com');
    expect(raw).toContain('In-Reply-To: <source@example.com>');
    expect(finishes[0]).toEqual([userKey, true, 'sent-1']);
  });

  test('releases the draft when Gmail rejects the send', async () => {
    const { service, finishes } = serviceFor(async () => { throw new GmailApiError(400); });
    await expect(service.sendDraft(actor, userKey)).rejects.toThrow('Gmail API request failed');
    expect(finishes).toEqual([[userKey, false]]);
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
    expect(finishes[0]).toEqual([userKey, true, 'sent-before-crash']);
  });

  test('prevents viewer sessions from sending shared mail', async () => {
    const { service } = serviceFor(async () => ({ id: 'sent', threadId: 'thread-1' }), null, 'viewer');
    await expect(service.sendDraft(actor, userKey)).rejects.toThrow('may not perform');
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
    expect(finishes).toEqual([[userKey, false]]);
  });
});

describe('email thread read state', () => {
  function threadService(role: 'owner' | 'viewer', threadMessages: unknown[] = [message]) {
    const calls: string[] = [];
    let unread = true;
    const repository = {
      thread: async () => ({ thread: { ...thread, unread }, messages: threadMessages }),
      readThreadPage: async () => ({ thread: { ...thread, unread }, messages: threadMessages, nextCursor: null }),
      markThreadRead: async () => { calls.push('repository.markThreadRead'); unread = false; },
    };
    const connectors = {
      find: async () => connector,
      credentials: () => ({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: '2027-08-11T12:00:00.000Z' }),
    };
    const gmail = { modifyThread: async () => { calls.push('gmail.modifyThread'); } };
    return { calls, service: createEmailService({ repository: repository as never, connectors: connectors as never, authorize: async () => ({ membershipKey: scopeKey, role }), client: () => gmail as never }) };
  }

  test('explicitly marks an owner thread read and returns the bounded tool projection', async () => {
    const longMessage = { ...message, body: 'x'.repeat(8_001) };
    const { calls, service } = threadService('owner', [longMessage]);
    const result = await service.markRead(actor, userKey);
    expect(result).toMatchObject({ thread: { key: userKey, unread: false }, messages: [{ key: scopeKey, bodyTruncated: true }] });
    expect(result.messages[0]?.body).toHaveLength(8_000);
    expect(calls).toEqual(['gmail.modifyThread', 'repository.markThreadRead']);
  });

  test('restores Gmail UNREAD best-effort when local mark-read persistence fails', async () => {
    const modifications: unknown[][] = [];
    const repository = {
      thread: async () => ({ thread: { ...thread, unread: true }, messages: [message] }),
      markThreadRead: async () => { throw new Error('database unavailable'); },
    };
    const connectors = { find: async () => connector, credentials: () => ({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: '2027-08-11T12:00:00.000Z' }) };
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

  test('paginates the complete inbox and reconciles absent local threads', async () => {
    const synced: unknown[] = [];
    const reconciled: unknown[] = [];
    const embeddedTexts: string[] = [];
    const repository = {
      accountForScope: async () => null,
      upsertAccount: async () => ({ key: scopeKey, email: 'me@example.com' }),
      setSyncState: async () => undefined,
      claimSync: async () => true,
      renewSync: async () => true,
      releaseSync: async () => undefined,
      syncThread: async (input: unknown) => { synced.push(input); return thread; },
      reconcileThreadMessages: async () => undefined,
      reconcileInbox: async (...input: unknown[]) => { reconciled.push(input); },
      deleteProviderThread: async () => undefined,
    };
    let page = 0;
    const gmail = {
      profile: async () => ({ emailAddress: 'me@example.com', historyId: 'history-2' }),
      listThreads: async () => ++page === 1 ? { threads: [{ id: 'thread-1' }], nextPageToken: 'page-2' } : { threads: [{ id: 'thread-2' }] },
      history: async () => ({}),
      threadMetadata: async (id: string) => ({ id, messages: [gmailMessage(`message-${id}`, id)] }),
      message: async (id: string) => gmailMessage(id, id.replace('message-', '')),
    };
    const connectors = { find: async () => connector, credentials: () => ({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: '2027-08-11T12:00:00.000Z' }), markError: async () => undefined, markActive: async () => undefined };
    const service = createEmailService({
      repository: repository as never, connectors: connectors as never, authorize: async () => ({ membershipKey: scopeKey, role: 'owner' }), client: () => gmail as never,
      classify: async () => ({ priority: 'normal', state: 'needs_action', category: 'primary', intent: 'Review message' }),
      embed: async ({ text }) => { embeddedTexts.push(text); return embedding; },
    });
    expect(await service.sync(actor)).toMatchObject({ synced: 2 });
    expect(synced).toHaveLength(2);
    expect((synced[1] as { messages: Array<{ direction: string }> }).messages[0]?.direction).toBe('outbound');
    expect(embeddedTexts).toContain('Review\n\nPlease review this.\n\nPlease review this.');
    expect(reconciled).toEqual([[scopeKey, scopeKey, ['thread-1', 'thread-2']]]);
  });

  test('deletes a thread removed during incremental history', async () => {
    const deleted: unknown[] = [];
    const repository = {
      accountForScope: async () => ({ key: scopeKey, email: 'me@example.com', historyId: 'history-1', lastSyncedAt: now }),
      upsertAccount: async () => ({ key: scopeKey, email: 'me@example.com' }),
      setSyncState: async () => undefined,
      claimSync: async () => true,
      renewSync: async () => true,
      releaseSync: async () => undefined,
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
    const connectors = { find: async () => connector, credentials: () => ({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: '2027-08-11T12:00:00.000Z' }), markError: async () => undefined, markActive: async () => undefined };
    const service = createEmailService({ repository: repository as never, connectors: connectors as never, authorize: async () => ({ membershipKey: scopeKey, role: 'owner' }), client: () => gmail as never });
    expect(await service.sync(actor)).toMatchObject({ synced: 0 });
    expect(deleted).toEqual([[scopeKey, scopeKey, 'gone-thread']]);
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
