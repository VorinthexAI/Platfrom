import { describe, expect, test } from 'bun:test';
import { buildOutlookAuthorizationUrl, createOutlookClient, exchangeOutlookCode, OutlookApiError, OUTLOOK_SCOPES } from './outlook';

const environment = {
  OUTLOOK_OAUTH_CLIENT_ID: 'client-id',
  OUTLOOK_OAUTH_CLIENT_SECRET: 'client-secret',
  OUTLOOK_OAUTH_TENANT: 'common',
  BACKEND_PUBLIC_URL: 'https://api.example.com',
} as NodeJS.ProcessEnv;

describe('Outlook connector protocol', () => {
  test('builds a PKCE authorization URL with mail scopes', () => {
    const url = new URL(buildOutlookAuthorizationUrl({ state: 'state', nonce: 'nonce', codeChallenge: 'challenge' }, environment));
    expect(url.origin).toBe('https://login.microsoftonline.com');
    expect(url.pathname).toContain('/common/oauth2/v2.0/authorize');
    expect(url.searchParams.get('code_challenge')).toBe('challenge');
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([...OUTLOOK_SCOPES]);
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.example.com/api/v1/email/connectors/outlook/callback');
  });

  test('exchanges a code and binds the Graph identity', async () => {
    const calls: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/token')) return new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, token_type: 'Bearer', scope: OUTLOOK_SCOPES.join(' ') }), { status: 200 });
      return new Response(JSON.stringify({ id: 'microsoft-1', mail: null, userPrincipalName: 'Person@Example.com' }), { status: 200 });
    }) as typeof fetch;
    const result = await exchangeOutlookCode('code', 'verifier', 'nonce', fetcher, environment);
    expect(result.identity).toEqual({ providerAccountId: 'microsoft-1', email: 'person@example.com' });
    expect(result.credentials).toMatchObject({ accessToken: 'access', refreshToken: 'refresh' });
    expect(calls).toHaveLength(2);
  });

  test('paginates a composite delta round across folders and preserves every completed delta link', async () => {
    const calls: string[] = [];
    const deltaUrl = (folder: string, token: string) => `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages/delta?$deltatoken=${token}`;
    const fetcher = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      calls.push(url.toString());
      const folder = /mailFolders\/(inbox|deleteditems|junkemail|sentitems)\/messages\/delta/.exec(url.pathname)?.[1] ?? '';
      if (folder === 'inbox' && !url.searchParams.has('$skiptoken')) return Response.json({
        value: [{ id: 'inbox-message', conversationId: 'inbox-thread' }, { id: 'draft', conversationId: 'draft-thread', isDraft: true }],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=inbox-2',
      });
      if (folder === 'inbox') return Response.json({ value: [{ id: 'moved-message', '@removed': { reason: 'changed' } }], '@odata.deltaLink': deltaUrl(folder, 'one') });
      if (folder === 'deleteditems') return Response.json({ value: [{ id: 'moved-message', conversationId: 'moved-thread' }], '@odata.deltaLink': deltaUrl(folder, 'one') });
      if (folder === 'junkemail') return Response.json({ value: [{ id: 'removed-message', '@removed': { reason: 'deleted' } }], '@odata.deltaLink': deltaUrl(folder, 'one') });
      return Response.json({ value: [{ id: 'sent-message', conversationId: 'sent-thread' }], '@odata.deltaLink': deltaUrl(folder, 'one') });
    }) as typeof fetch;
    const client = createOutlookClient('access', 'person@example.com', fetcher);
    const startHistoryId = (await client.profile()).historyId;
    const history: any[] = [];
    let pageToken: string | undefined;
    let finalHistoryId: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await client.history(startHistoryId, pageToken);
      history.push(...result.history);
      pageToken = result.nextPageToken;
      finalHistoryId = result.historyId;
      if (!pageToken) break;
      expect(result.historyId).toBeUndefined();
    }
    expect(pageToken).toBeUndefined();
    expect(finalHistoryId).toBeString();
    expect(finalHistoryId).not.toContain('graph.microsoft.com');
    expect(history).toEqual([
      { id: 'inbox-message', messagesAdded: [{ message: { id: 'inbox-message', threadId: 'inbox-thread' } }] },
      { id: 'moved-message', messagesDeleted: [{ message: { id: 'moved-message', threadId: '' } }] },
      { id: 'moved-message', messagesAdded: [{ message: { id: 'moved-message', threadId: 'moved-thread' } }] },
      { id: 'removed-message', messagesDeleted: [{ message: { id: 'removed-message', threadId: '' } }] },
      { id: 'sent-message', messagesAdded: [{ message: { id: 'sent-message', threadId: 'sent-thread' } }] },
    ]);
    expect(calls).toHaveLength(5);

    const nextRoundCalls: string[] = [];
    const nextClient = createOutlookClient('access', 'person@example.com', (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      nextRoundCalls.push(url.toString());
      const folder = /mailFolders\/(inbox|deleteditems|junkemail|sentitems)\/messages\/delta/.exec(url.pathname)![1]!;
      return Response.json({ value: [], '@odata.deltaLink': deltaUrl(folder, 'two') });
    }) as typeof fetch);
    pageToken = undefined;
    for (let page = 0; page < 4; page += 1) {
      const result = await nextClient.history(finalHistoryId!, pageToken);
      pageToken = result.nextPageToken;
    }
    expect(nextRoundCalls).toEqual(['inbox', 'deleteditems', 'junkemail', 'sentitems'].map((folder) => deltaUrl(folder, 'one')));
  });

  test('rejects malformed, cross-host, and repeated delta cursors', async () => {
    const client = createOutlookClient('access', 'person@example.com', (async (input: string | URL | Request) => {
      const url = String(input);
      return Response.json({ value: [], '@odata.nextLink': url });
    }) as typeof fetch);
    const startHistoryId = (await client.profile()).historyId;
    await expect(client.history('outlook:initial')).rejects.toMatchObject({ status: 410, code: 'syncStateNotFound' });
    await expect(client.history('not base64url!')).rejects.toThrow('Invalid Outlook delta cursor');
    const hostile = Buffer.from(JSON.stringify({ v: 1, k: 'outlook-delta', f: { inbox: 'https://attacker.example/delta', deleteditems: null, junkemail: null, sentitems: null } })).toString('base64url');
    await expect(client.history(hostile)).rejects.toThrow('Invalid Outlook delta cursor');
    await expect(client.history(startHistoryId)).rejects.toThrow('repeated a continuation URL');
  });

  test('preserves Graph delta reset diagnostics', async () => {
    const body = { error: { code: 'syncStateNotFound', message: 'The sync state is no longer valid.' } };
    const resetUrl = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=reset';
    const fetcher = (async () => new Response(JSON.stringify(body), {
      status: 410,
      headers: { location: resetUrl, 'request-id': 'request-1', 'client-request-id': 'client-1', 'retry-after': '17' },
    })) as unknown as typeof fetch;

    const client = createOutlookClient('access', 'person@example.com', fetcher);
    const error = await client.history((await client.profile()).historyId).catch((value) => value);
    expect(error).toBeInstanceOf(OutlookApiError);
    expect(error).toMatchObject({ status: 410, code: 'syncStateNotFound', body, requestId: 'request-1', clientRequestId: 'client-1', retryAfter: '17', retryAfterMs: 17_000, location: resetUrl, resetUrl });
  });

  test('follows a folder-bound syncStateNotFound reset while preserving completed folders', async () => {
    const resetUrl = 'https://graph.microsoft.com/v1.0/me/mailFolders/deleteditems/messages/delta?$deltatoken=reset';
    const calls: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      const folder = /mailFolders\/(inbox|deleteditems|junkemail|sentitems)\/messages\/delta/.exec(url)?.[1] ?? '';
      if (folder === 'deleteditems' && url !== resetUrl) return new Response(JSON.stringify({ error: { code: 'syncStateNotFound' } }), { status: 410, headers: { location: resetUrl } });
      return Response.json({ value: folder === 'deleteditems' ? [{ id: 'reset-message', conversationId: 'reset-conversation' }] : [], '@odata.deltaLink': `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages/delta?$deltatoken=complete` });
    }) as typeof fetch;
    const client = createOutlookClient('access', 'person@example.com', fetcher);
    const start = (await client.profile()).historyId;
    let pageToken: string | undefined;
    const changes: any[] = [];
    for (let page = 0; page < 4; page += 1) {
      const result = await client.history(start, pageToken);
      changes.push(...result.history);
      pageToken = result.nextPageToken;
    }
    expect(changes).toContainEqual({ id: 'reset-message', messagesAdded: [{ message: { id: 'reset-message', threadId: 'reset-conversation' } }] });
    expect(calls[0]).toContain('/inbox/messages/delta');
    expect(calls).toContain(resetUrl);
  });

  test('lists non-draft conversations across every supported folder with opaque continuation', async () => {
    const calls: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      calls.push(url.toString());
      const folder = /mailFolders\/(inbox|deleteditems|junkemail|sentitems)\/messages$/.exec(url.pathname)?.[1] ?? '';
      if (folder === 'inbox' && !url.searchParams.has('$skiptoken')) return Response.json({ value: [{ id: '1', conversationId: 'shared' }, { id: '2', conversationId: 'shared' }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skiptoken=two' });
      if (folder === 'inbox') return Response.json({ value: [{ id: '3', conversationId: 'inbox-only' }] });
      if (folder === 'deleteditems') return Response.json({ value: [{ id: '4', conversationId: 'shared' }, { id: '5', conversationId: 'trash-only' }] });
      if (folder === 'junkemail') return Response.json({ value: [{ id: '6', conversationId: 'draft-only', isDraft: true }, { id: '7', conversationId: 'junk-only' }] });
      return Response.json({ value: [{ id: '8', conversationId: 'sent-only' }] });
    }) as typeof fetch;
    const client = createOutlookClient('access', 'person@example.com', fetcher);
    const ids: string[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await client.listThreads(2, pageToken);
      ids.push(...result.threads.map(({ id }) => id));
      pageToken = result.nextPageToken;
      if (!pageToken) break;
      expect(pageToken).not.toContain('graph.microsoft.com');
    }
    expect(ids).toEqual(['shared', 'shared', 'inbox-only', 'shared', 'trash-only', 'junk-only', 'sent-only']);
    expect([...new Set(ids)]).toEqual(['shared', 'inbox-only', 'trash-only', 'junk-only', 'sent-only']);
    expect(calls.some((url) => url.includes('/deleteditems/messages'))).toBe(true);
    expect(calls.some((url) => url.includes('/junkemail/messages'))).toBe(true);
    expect(calls.some((url) => url.includes('/sentitems/messages'))).toBe(true);
  });

  test('rejects repeated list continuation URLs', async () => {
    const client = createOutlookClient('access', 'person@example.com', (async (input: string | URL | Request) => {
      const url = String(input);
      return Response.json({ value: [], '@odata.nextLink': url });
    }) as typeof fetch);
    await expect(client.listThreads()).rejects.toThrow('repeated a continuation URL');
  });

  test('keeps full-snapshot cursors bounded beyond 5,000 unique conversations', async () => {
    const conversationCount = 6_000;
    const graphPageSize = 100;
    const fetcher = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const folder = /mailFolders\/(inbox|deleteditems|junkemail|sentitems)\/messages$/.exec(url.pathname)?.[1] ?? '';
      if (folder !== 'inbox') return Response.json({ value: [] });
      const page = Number(url.searchParams.get('$skiptoken') ?? 0);
      const offset = page * graphPageSize;
      const value = Array.from({ length: Math.min(graphPageSize, conversationCount - offset) }, (_, index) => ({
        id: `message-${offset + index}`,
        conversationId: `conversation-${offset + index}`,
      }));
      const nextOffset = offset + value.length;
      return Response.json({
        value,
        ...(nextOffset < conversationCount ? { '@odata.nextLink': `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skiptoken=${page + 1}` } : {}),
      });
    }) as typeof fetch;
    const client = createOutlookClient('access', 'person@example.com', fetcher);
    const canonicalIds = new Set<string>();
    let pageToken: string | undefined;
    let maximumCursorLength = 0;
    for (let page = 0; page < 100; page += 1) {
      const result = await client.listThreads(100, pageToken);
      for (const thread of result.threads) canonicalIds.add(thread.id);
      pageToken = result.nextPageToken;
      maximumCursorLength = Math.max(maximumCursorLength, pageToken?.length ?? 0);
      if (!pageToken) break;
    }
    expect(pageToken).toBeUndefined();
    expect(canonicalIds.size).toBe(conversationCount);
    expect(maximumCursorLength).toBeLessThan(2_000);
  });

  test('uses actual Graph folders and exhausts conversation pagination', async () => {
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input);
      const folder = /mailFolders\/(inbox|deleteditems|junkemail|sentitems|drafts|archive)/.exec(url)?.[1];
      if (folder) return new Response(JSON.stringify({ id: `${folder}-id` }), { status: 200 });
      if (url.includes('/messages/message-1?')) return new Response(JSON.stringify({ id: 'message-1', conversationId: 'conversation', parentFolderId: 'inbox-id', categories: ['TRASH'], isRead: true }), { status: 200 });
      if (url.includes('/messages/message-2?')) return new Response(JSON.stringify({ id: 'message-2', conversationId: 'conversation', parentFolderId: 'deleteditems-id', isRead: true }), { status: 200 });
      if (url.includes('page=2')) return new Response(JSON.stringify({ value: [{ id: 'message-2', conversationId: 'conversation' }] }), { status: 200 });
      return new Response(JSON.stringify({ value: [{ id: 'message-1', conversationId: 'conversation' }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?page=2' }), { status: 200 });
    }) as typeof fetch;
    const client = createOutlookClient('access', 'person@example.com', fetcher);

    expect((await client.message('message-1')).labelIds).toEqual(expect.arrayContaining(['INBOX', 'OUTLOOK_CATEGORY:TRASH']));
    expect((await client.message('message-1')).labelIds).not.toContain('TRASH');
    expect((await client.message('message-2')).labelIds).toContain('TRASH');
    expect(await client.threadMetadata('conversation')).toEqual({ id: 'conversation', messages: [{ id: 'message-1', threadId: 'conversation' }, { id: 'message-2', threadId: 'conversation' }] });
  });

  test('treats an empty Graph conversation as deleted', async () => {
    const fetcher = (async () => new Response(JSON.stringify({ value: [] }), { status: 200 })) as unknown as typeof fetch;
    await expect(createOutlookClient('access', 'person@example.com', fetcher).threadMetadata('missing')).rejects.toMatchObject({ status: 404 });
  });

  test('uses immutable IDs and returns the immutable move response', async () => {
    const calls: Array<{ method: string; url: string; prefer: string | null }> = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ method: init?.method ?? 'GET', url, prefer: new Headers(init?.headers).get('prefer') });
      if (url.endsWith('/move')) return new Response(JSON.stringify({ id: 'immutable-moved', conversationId: 'conversation-1' }), { status: 201 });
      return new Response(JSON.stringify({ value: [{ id: 'immutable-source', conversationId: 'conversation-1' }] }), { status: 200 });
    }) as typeof fetch;
    const client = createOutlookClient('access', 'person@example.com', fetcher);
    expect(await client.trashThread('conversation-1')).toEqual({ id: 'conversation-1', messages: [{ id: 'immutable-moved', threadId: 'conversation-1' }] });
    expect(calls).toContainEqual({ method: 'POST', url: 'https://graph.microsoft.com/v1.0/me/messages/immutable-source/move', prefer: 'IdType="ImmutableId"' });
    expect(calls.every(({ prefer }) => prefer === 'IdType="ImmutableId"')).toBe(true);
  });

  test('permanently deletes each item and does not hide an unconfirmed failure behind 404', async () => {
    const attempts = new Map<string, number>();
    const calls: Array<{ method: string; url: string; prefer: string | null }> = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const id = /messages\/([^/]+)\/permanentDelete$/.exec(url)?.[1] ?? '';
      calls.push({ method: init?.method ?? 'GET', url, prefer: new Headers(init?.headers).get('prefer') });
      const attempt = (attempts.get(id) ?? 0) + 1;
      attempts.set(id, attempt);
      if (id === 'missing') return new Response(JSON.stringify({ error: { code: 'ErrorItemNotFound' } }), { status: 404 });
      if (id === 'throttled' && attempt === 1) return new Response(JSON.stringify({ error: { code: 'TooManyRequests' } }), { status: 429, headers: { 'retry-after': '0' } });
      if (id === 'unconfirmed') return new Response(JSON.stringify({ error: { code: 'ServiceUnavailable' } }), { status: 503, headers: { 'retry-after': '0', 'request-id': 'failure-request' } });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const client = createOutlookClient('access', 'person@example.com', fetcher);

    const error = await client.batchDeleteMessages(['deleted', 'missing', 'throttled', 'unconfirmed']).catch((value) => value);
    expect(error).toMatchObject({ status: 503, code: 'ServiceUnavailable', requestId: 'failure-request' });
    expect(attempts).toEqual(new Map([['deleted', 1], ['missing', 1], ['throttled', 2], ['unconfirmed', 3]]));
    expect(calls.every(({ method, url, prefer }) => method === 'POST' && url.endsWith('/permanentDelete') && prefer === 'IdType="ImmutableId"')).toBe(true);
    expect(calls.map(({ url }) => url)).toContain('https://graph.microsoft.com/v1.0/me/messages/deleted/permanentDelete');
  });

  test('bounds concurrent permanent-delete requests', async () => {
    let active = 0;
    let maximumActive = 0;
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetcher = (async () => {
      active += 1;
      started += 1;
      maximumActive = Math.max(maximumActive, active);
      if (started === 8) release();
      await gate;
      active -= 1;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    await createOutlookClient('access', 'person@example.com', fetcher).batchDeleteMessages(Array.from({ length: 20 }, (_, index) => `message-${index}`));
    expect(maximumActive).toBe(8);
  });

  test('retries reads with Retry-After but never automatically retries sendMail', async () => {
    let reads = 0;
    let sends = 0;
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/sendMail')) {
        sends += 1;
        return new Response(JSON.stringify({ error: { code: 'ServiceUnavailable', message: 'Try later' } }), { status: 503, headers: { 'retry-after': '0' } });
      }
      reads += 1;
      if (reads === 1) return new Response(JSON.stringify({ error: { code: 'TooManyRequests' } }), { status: 429, headers: { 'retry-after': '0' } });
      return new Response(JSON.stringify({ value: [{ id: 'deleted-1', conversationId: 'conversation-1' }] }), { status: 200 });
    }) as typeof fetch;
    const client = createOutlookClient('access', 'person@example.com', fetcher);

    expect(await client.listTrashMessages()).toEqual({ messages: [{ id: 'deleted-1', threadId: 'conversation-1' }] });
    expect(reads).toBe(2);
    await expect(client.sendRaw('Message-ID: <outgoing@example.com>\r\n\r\nBody')).rejects.toMatchObject({ status: 503, code: 'ServiceUnavailable', retryAfter: '0' });
    expect(sends).toBe(1);
  });
});
