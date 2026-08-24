import { describe, expect, test } from 'bun:test';
import { deterministicEmailClassification, emailLabelsVisibleInInbox, inboxCategoryFor } from './classification';
import { buildGmailAuthorizationUrl, createGmailClient, decodeRfc2047Words, emailAddresses, emailAddressWithName, GmailApiError, isRetryableGmailError, messageBodies } from './gmail';

describe('Gmail connector protocol', () => {
  test('builds offline PKCE consent with permanent-delete scope for reconnects', () => {
    const url = new URL(buildGmailAuthorizationUrl({ state: 'state', nonce: 'nonce', codeChallenge: 'challenge' }, { GOOGLE_OAUTH_CLIENT_ID: 'client', GOOGLE_OAUTH_CLIENT_SECRET: 'secret', BACKEND_PUBLIC_URL: 'https://api.example.com' }));
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent select_account');
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('https://mail.google.com/');
    expect(url.searchParams.get('scope')).not.toContain('gmail.modify');
    expect(url.searchParams.get('scope')).not.toContain('gmail.send');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.example.com/api/v1/auth/mobile/oauth/google/callback');
  });

  test('parses display-name addresses and nested MIME bodies', () => {
    expect(emailAddresses('"Person, One" <one@example.com>, two@example.com')).toEqual(['one@example.com', 'two@example.com']);
    expect(emailAddressWithName('"Person, One" <ONE@example.com>')).toEqual({ email: 'one@example.com', name: 'Person, One' });
    expect(emailAddressWithName('Bad\r\nName <person@example.com>')).toEqual({ email: 'person@example.com', name: 'Bad Name' });
    expect(decodeRfc2047Words('=?UTF-8?B?Sm9zw6kgTcO8bGxlcg==?=')).toBe('José Müller');
    expect(emailAddressWithName('=?UTF-8?Q?Andr=C3=A9_Silva?= <andre@example.com>')).toEqual({ email: 'andre@example.com', name: 'André Silva' });
    expect(emailAddressWithName('=?UTF-8?B?Sm9zw6k=?= =?UTF-8?Q?_Silva?= <jose@example.com>')).toEqual({ email: 'jose@example.com', name: 'José Silva' });
    expect(messageBodies({ mimeType: 'multipart/mixed', parts: [
      { mimeType: 'text/plain', body: { data: Buffer.from('Hello').toString('base64url') } },
      { mimeType: 'application/pdf', filename: 'brief.pdf' },
    ] })).toEqual({ text: 'Hello', hasAttachments: true, html: undefined });
  });

  test('does not select bodies from attached messages or attachment dispositions', () => {
    const encoded = (value: string) => Buffer.from(value).toString('base64url');
    expect(messageBodies({ mimeType: 'multipart/mixed', parts: [
      { mimeType: 'message/rfc822', parts: [{ mimeType: 'text/plain', body: { data: encoded('Forwarded body') } }] },
      { mimeType: 'text/plain', headers: [{ name: 'Content-Disposition', value: 'attachment; filename="notes.txt"' }], body: { data: encoded('Attached notes') } },
      { mimeType: 'text/plain', body: { data: encoded('Main body') } },
    ] })).toEqual({ text: 'Main body', hasAttachments: true, html: undefined });
  });

  test('decodes declared MIME charsets with a safe UTF-8 fallback', () => {
    const bodies = messageBodies({ mimeType: 'multipart/alternative', parts: [
      {
        mimeType: 'text/plain',
        headers: [{ name: 'Content-Type', value: 'text/plain; charset=ISO-8859-1' }],
        body: { data: Buffer.from('Olá café', 'latin1').toString('base64url') },
      },
      {
        mimeType: 'text/html',
        headers: [{ name: 'Content-Type', value: 'text/html; charset="windows-1252"' }],
        body: { data: Buffer.from([0x3c, 0x70, 0x3e, 0x80, 0x20, 0x93, 0x3c, 0x2f, 0x70, 0x3e]).toString('base64url') },
      },
    ] });
    expect(bodies).toEqual({ text: 'Olá café', html: '<p>€ “</p>', hasAttachments: false });
    expect(messageBodies({
      mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=x-unsupported' }],
      body: { data: Buffer.from('UTF-8 fallback').toString('base64url') },
    }).text).toBe('UTF-8 fallback');
  });

  test('classifies provider labels and urgent subjects deterministically', () => {
    expect(deterministicEmailClassification({ labels: ['CATEGORY_PROMOTIONS'], subject: 'Sale', from: 'shop@example.com', direction: 'inbound' })).toMatchObject({ priority: 'low', state: 'filtered', category: 'promotions' });
    expect(deterministicEmailClassification({ labels: ['INBOX'], subject: 'Urgent: review today', from: 'lead@example.com', direction: 'inbound' })).toMatchObject({ priority: 'urgent', state: 'needs_action' });
    expect(inboxCategoryFor(['TRASH'], { priority: 'urgent', state: 'needs_action' })).toBe('Filtered');
    expect(inboxCategoryFor([], { priority: 'normal', state: 'filtered' })).toBe('Filtered');
    expect(inboxCategoryFor([], { priority: 'urgent', state: 'needs_action' })).toBe('Urgent');
    expect(inboxCategoryFor([], { priority: 'high', state: 'needs_action' })).toBe('Important');
    expect(emailLabelsVisibleInInbox(['INBOX'])).toBe(true);
    expect(emailLabelsVisibleInInbox(['SPAM'])).toBe(true);
    expect(emailLabelsVisibleInInbox(['TRASH'])).toBe(true);
    expect(emailLabelsVisibleInInbox(['SENT'])).toBe(false);
  });

  test('requests paginated inbox and incremental history without exposing tokens in URLs', async () => {
    const requests: string[] = [];
    const bodies: unknown[] = [];
    const client = createGmailClient('private-access-token', (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(String(input));
      bodies.push(init?.body);
      return Response.json({ threads: [], history: [] });
    }) as typeof fetch);
    await client.listThreads(100, 'next-page');
    await client.history('history-1', 'history-page');
    await client.threadMetadata('thread-1');
    await client.message('message-1');
    await client.watch('projects/project/topics/gmail');
    await client.trashThread('thread-1');
    await client.modifyThread('thread-1', ['STARRED'], []);
    await client.listTrashMessages(999, 'trash-page');
    await client.batchDeleteMessages(['message-1', 'message-2']);
    await client.revoke();
    expect(requests[0]).toContain('includeSpamTrash=true');
    expect(requests[0]).toContain('pageToken=next-page');
    expect(requests[1]).toContain('startHistoryId=history-1');
    expect(requests.join(' ')).not.toContain('private-access-token');
    expect(requests[2]).toContain('/threads/thread-1?format=minimal');
    expect(requests[3]).toContain('/messages/message-1?format=full');
    expect(bodies[4]).toBe(JSON.stringify({ topicName: 'projects/project/topics/gmail' }));
    expect(requests[5]).toContain('/threads/thread-1/trash');
    expect(bodies[5]).toBe('{}');
    expect(requests[6]).toContain('/threads/thread-1/modify');
    expect(bodies[6]).toBe(JSON.stringify({ addLabelIds: ['STARRED'], removeLabelIds: [] }));
    expect(requests[7]).toContain('/messages?');
    expect(requests[7]).toContain('labelIds=TRASH');
    expect(requests[7]).toContain('includeSpamTrash=true');
    expect(requests[7]).toContain('maxResults=500');
    expect(requests[7]).toContain('pageToken=trash-page');
    expect(requests[8]).toContain('/messages/batchDelete');
    expect(bodies[8]).toBe(JSON.stringify({ ids: ['message-1', 'message-2'] }));
    expect(bodies[9]).toBe('token=private-access-token');
  });

  test('retains Gmail error reasons for retry classification', async () => {
    const client = createGmailClient('token', (async () => Response.json({ error: { message: 'quota wait', status: 'RESOURCE_EXHAUSTED', errors: [{ reason: 'rateLimitExceeded' }] } }, { status: 403 })) as unknown as typeof fetch, { sleep: async () => {}, random: () => 0 });
    let error: unknown;
    try { await client.modifyThread('thread', [], []); } catch (caught) { error = caught; }
    expect(isRetryableGmailError(error)).toBe(true);
    expect(error).toBeInstanceOf(GmailApiError);
    expect((error as GmailApiError).metadata).toMatchObject({ providerStatus: 'RESOURCE_EXHAUSTED', providerMessage: 'quota wait' });
    expect((error as GmailApiError).reasons).toEqual(['rateLimitExceeded', 'RESOURCE_EXHAUSTED']);
    expect(isRetryableGmailError(new GmailApiError(403, ['forbidden']))).toBe(false);
    expect(isRetryableGmailError(new GmailApiError(408))).toBe(true);
    expect(isRetryableGmailError(new GmailApiError(429))).toBe(true);
  });

  test('retries bounded safe requests with Retry-After and jitter', async () => {
    const responses = [
      Response.json({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }, { status: 429, headers: { 'retry-after': '2' } }),
      Response.json({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, { status: 403 }),
      Response.json({ error: { status: 'UNAVAILABLE' } }, { status: 503 }),
      Response.json({ emailAddress: 'person@example.com', messagesTotal: 1, threadsTotal: 1, historyId: '7' }),
    ];
    const delays: number[] = [];
    let calls = 0;
    const client = createGmailClient('token', (async () => { calls += 1; return responses.shift()!; }) as unknown as typeof fetch, {
      sleep: async (milliseconds) => { delays.push(milliseconds); }, random: () => 0.5,
    });
    await expect(client.profile()).resolves.toMatchObject({ historyId: '7' });
    expect(calls).toBe(4);
    expect(delays).toEqual([2000, 250, 500]);
  });

  test('honors Retry-After HTTP dates and stops after four attempts', async () => {
    const delays: number[] = [];
    let calls = 0;
    const client = createGmailClient('token', (async () => {
      calls += 1;
      return Response.json({ error: { status: 'UNAVAILABLE' } }, { status: 503, headers: { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' } });
    }) as unknown as typeof fetch, { now: () => Date.parse('Wed, 21 Oct 2026 07:27:55 GMT'), sleep: async (milliseconds) => { delays.push(milliseconds); } });
    await expect(client.profile()).rejects.toBeInstanceOf(GmailApiError);
    expect(calls).toBe(4);
    expect(delays).toEqual([5000, 5000, 5000]);
  });

  test('retries transient transport failures for watch with bounded jitter', async () => {
    const reset = Object.assign(new Error('socket reset'), { code: 'ECONNRESET' });
    const outcomes: Array<Error | Response> = [
      new TypeError('fetch failed'),
      new DOMException('timed out', 'TimeoutError'),
      reset,
      Response.json({ historyId: '8', expiration: '123456' }),
    ];
    const delays: number[] = [];
    let calls = 0;
    const client = createGmailClient('token', (async () => {
      calls += 1;
      const outcome = outcomes.shift()!;
      if (outcome instanceof Error) throw outcome;
      return outcome;
    }) as unknown as typeof fetch, { random: () => 0.5, sleep: async (milliseconds) => { delays.push(milliseconds); } });
    await expect(client.watch('projects/project/topics/gmail')).resolves.toEqual({ historyId: '8', expiration: '123456' });
    expect(calls).toBe(4);
    expect(delays).toEqual([125, 250, 500]);
  });

  test('does not retry unrelated transport rejections', async () => {
    let calls = 0;
    const failure = new Error('invalid request construction');
    const client = createGmailClient('token', (async () => { calls += 1; throw failure; }) as unknown as typeof fetch, { sleep: async () => { throw new Error('must not sleep'); } });
    await expect(client.profile()).rejects.toBe(failure);
    expect(calls).toBe(1);
  });

  test('never retries sendRaw after an ambiguous provider response', async () => {
    let calls = 0;
    const client = createGmailClient('token', (async () => { calls += 1; return Response.json({ error: { status: 'UNAVAILABLE' } }, { status: 503 }); }) as unknown as typeof fetch, { sleep: async () => { throw new Error('must not sleep'); } });
    await expect(client.sendRaw('Subject: test\r\n\r\nbody')).rejects.toBeInstanceOf(GmailApiError);
    expect(calls).toBe(1);
    const transportClient = createGmailClient('token', (async () => { calls += 1; throw new TypeError('fetch failed'); }) as unknown as typeof fetch, { sleep: async () => { throw new Error('must not sleep'); } });
    await expect(transportClient.sendRaw('Subject: test\r\n\r\nbody')).rejects.toBeInstanceOf(TypeError);
    expect(calls).toBe(2);
  });

  test('bounds concurrent requests per Gmail client', async () => {
    let active = 0;
    let maximum = 0;
    const client = createGmailClient('token', (async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return Response.json({ emailAddress: 'person@example.com', messagesTotal: 1, threadsTotal: 1, historyId: '7' });
    }) as unknown as typeof fetch, { maxConcurrency: 2 });
    await Promise.all(Array.from({ length: 8 }, () => client.profile()));
    expect(maximum).toBe(2);
  });

  test('hydrates attachment-backed text MIME parts within the size bound', async () => {
    const requests: string[] = [];
    const client = createGmailClient('token', (async (input: string | URL | Request) => {
      requests.push(String(input));
      if (String(input).includes('/attachments/attachment-1')) return Response.json({ data: Buffer.from('Loaded body').toString('base64url'), size: 11 });
      return Response.json({ id: 'message-1', threadId: 'thread-1', payload: { mimeType: 'text/plain', body: { attachmentId: 'attachment-1', size: 11 } } });
    }) as typeof fetch);
    const message = await client.message('message-1');
    expect(messageBodies(message.payload)).toEqual({ text: 'Loaded body', hasAttachments: false });
    expect(requests[1]).toContain('/messages/message-1/attachments/attachment-1');
  });

  test('rejects oversized attachment-backed text before downloading it', async () => {
    let calls = 0;
    const client = createGmailClient('token', (async () => {
      calls += 1;
      return Response.json({ id: 'message-1', threadId: 'thread-1', payload: { mimeType: 'text/plain', body: { attachmentId: 'large', size: 25 * 1024 * 1024 + 1 } } });
    }) as unknown as typeof fetch);
    await expect(client.message('message-1')).rejects.toBeInstanceOf(RangeError);
    expect(calls).toBe(1);
  });
});
