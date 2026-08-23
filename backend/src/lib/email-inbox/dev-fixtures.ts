import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';

export const MAIL_DEV_SEED_EMAIL = 'oscar.burman005@gmail.com';

export function mailDevFixtures(scopeKey: string, accountKey: string, at = '2026-08-20T09:00:00.000Z') {
  const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);
  const threads = [
    {
      thread: { scopeKey, accountKey, providerThreadId: 'dev-product-review', subject: 'Product review follow-up', summary: 'Could we review the launch notes tomorrow?', intent: 'Schedule a review', action: 'Confirm a time', priority: 'high' as const, state: 'needs_action' as const, category: 'primary' as const, snippet: 'Could we review the launch notes tomorrow?', unread: true, starred: false, labels: ['INBOX', 'IMPORTANT'], latestFrom: 'maya.chen@example.com', inInbox: true, lastMessageAt: at, embedding, embeddingContentVersion: 2 as const, isFavorite: true },
      messages: [
        { scopeKey, accountKey, providerMessageId: 'dev-product-review-1', from: 'maya.chen@example.com', to: [MAIL_DEV_SEED_EMAIL], subject: 'Product review follow-up', body: 'Hi Oscar, could we review the launch notes tomorrow afternoon? I highlighted the three decisions that still need owners.', summary: 'Could we review the launch notes tomorrow?', direction: 'inbound' as const, sentAt: at, hasAttachments: false, labels: ['INBOX', 'IMPORTANT'], unread: true, replyDepth: 0, embedding, embeddingContentVersion: 2 as const },
        { scopeKey, accountKey, providerMessageId: 'dev-product-review-2', from: MAIL_DEV_SEED_EMAIL, to: ['maya.chen@example.com'], subject: 'Re: Product review follow-up', body: 'Tomorrow at 14:00 works. I will add owners to the decision list before then.', summary: 'Tomorrow at 14:00 works.', direction: 'outbound' as const, sentAt: '2026-08-20T09:15:00.000Z', hasAttachments: false, labels: ['SENT'], unread: false, replyDepth: 1, parentMessageId: '<dev-product-review-1@example.com>', embedding, embeddingContentVersion: 2 as const },
      ],
    },
    {
      thread: { scopeKey, accountKey, providerThreadId: 'dev-research-summary', subject: 'Research synthesis ready', summary: 'The interview synthesis is ready for feedback.', intent: 'Review research', action: 'Read and comment', priority: 'normal' as const, state: 'needs_action' as const, category: 'updates' as const, snippet: 'The interview synthesis is ready.', unread: true, starred: false, labels: ['INBOX', 'CATEGORY_UPDATES'], latestFrom: 'jonas@example.com', inInbox: true, lastMessageAt: '2026-08-21T11:30:00.000Z', embedding, embeddingContentVersion: 2 as const, isFavorite: false },
      messages: [{ scopeKey, accountKey, providerMessageId: 'dev-research-summary-1', from: 'jonas@example.com', to: [MAIL_DEV_SEED_EMAIL], subject: 'Research synthesis ready', body: 'The synthesis is ready. The strongest theme is that teams want fewer handoffs and clearer ownership. Feedback by Friday would be useful.', summary: 'The interview synthesis is ready for feedback.', direction: 'inbound' as const, sentAt: '2026-08-21T11:30:00.000Z', hasAttachments: false, labels: ['INBOX', 'CATEGORY_UPDATES'], unread: true, replyDepth: 0, embedding, embeddingContentVersion: 2 as const }],
    },
  ];
  return { threads };
}
