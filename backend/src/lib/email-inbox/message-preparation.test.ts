import { describe, expect, test } from 'bun:test';
import { classifyEmbedAndPersistThread } from './message-preparation';

const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const connectorKey = 'cmrnlzf650002qc7k4p5zem5w';

describe('canonical mail preparation', () => {
  test('gives initial and incremental sync identical exactly-once classification, embeddings, and persistence', async () => {
    const messages = [
      { scopeKey, accountKey: connectorKey, providerMessageId: 'urgent', from: 'lead@example.com', to: ['me@example.com'], subject: 'Review', body: 'Urgent body', summary: 'old', labels: ['INBOX'], direction: 'inbound' as const, sentAt: '2026-08-23T10:00:00.000Z', hasAttachments: false, replyDepth: 0 },
      { scopeKey, accountKey: connectorKey, providerMessageId: 'trash', from: 'sender@example.com', fromName: 'Sender Name', to: ['me@example.com'], subject: 'Later', body: 'Filtered body', summary: 'old', labels: ['TRASH', 'STARRED'], direction: 'inbound' as const, sentAt: '2026-08-23T11:00:00.000Z', hasAttachments: false, replyDepth: 0 },
    ];
    const outcomes: unknown[] = [];
    for (const caller of ['initial sync', 'incremental sync']) {
      const classified: string[] = [], embedded: string[] = [], saved: unknown[] = [];
      await classifyEmbedAndPersistThread({
        organizationKey: 'org-1', thread: { scopeKey, accountKey: connectorKey, providerThreadId: 'thread' }, messages,
        classify: (async (_organization: string, input: { labels: string[]; body: string }) => { classified.push(input.body); return input.labels.includes('TRASH') ? { priority: 'low', state: 'filtered', category: 'other', intent: 'Filtered' } : { priority: 'urgent', state: 'needs_action', category: 'primary', intent: 'Urgent' }; }) as never,
        embed: (async ({ text }: { text: string }) => { embedded.push(text); return [text.length]; }) as never,
        repository: { syncThread: async (input: unknown) => { saved.push(input); return input; } } as never,
        beforePersist: async () => undefined,
        lease: { kind: 'sync', connectorKey, token: 'lease-token' },
      });
      expect(classified).toEqual(['Urgent body', 'Filtered body']);
      expect(embedded).toHaveLength(2);
      outcomes.push(saved[0]);
      expect(['initial sync', 'incremental sync']).toContain(caller);
    }
    expect(outcomes[0]).toEqual(outcomes[1]);
    expect(outcomes[0]).toMatchObject({ lease: { kind: 'sync', connectorKey, token: 'lease-token' } });
    expect(outcomes[0]).toMatchObject({ thread: { inboxCategory: 'Urgent', starred: false, isFavorite: false, inInbox: true, latestFrom: 'lead@example.com', labels: ['INBOX'] }, messages: [{ inboxCategory: 'Urgent' }, { inboxCategory: 'Filtered', fromName: 'Sender Name' }] });
    expect(JSON.stringify(outcomes[0])).not.toContain('Sender Name\\n\\nLater');
  });

  test('rejects duplicate provider message IDs before classification or persistence', async () => {
    let classifications = 0, writes = 0;
    const duplicate = { scopeKey, accountKey: connectorKey, providerMessageId: 'duplicate', from: 'sender@example.com', to: ['me@example.com'], subject: 'Subject', body: 'Body', summary: 'Body', direction: 'inbound' as const, sentAt: '2026-08-23T10:00:00.000Z', hasAttachments: false, replyDepth: 0 };
    await expect(classifyEmbedAndPersistThread({
      organizationKey: 'org-1', thread: { scopeKey, accountKey: connectorKey, providerThreadId: 'thread' }, messages: [duplicate, { ...duplicate, body: 'Conflicting duplicate' }],
      classify: (async () => { classifications += 1; return {}; }) as never,
      embed: (async () => [1]) as never,
      repository: { syncThread: async () => { writes += 1; return {}; } } as never,
      beforePersist: async () => undefined,
      lease: { kind: 'sync', connectorKey, token: 'lease-token' },
    })).rejects.toThrow('duplicate message IDs');
    expect({ classifications, writes }).toEqual({ classifications: 0, writes: 0 });
  });

  test('bounds classification and embedding concurrency for large provider threads', async () => {
    let activeClassifications = 0, maxClassifications = 0, activeEmbeddings = 0, maxEmbeddings = 0;
    const messages = Array.from({ length: 40 }, (_, index) => ({ scopeKey, accountKey: connectorKey, providerMessageId: `message-${index}`, from: 'sender@example.com', to: ['me@example.com'], subject: 'Subject', body: `Body ${index}`, summary: 'Body', direction: 'inbound' as const, sentAt: new Date(Date.parse('2026-08-23T10:00:00.000Z') + index).toISOString(), hasAttachments: false, replyDepth: 0 }));
    await classifyEmbedAndPersistThread({
      organizationKey: 'org-1', thread: { scopeKey, accountKey: connectorKey, providerThreadId: 'thread' }, messages,
      classify: (async () => { activeClassifications += 1; maxClassifications = Math.max(maxClassifications, activeClassifications); await Bun.sleep(1); activeClassifications -= 1; return { priority: 'normal', state: 'needs_action', category: 'primary', intent: 'Review' }; }) as never,
      embed: (async () => { activeEmbeddings += 1; maxEmbeddings = Math.max(maxEmbeddings, activeEmbeddings); await Bun.sleep(1); activeEmbeddings -= 1; return [1]; }) as never,
      repository: { syncThread: async (input: unknown) => input } as never,
      beforePersist: async () => undefined,
      lease: { kind: 'sync', connectorKey, token: 'lease-token' },
    });
    expect(maxClassifications).toBeLessThanOrEqual(8);
    expect(maxEmbeddings).toBeLessThanOrEqual(8);
    expect(maxClassifications).toBeGreaterThan(1);
  });

  test('derives thread state from visible Inbox messages without historical Trash or Spam contamination', async () => {
    const base = { scopeKey, accountKey: connectorKey, to: ['me@example.com'], summary: 'old', direction: 'inbound' as const, hasAttachments: false, replyDepth: 0 };
    const messages = [
      { ...base, providerMessageId: 'inbox', from: 'active@example.com', subject: 'Active reply', body: 'Current Inbox reply', labels: ['INBOX', 'UNREAD', 'STARRED'], sentAt: '2026-08-23T10:00:00.000Z' },
      { ...base, providerMessageId: 'trash', from: 'trash@example.com', subject: 'Old trash', body: 'Historical trash', labels: ['TRASH'], sentAt: '2026-08-23T11:00:00.000Z' },
      { ...base, providerMessageId: 'spam', from: 'spam@example.com', subject: 'Old spam', body: 'Historical spam', labels: ['SPAM'], sentAt: '2026-08-23T12:00:00.000Z' },
    ];
    let saved: any;
    await classifyEmbedAndPersistThread({
      organizationKey: 'org-1', thread: { scopeKey, accountKey: connectorKey, providerThreadId: 'thread' }, messages,
      classify: (async (_organization: string, input: { labels: string[] }) => input.labels.includes('INBOX') ? { priority: 'high', state: 'needs_action', category: 'primary', intent: 'Active' } : { priority: 'low', state: 'filtered', category: 'other', intent: 'Filtered' }) as never,
      embed: (async ({ text }: { text: string }) => [text.length]) as never,
      repository: { syncThread: async (input: unknown) => { saved = input; return input; } } as never,
      beforePersist: async () => undefined,
      lease: { kind: 'sync', connectorKey, token: 'lease-token' },
    });
    expect(saved.thread).toMatchObject({ subject: 'Active reply', latestFrom: 'active@example.com', state: 'needs_action', inboxCategory: 'Important', labels: ['INBOX', 'UNREAD', 'STARRED'], unread: true, starred: true, inInbox: true });
    expect(saved.messages.map(({ inboxCategory }: any) => inboxCategory)).toEqual(['Important', 'Filtered', 'Filtered']);
  });

  test('keeps Trash and Spam-only threads represented as Filtered', async () => {
    const base = { scopeKey, accountKey: connectorKey, from: 'sender@example.com', to: ['me@example.com'], summary: 'old', direction: 'inbound' as const, hasAttachments: false, replyDepth: 0 };
    let saved: any;
    await classifyEmbedAndPersistThread({
      organizationKey: 'org-1', thread: { scopeKey, accountKey: connectorKey, providerThreadId: 'thread' }, messages: [
        { ...base, providerMessageId: 'trash', subject: 'Trash', body: 'Trash', labels: ['TRASH'], sentAt: '2026-08-23T10:00:00.000Z' },
        { ...base, providerMessageId: 'spam', subject: 'Spam', body: 'Spam', labels: ['SPAM'], sentAt: '2026-08-23T11:00:00.000Z' },
      ],
      classify: (async () => ({ priority: 'low', state: 'filtered', category: 'other', intent: 'Filtered' })) as never,
      embed: (async () => [1]) as never,
      repository: { syncThread: async (input: unknown) => { saved = input; return input; } } as never,
      beforePersist: async () => undefined,
      lease: { kind: 'sync', connectorKey, token: 'lease-token' },
    });
    expect(saved.thread).toMatchObject({ subject: 'Spam', inboxCategory: 'Filtered', labels: ['TRASH', 'SPAM'], inInbox: true });
  });
});
