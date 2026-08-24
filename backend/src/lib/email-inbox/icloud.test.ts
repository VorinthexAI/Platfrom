import { describe, expect, test } from 'bun:test';
import { classifyICloudSmtpError, createICloudClient, ICloudApiError, iCloudMailboxRole, iCloudSmtpPayload, iCloudThreadId, isRetryableICloudError } from './icloud';

const credentials = { provider: 'icloud', username: 'person@icloud.com', appPassword: 'password' } as never;
const messageSource = (uid: number, extraHeaders = '') => Buffer.from(`From: sender@example.com\r\nTo: person@icloud.com\r\nSubject: Message ${uid}\r\nMessage-ID: <message-${uid}@example.com>\r\n${extraHeaders}\r\nBody ${uid}`);
const indexedMessage = (uid: number, messageId = `<message-${uid}@example.com>`) => ({ uid, envelope: { messageId }, headers: Buffer.from(''), flags: new Set<string>(), internalDate: new Date(1_700_000_000_000 + uid) });
const imapRunner = (client: unknown) => (async (_credentials: unknown, operation: (imap: unknown) => Promise<unknown>) => operation(client)) as never;

describe('iCloud connector protocol', () => {
  test('keeps Bcc recipients in the SMTP envelope but strips the transmitted header', () => {
    const payload = iCloudSmtpPayload([
      'From: sender@icloud.com',
      'To: visible@example.com',
      'Cc: copied@example.com',
      'Bcc: hidden@example.com',
      'Subject: Private recipients',
      '',
      'Body',
    ].join('\r\n'), 'sender@icloud.com');

    expect(payload.envelope).toEqual({ from: 'sender@icloud.com', to: ['visible@example.com', 'copied@example.com', 'hidden@example.com'] });
    expect(payload.raw).not.toContain('Bcc:');
    expect(payload.raw).toContain('Subject: Private recipients');
  });

  test('unfolds recipient headers and strips every Bcc header', () => {
    const payload = iCloudSmtpPayload('To: first@example.com,\r\n second@example.com\r\nBcc: hidden@example.com\r\nBcc: other@example.com\r\n\r\nBody', 'sender@icloud.com');
    expect(payload.envelope.to).toEqual(['first@example.com, second@example.com', 'hidden@example.com', 'other@example.com']);
    expect(payload.raw).not.toContain('Bcc:');
  });

  test('exposes provider not-found status for local reconciliation', () => {
    expect(new ICloudApiError('missing', false, 404)).toMatchObject({ status: 404, retryable: false });
  });

  test('groups replies under the root RFC822 Message-ID', () => {
    const root = iCloudThreadId({ messageId: '<root@example.com>' }, 'root-locator');
    const reply = iCloudThreadId({ messageId: '<reply@example.com>', inReplyTo: '<root@example.com>', references: ['<root@example.com>'] }, 'reply-locator');
    expect(reply).toBe(root);
  });

  test('recognizes localized special-use folders without English path matching', () => {
    const mailboxes = [{ path: 'Enviados', specialUse: '\\Sent' }, { path: 'Papelera', specialUse: '\\Trash' }];
    expect(iCloudMailboxRole(mailboxes as never, 'Enviados')).toBe('sent');
    expect(iCloudMailboxRole(mailboxes as never, 'Papelera')).toBe('trash');
  });

  test('classifies SMTP rejection, deferral, and transport uncertainty for service recovery', () => {
    expect(classifyICloudSmtpError({ responseCode: 535, code: 'EAUTH', command: 'AUTH PLAIN' })).toMatchObject({ status: 401, retryable: false, smtp: { responseCode: 535, deliveryUncertain: false } });
    expect(classifyICloudSmtpError({ responseCode: 550, code: 'EENVELOPE', command: 'RCPT TO' })).toMatchObject({ status: 422, retryable: false, smtp: { responseCode: 550, deliveryUncertain: false } });
    expect(classifyICloudSmtpError({ responseCode: 421, command: 'MAIL FROM' })).toMatchObject({ status: 503, retryable: true, smtp: { responseCode: 421, deliveryUncertain: false } });
    const beforeData = classifyICloudSmtpError({ code: 'ETIMEDOUT', command: 'CONN' });
    const afterData = classifyICloudSmtpError({ code: 'ETIMEDOUT', command: 'DATA' });
    expect(isRetryableICloudError(beforeData)).toBe(true);
    expect(beforeData).toMatchObject({ status: undefined, smtp: { deliveryUncertain: false } });
    expect(afterData).toMatchObject({ status: undefined, retryable: true, smtp: { deliveryUncertain: true } });
  });

  test('wraps Nodemailer errors as classified iCloud errors', async () => {
    const transport = (() => ({ sendMail: async () => { throw Object.assign(new Error('Mailbox unavailable'), { responseCode: 550, command: 'RCPT TO' }); } })) as never;
    const provider = createICloudClient(credentials, undefined, transport);
    await expect(provider.sendRaw('From: person@icloud.com\r\nTo: missing@example.com\r\nMessage-ID: <send@example.com>\r\n\r\nBody')).rejects.toMatchObject({ status: 422, retryable: false });
  });

  test('returns a complete authoritative Inbox snapshot beyond 100 messages in bounded fetch batches', async () => {
    const uids = Array.from({ length: 101 }, (_, index) => index + 1);
    const fetchSizes: number[] = [];
    const fetchQueries: unknown[] = [];
    let activeFetches = 0;
    let peakFetches = 0;
    const client = {
      list: async () => [{ path: 'INBOX', flags: new Set<string>() }],
      mailboxOpen: async () => ({ uidValidity: 1n }),
      search: async () => uids,
      fetchAll: async (requested: number[], query: unknown) => {
        fetchSizes.push(requested.length);
        fetchQueries.push(query);
        activeFetches += 1;
        peakFetches = Math.max(peakFetches, activeFetches);
        await Promise.resolve();
        activeFetches -= 1;
        return requested.map((uid) => indexedMessage(uid));
      },
    };
    const provider = createICloudClient(credentials, imapRunner(client));
    const listed = await provider.listThreads(100);
    expect(listed.threads).toHaveLength(101);
    expect('nextPageToken' in listed).toBe(false);
    expect(Math.max(...fetchSizes)).toBeLessThanOrEqual(50);
    expect(peakFetches).toBe(1);
    await provider.threadMetadata(listed.threads[0]!.id);
    expect(fetchSizes).toHaveLength(3);
    expect(fetchQueries.every((query) => !('source' in (query as object)))).toBe(true);
  });

  test('includes every selectable non-draft mailbox thread in the complete snapshot', async () => {
    const mailboxMessages = new Map([
      ['INBOX', [1]],
      ['Trash', [2]],
      ['Sent', [3]],
      ['Junk', [4]],
      ['Projects', [5]],
    ]);
    let selected = 'INBOX';
    const client = {
      list: async () => [
        { path: 'INBOX', flags: new Set<string>() },
        { path: 'Trash', specialUse: '\\Trash', flags: new Set<string>() },
        { path: 'Sent', specialUse: '\\Sent', flags: new Set<string>() },
        { path: 'Junk', specialUse: '\\Junk', flags: new Set<string>() },
        { path: 'Projects', flags: new Set<string>() },
        { path: 'Drafts', specialUse: '\\Draft', flags: new Set<string>() },
        { path: 'Container', flags: new Set(['\\Noselect']) },
      ],
      mailboxOpen: async (path: string) => { selected = path; return { uidValidity: BigInt(path.length) }; },
      search: async () => mailboxMessages.get(selected) ?? [],
      fetchAll: async (requested: number[]) => requested.map((uid) => indexedMessage(uid)),
    };
    const provider = createICloudClient(credentials, imapRunner(client));
    const listed = await provider.listThreads(100);
    expect(listed.threads).toHaveLength(5);
    expect('nextPageToken' in listed).toBe(false);
    const metadata = await Promise.all(listed.threads.map(({ id }) => provider.threadMetadata(id)));
    const locators = metadata.flatMap(({ messages }) => messages ?? []).map(({ id }) => JSON.parse(Buffer.from(id, 'base64url').toString('utf8')).mailbox).sort();
    expect(locators).toEqual(['INBOX', 'Junk', 'Projects', 'Sent', 'Trash']);
  });

  test('keeps a stable thread ID while an external Inbox-to-Trash move changes its locator', async () => {
    const snapshot = async (mailbox: 'INBOX' | 'Trash', uid: number, validity: bigint) => {
      const client = {
        list: async () => [{ path: mailbox, ...(mailbox === 'Trash' ? { specialUse: '\\Trash' } : {}), flags: new Set<string>() }],
        mailboxOpen: async () => ({ uidValidity: validity }),
        search: async () => [uid],
        fetchAll: async () => [indexedMessage(uid, '<stable-move@example.com>')],
      };
      const provider = createICloudClient(credentials, imapRunner(client));
      const thread = (await provider.listThreads()).threads[0]!;
      const metadata = await provider.threadMetadata(thread.id);
      return { threadId: thread.id, messageId: metadata.messages![0]!.id };
    };
    const before = await snapshot('INBOX', 7, 1n);
    const after = await snapshot('Trash', 70, 9n);
    expect(after.threadId).toBe(before.threadId);
    expect(after.messageId).not.toBe(before.messageId);
    expect(JSON.parse(Buffer.from(after.messageId, 'base64url').toString('utf8'))).toEqual({ mailbox: 'Trash', validity: '9', uid: 70 });
  });

  test('uses lightweight metadata for unchanged comparison and hydrates full MIME once on message access', async () => {
    const fetchQueries: Array<Record<string, unknown>> = [];
    const fetchOneQueries: Array<Record<string, unknown>> = [];
    let fullFetches = 0;
    const client = {
      list: async () => [{ path: 'INBOX', flags: new Set<string>() }],
      mailboxOpen: async () => ({ uidValidity: 4n }),
      search: async () => [11],
      fetchAll: async (_uids: number[], query: Record<string, unknown>) => {
        fetchQueries.push(query);
        return [{ ...indexedMessage(11, '<root@example.com>'), flags: new Set(['\\Seen', '\\Flagged']), internalDate: new Date('2026-08-25T10:00:00.000Z') }];
      },
      fetchOne: async (_uid: string, query: Record<string, unknown>) => {
        fetchOneQueries.push(query);
        fullFetches += 1;
        return { uid: 11, source: messageSource(11), flags: new Set(['\\Seen', '\\Flagged']), internalDate: new Date('2026-08-25T10:00:00.000Z') };
      },
    };
    const provider = createICloudClient(credentials, imapRunner(client));
    const thread = (await provider.listThreads()).threads[0]!;
    const firstMetadata = await provider.threadMetadata(thread.id);
    const secondMetadata = await provider.threadMetadata(thread.id);
    expect(firstMetadata).toEqual(secondMetadata);
    expect(firstMetadata.messages![0]).toMatchObject({ threadId: thread.id, labelIds: ['INBOX', 'STARRED'], internalDate: String(new Date('2026-08-25T10:00:00.000Z').getTime()) });
    expect(fetchQueries.every((query) => query.source === undefined && query.envelope === true && Array.isArray(query.headers))).toBe(true);
    expect(fullFetches).toBe(0);

    const id = firstMetadata.messages![0]!.id;
    const [first, second] = await Promise.all([provider.message(id), provider.message(id)]);
    expect(first.payload?.headers).toEqual(second.payload?.headers);
    expect(first.payload?.body?.data).toBeTruthy();
    expect(fullFetches).toBe(1);
    expect(fetchOneQueries[0]?.source).toEqual({ maxLength: 25 * 1024 * 1024 });
  });

  test('groups lightweight envelope and References metadata without fetching source', async () => {
    const queries: Array<Record<string, unknown>> = [];
    const client = {
      list: async () => [{ path: 'INBOX', flags: new Set<string>() }],
      mailboxOpen: async () => ({ uidValidity: 1n }),
      search: async () => [1, 2, 3],
      fetchAll: async (_uids: number[], query: Record<string, unknown>) => {
        queries.push(query);
        return [
          indexedMessage(1, '<root@example.com>'),
          { ...indexedMessage(2, '<reply@example.com>'), envelope: { messageId: '<reply@example.com>', inReplyTo: '<root@example.com>' } },
          { ...indexedMessage(3, '<deep-reply@example.com>'), headers: Buffer.from('References: <root@example.com>\r\n\t<reply@example.com>\r\n') },
        ];
      },
    };
    const provider = createICloudClient(credentials, imapRunner(client));
    const listed = await provider.listThreads();
    expect(listed.threads).toHaveLength(1);
    expect((await provider.threadMetadata(listed.threads[0]!.id)).messages).toHaveLength(3);
    expect(queries.every((query) => query.source === undefined)).toBe(true);
  });

  test('throws classified errors when IMAP flag and move operations return false', async () => {
    const client = {
      capabilities: new Map([['MOVE', true]]),
      list: async () => [{ path: 'INBOX', flags: new Set<string>() }, { path: 'Trash', specialUse: '\\Trash', flags: new Set<string>() }],
      mailboxOpen: async () => ({ uidValidity: 1n }),
      search: async () => [7],
      fetchAll: async () => [indexedMessage(7)],
      messageFlagsAdd: async () => false,
      messageFlagsRemove: async () => false,
      messageMove: async () => false,
    };
    const provider = createICloudClient(credentials, imapRunner(client));
    const thread = (await provider.listThreads()).threads[0]!;
    await expect(provider.modifyThread(thread.id, [], ['UNREAD'])).rejects.toBeInstanceOf(ICloudApiError);
    await expect(provider.modifyThread(thread.id, ['UNREAD'], [])).rejects.toMatchObject({ status: 502, retryable: false });
    await expect(provider.trashThread(thread.id)).rejects.toMatchObject({ status: 502, retryable: false });
  });

  test('retains MOVE destination UID mapping when UIDPLUS returns it', async () => {
    const client = {
      capabilities: new Map([['MOVE', true]]),
      list: async () => [{ path: 'INBOX', flags: new Set<string>() }, { path: 'Trash', specialUse: '\\Trash', flags: new Set<string>() }],
      mailboxOpen: async () => ({ uidValidity: 1n }),
      search: async () => [7],
      fetchAll: async () => [indexedMessage(7)],
      messageMove: async () => ({ path: 'INBOX', destination: 'Trash', uidValidity: 9n, uidMap: new Map([[7, 70]]) }),
    };
    const provider = createICloudClient(credentials, imapRunner(client));
    const thread = (await provider.listThreads()).threads[0]!;
    const moved = await provider.trashThread(thread.id);
    const locator = JSON.parse(Buffer.from(moved.messages![0]!.id, 'base64url').toString('utf8'));
    expect(locator).toEqual({ mailbox: 'Trash', validity: '9', uid: 70 });
  });

  test('uses a monotonic UID Trash cursor when messages disappear between pages', async () => {
    let page = 0;
    const client = {
      list: async () => [{ path: 'Trash', specialUse: '\\Trash', flags: new Set<string>() }],
      mailboxOpen: async () => ({ uidValidity: 1n }),
      search: async () => page++ === 0 ? [1, 2, 3] : [2, 3, 4],
      fetchAll: async (requested: number[]) => requested.map((uid) => ({ uid, source: messageSource(uid), flags: new Set<string>(), internalDate: new Date() })),
    };
    const provider = createICloudClient(credentials, imapRunner(client));
    const first = await provider.listTrashMessages(2);
    const second = await provider.listTrashMessages(2, first.nextPageToken);
    const decoded = [...first.messages!, ...second.messages!].map(({ id }) => JSON.parse(Buffer.from(id, 'base64url').toString('utf8')).uid);
    expect(first.nextPageToken).toBe('2');
    expect(decoded).toEqual([1, 2, 3, 4]);
  });

  test('lists the special-use Trash mailbox and permanently deletes its IMAP messages', async () => {
    const deleted: number[] = [];
    const source = Buffer.from('From: sender@example.com\r\nTo: person@icloud.com\r\nSubject: Deleted\r\nMessage-ID: <deleted@example.com>\r\n\r\nBody');
    const client = {
      list: async () => [{ path: 'Papelera', specialUse: '\\Trash', flags: new Set<string>() }],
      mailboxOpen: async () => ({ uidValidity: 1n }),
      search: async () => [7],
      fetchAll: async () => [{ uid: 7, source, flags: new Set<string>(), internalDate: new Date('2026-08-24T00:00:00.000Z') }],
      messageFlagsAdd: async () => true,
      messageDelete: async (uids: number[]) => { deleted.push(...uids); return true; },
    };
    const provider = createICloudClient(credentials, imapRunner(client));
    const listed = await provider.listTrashMessages();
    expect(listed.messages).toHaveLength(1);
    await provider.batchDeleteMessages(listed.messages!.map(({ id }) => id));
    expect(deleted).toEqual([7]);
  });

  test('rejects false permanent deletion and refuses unsafe expunge without UIDPLUS', async () => {
    let deletes = 0;
    const makeProvider = (capabilities: Map<string, boolean>, result: boolean) => createICloudClient(credentials, imapRunner({
      capabilities,
      list: async () => [{ path: 'Trash', specialUse: '\\Trash', flags: new Set<string>() }],
      mailboxOpen: async () => ({ uidValidity: 1n }),
      search: async () => [7],
      fetchAll: async () => [{ uid: 7, source: messageSource(7), flags: new Set<string>(), internalDate: new Date() }],
      messageFlagsAdd: async () => true,
      messageDelete: async () => { deletes += 1; return result; },
    }));
    const unsafe = makeProvider(new Map(), true);
    const unsafeMessage = (await unsafe.listTrashMessages()).messages![0]!;
    await expect(unsafe.batchDeleteMessages([unsafeMessage.id])).rejects.toMatchObject({ status: 501, retryable: false });
    expect(deletes).toBe(0);

    const failed = makeProvider(new Map([['UIDPLUS', true]]), false);
    const failedMessage = (await failed.listTrashMessages()).messages![0]!;
    await expect(failed.batchDeleteMessages([failedMessage.id])).rejects.toMatchObject({ status: 502, retryable: false });
    expect(deletes).toBe(1);
  });
});
