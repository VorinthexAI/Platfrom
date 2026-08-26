import { describe, expect, test } from 'bun:test';
import { deterministicEmailClassification, emailLabelsVisibleInInbox, inboxCategoryFor } from './classification';
import { buildGmailAuthorizationUrl, createGmailClient, decodeGmailAttachmentData, decodeRfc2047Words, discoverGmailAttachmentParts, emailAddresses, emailAddressWithName, gmailAttachmentParts, GmailApiError, GmailPermanentAttachmentError, isRetryableGmailError, MAX_GMAIL_ATTACHMENT_BYTES, MAX_GMAIL_ATTACHMENTS, messageBodies, normalizeGmailAttachmentFilename } from './gmail';

describe('Gmail connector protocol', () => {
  test('reports supported attachments omitted by the canonical count bound', () => {
    const discovery = discoverGmailAttachmentParts({ mimeType: 'multipart/mixed', parts: Array.from({ length: MAX_GMAIL_ATTACHMENTS + 3 }, (_, index) => ({ mimeType: 'text/plain', filename: `${index}.txt`, body: { size: 1, data: 'YQ' } })) });
    expect(discovery.parts).toHaveLength(MAX_GMAIL_ATTACHMENTS);
    expect(discovery).toMatchObject({ truncated: true, unavailableCount: 3 });
  });
  test('reports unsupported attached leaves and MIME subtrees omitted by the node budget', () => {
    expect(discoverGmailAttachmentParts({ mimeType: 'multipart/mixed', parts: [
      { mimeType: 'application/zip', filename: 'archive.zip', body: { size: 10, data: 'AA' } },
      { mimeType: 'text/plain', filename: 'notes.txt', body: { size: 1, data: 'YQ' } },
    ] })).toMatchObject({ parts: [{ filename: 'notes.txt' }], truncated: true, unavailableCount: 1 });

    const wide = discoverGmailAttachmentParts({ mimeType: 'multipart/mixed', parts: Array.from({ length: 10_001 }, () => ({ mimeType: 'multipart/alternative', parts: [] })) });
    expect(wide.truncated).toBe(true);
    expect(wide.unavailableCount).toBeGreaterThan(0);
  });
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

  test('assigns deterministic safe filenames to supported attachment dispositions without names', () => {
    const payload = { mimeType: 'multipart/mixed', parts: [
      { mimeType: 'application/pdf', headers: [{ name: 'Content-Disposition', value: 'attachment' }], body: { attachmentId: 'pdf-part', size: 12 } },
      { mimeType: 'image/png', headers: [{ name: 'Content-Disposition', value: 'attachment;' }], body: { attachmentId: 'image-part', size: 8 } },
    ] };
    const first = gmailAttachmentParts(payload);
    expect(first).toEqual(gmailAttachmentParts(payload));
    expect(first).toMatchObject([
      { path: '0.0', type: 'document', mimeType: 'application/pdf', filename: expect.stringMatching(/^attachment-[a-f0-9]{12}\.pdf$/) },
      { path: '0.1', type: 'image', mimeType: 'image/png', filename: expect.stringMatching(/^attachment-[a-f0-9]{12}\.png$/) },
    ]);
    expect(new Set(first.map(({ filename }) => filename)).size).toBe(2);
  });

  test('canonicalizes untrusted attachment filenames before source binding', () => {
    const fallback = normalizeGmailAttachmentFilename('../secret\u202epdf.exe', '0.1', 'application/pdf');
    expect(fallback).toMatch(/^attachment-[a-f0-9]{12}\.pdf$/);
    expect(normalizeGmailAttachmentFilename('quarterly-report.exe', '0.2', 'application/pdf')).toBe('quarterly-report.pdf');
    expect(normalizeGmailAttachmentFilename('photo.png', '0.3', 'image/jpeg')).toBe('photo.jpg');
    expect(normalizeGmailAttachmentFilename('CON.txt', '0.4', 'text/plain')).toMatch(/^attachment-[a-f0-9]{12}\.txt$/);
    expect(normalizeGmailAttachmentFilename(`${'a'.repeat(256)}.pdf`, '0.5', 'application/pdf')).toMatch(/^attachment-[a-f0-9]{12}\.pdf$/);
    expect(normalizeGmailAttachmentFilename('', '0.6', 'image/png')).toMatch(/^attachment-[a-f0-9]{12}\.png$/);
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

  test('requests an authoritative all-mail snapshot and incremental history without exposing tokens in URLs', async () => {
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
    expect(requests[0]).not.toContain('labelIds=');
    expect(requests[0]).not.toContain('q=');
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

  test('validates Google revocation responses while allowing idempotent retries', async () => {
    const responses = [new Response(null, { status: 400 }), new Response(null, { status: 503 })];
    const client = createGmailClient('access', (async (_input: string | URL | Request, _init?: RequestInit) => responses.shift()!) as typeof fetch);
    await expect(client.revoke('refresh')).resolves.toBeUndefined();
    await expect(client.revoke('refresh')).rejects.toMatchObject({ name: 'GmailApiError', status: 503 });
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

  test('sends exact Gmail stop, lookup, and threaded raw-message requests', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const client = createGmailClient('token', (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body });
      return Response.json(requests.length === 2 ? { messages: [{ id: 'existing', threadId: 'thread-1' }] } : requests.length === 3 ? { id: 'sent', threadId: 'thread-1' } : {});
    }) as typeof fetch);
    await client.stop();
    await expect(client.findMessageByRfc822Id('<message@example.com>')).resolves.toEqual({ id: 'existing', threadId: 'thread-1' });
    await client.sendRaw('Subject: Test\r\n\r\nBody', 'thread-1');
    expect(requests).toEqual([
      { url: 'https://gmail.googleapis.com/gmail/v1/users/me/stop', method: 'POST', body: '{}' },
      { url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=rfc822msgid%3A%3Cmessage%40example.com%3E&maxResults=1', method: 'GET', body: undefined },
      { url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', method: 'POST', body: JSON.stringify({ raw: Buffer.from('Subject: Test\r\n\r\nBody').toString('base64url'), threadId: 'thread-1' }) },
    ]);
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

  test('enumerates supported attachment leaves with stable part paths and excludes alternatives and attached mail', () => {
    const payload = { mimeType: 'multipart/mixed', parts: [
      { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: 'QQ', size: 1 } }, { mimeType: 'text/html', body: { data: 'QQ', size: 1 } }] },
      { mimeType: 'application/pdf', filename: 'same.pdf', body: { attachmentId: 'a', size: 5 } },
      { mimeType: 'application/pdf', filename: 'same.pdf', body: { attachmentId: 'b', size: 6 } },
      { mimeType: 'message/rfc822', filename: 'mail.eml', body: { attachmentId: 'c', size: 7 }, parts: [{ mimeType: 'image/png', filename: 'nested.png', body: { attachmentId: 'd', size: 8 } }] },
      { mimeType: 'application/zip', filename: 'skip.zip', body: { attachmentId: 'e', size: 9 } },
    ] };
    expect(gmailAttachmentParts(payload)).toEqual([
      { path: '0.1', type: 'document', mimeType: 'application/pdf', filename: 'same.pdf', size: 5, attachmentId: 'a' },
      { path: '0.2', type: 'document', mimeType: 'application/pdf', filename: 'same.pdf', size: 6, attachmentId: 'b' },
    ]);
    expect(discoverGmailAttachmentParts(payload)).toMatchObject({ unavailableCount: 2, truncated: true });
  });

  test('traverses deeply nested MIME trees and recognizes every supported alias case-insensitively', () => {
    const supported = [
      ['APPLICATION/PDF; name=x', 'document', 'pdf'], ['text/plain; charset=utf-8', 'document', 'txt'],
      ['text/markdown', 'document', 'md'], ['text/x-markdown', 'document', 'md'], ['application/msword', 'document', 'doc'],
      ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document', 'docx'],
      ['IMAGE/JPEG; name=x', 'image', 'jpg'], ['image/jpg', 'image', 'jpg'], ['image/png', 'image', 'png'],
      ['image/webp', 'image', 'webp'], ['image/gif', 'image', 'gif'],
    ] as const;
    const leaves = supported.map(([mimeType], index) => ({ mimeType, filename: `duplicate.bin`, body: { attachmentId: `id-${index}`, size: index + 1 } }));
    const payload = { mimeType: 'multipart/mixed', parts: [{ mimeType: 'multipart/related', parts: [{ mimeType: 'multipart/mixed', parts: leaves }] }, { mimeType: 'message/rfc822; name=mail', filename: 'mail.eml', parts: [leaves[0]] }, { mimeType: 'application/zip', filename: 'skip.zip', body: { attachmentId: 'zip', size: 1 } }] };
    expect(gmailAttachmentParts(payload)).toEqual(supported.map(([mimeType, type, extension], index) => ({ path: `0.0.0.${index}`, type, mimeType: mimeType.toLowerCase().split(';')[0], filename: `duplicate.${extension}`, size: index + 1, attachmentId: `id-${index}` })));
  });

  test('retains supported leaves with missing payload identifiers for typed permanent rejection', () => {
    expect(gmailAttachmentParts({ mimeType: 'multipart/mixed', parts: [
      { mimeType: 'text/plain', filename: 'missing.txt', body: { size: 3 } },
      { mimeType: 'image/png', filename: 'invalid.png', body: {} },
    ] })).toMatchObject([{ path: '0.0', size: 3 }, { path: '0.1', size: -1 }]);
  });

  test('bounds malformed MIME discovery and caps attachment count and advertised bytes deterministically', () => {
    const attachment = (index: number, size = 1) => ({ mimeType: 'text/plain', filename: `part-${index}.txt`, body: { attachmentId: `id-${index}`, size } });
    const many = gmailAttachmentParts({ mimeType: 'multipart/mixed', parts: Array.from({ length: 30 }, (_, index) => attachment(index)) });
    expect(many).toHaveLength(MAX_GMAIL_ATTACHMENTS);
    expect(many.map(({ attachmentId }) => attachmentId)).toEqual(Array.from({ length: MAX_GMAIL_ATTACHMENTS }, (_, index) => `id-${index}`));

    const aggregate = gmailAttachmentParts({ mimeType: 'multipart/mixed', parts: [attachment(0, MAX_GMAIL_ATTACHMENT_BYTES - 1), attachment(1, 2), attachment(2, 1)] });
    expect(aggregate.map(({ attachmentId }) => attachmentId)).toEqual(['id-0', 'id-2']);

    let deep: any = attachment(999);
    for (let index = 0; index < 150; index += 1) deep = { mimeType: 'multipart/mixed', parts: [deep] };
    expect(gmailAttachmentParts(deep)).toEqual([]);
    expect(gmailAttachmentParts({ mimeType: 'multipart/mixed', parts: Array.from({ length: 20_000 }, (_, index) => index === 9_998 ? attachment(index) : { mimeType: 'multipart/mixed' }) })).toHaveLength(1);
  });

  test('validates exact canonical base64url bytes and advertised size', () => {
    expect(decodeGmailAttachmentData(Buffer.from('hello').toString('base64url'), 5)).toEqual(new TextEncoder().encode('hello'));
    expect(decodeGmailAttachmentData('', 0)).toEqual(new Uint8Array());
    expect(() => decodeGmailAttachmentData('a===', 1)).toThrow(GmailPermanentAttachmentError);
    expect(() => decodeGmailAttachmentData(Buffer.from('hello').toString('base64url'), 4)).toThrow(GmailPermanentAttachmentError);
    expect(() => decodeGmailAttachmentData('', 1)).toThrow(GmailPermanentAttachmentError);
  });

  test('accepts an inline zero-byte document without attempting a download', async () => {
    let downloads = 0;
    const client = createGmailClient('token', (async () => { downloads += 1; throw new Error('must not download'); }) as never);
    await expect(client.attachment('message', { path: '0', type: 'document', mimeType: 'text/plain', filename: 'empty.txt', size: 0, data: '' })).resolves.toEqual(new Uint8Array());
    expect(downloads).toBe(0);
  });

  test('covers canonical base64url edge cases and source size boundaries', () => {
    for (const encoded of ['YQ', 'YQ==', 'YWI', 'YWI=']) expect(decodeGmailAttachmentData(encoded, encoded.startsWith('YQ') ? 1 : 2)).toBeInstanceOf(Uint8Array);
    for (const encoded of ['A', 'YQ=', 'YWI==', 'YQ===', 'YQ+', 'YQ/', 'YR', ' YQ', 'YQ\n']) expect(() => decodeGmailAttachmentData(encoded, 1)).toThrow(GmailPermanentAttachmentError);
    expect(() => decodeGmailAttachmentData('YQ', MAX_GMAIL_ATTACHMENT_BYTES)).toThrowError(expect.objectContaining({ code: 'ATTACHMENT_SIZE_MISMATCH' }));
    expect(() => decodeGmailAttachmentData('YQ', MAX_GMAIL_ATTACHMENT_BYTES + 1)).toThrowError(expect.objectContaining({ code: 'ATTACHMENT_INVALID_SIZE' }));
  });

  test('enforces document source and image download size boundaries before processing bytes', async () => {
    let downloads = 0;
    const client = createGmailClient('token', (async () => { downloads += 1; return Response.json({ data: 'YQ' }); }) as unknown as typeof fetch);
    const document = { path: '0', type: 'document' as const, mimeType: 'text/plain', filename: 'large.txt', attachmentId: 'document' };
    await expect(client.attachment('message', { ...document, size: MAX_GMAIL_ATTACHMENT_BYTES })).rejects.toMatchObject({ code: 'ATTACHMENT_SIZE_MISMATCH' });
    await expect(client.attachment('message', { ...document, size: MAX_GMAIL_ATTACHMENT_BYTES + 1 })).rejects.toMatchObject({ code: 'ATTACHMENT_INVALID_SIZE' });
    const image = { path: '1', type: 'image' as const, mimeType: 'image/jpeg', filename: 'large.jpg', attachmentId: 'image' };
    await expect(client.attachment('message', { ...image, size: 20 * 1024 * 1024 })).rejects.toMatchObject({ code: 'ATTACHMENT_SIZE_MISMATCH' });
    await expect(client.attachment('message', { ...image, size: 20 * 1024 * 1024 + 1 })).rejects.toMatchObject({ code: 'ATTACHMENT_INVALID_SIZE' });
    expect(downloads).toBe(3);
  });

  test('accepts JPEG, GIF87a, GIF89a, and WebP signatures and rejects MIME mismatches', async () => {
    const cases = [
      ['image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], ['image/jpg', Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])],
      ['image/gif', new TextEncoder().encode('GIF87a-data')], ['image/gif', new TextEncoder().encode('GIF89a-data')],
      ['image/webp', new TextEncoder().encode('RIFFxxxxWEBP')],
    ] as const;
    const client = createGmailClient('token', (async () => { throw new Error('inline data must not download'); }) as never);
    for (const [mimeType, bytes] of cases) await expect(client.attachment('message', { path: '0', type: 'image', mimeType, filename: 'image.bin', size: bytes.byteLength, data: Buffer.from(bytes).toString('base64url') })).resolves.toEqual(bytes);
    const jpeg = cases[0][1];
    await expect(client.attachment('message', { path: '0', type: 'image', mimeType: 'image/png', filename: 'image.png', size: jpeg.byteLength, data: Buffer.from(jpeg).toString('base64url') })).rejects.toMatchObject({ code: 'ATTACHMENT_MALFORMED_PAYLOAD' });
  });

  test('normalizes Unicode, bidi, controls, paths, devices, and UTF-8 byte boundaries', () => {
    const fallback = (value: string, path: string) => expect(normalizeGmailAttachmentFilename(value, path, 'application/pdf')).toMatch(/^attachment-[a-f0-9]{12}\.pdf$/);
    expect(normalizeGmailAttachmentFilename('Cafe\u0301.PDF', '0.0', 'application/pdf')).toBe('Café.pdf');
    for (const [index, value] of ['safe\u202efile.pdf', 'safe\u0000file.pdf', '../file.pdf', 'C:\\file.pdf', 'NUL', 'COM9.txt', '.', '..', 'trailing.'].entries()) fallback(value, `0.${index}`);
    expect(normalizeGmailAttachmentFilename(`${'é'.repeat(125)}.txt`, '0.20', 'text/plain')).toBe(`${'é'.repeat(125)}.txt`);
    fallback(`${'é'.repeat(126)}.txt`, '0.21');
  });

  test('permanently rejects image bytes that do not match the declared MIME signature', async () => {
    const bytes = new TextEncoder().encode('not a png');
    const client = createGmailClient('token', (async () => { throw new Error('must not download inline data'); }) as never);
    await expect(client.attachment('message', { path: '0', type: 'image', mimeType: 'image/png', filename: 'image.png', size: bytes.byteLength, data: Buffer.from(bytes).toString('base64url') })).rejects.toMatchObject({ code: 'ATTACHMENT_MALFORMED_PAYLOAD', permanent: true });
  });
});
