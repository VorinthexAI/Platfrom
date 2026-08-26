import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { emailDevelopmentAttachmentAssets } from '@/lib/development-fixture-assets';

export const MAIL_DEV_SEED_EMAIL = 'oscar.burman005@gmail.com';
export const MAIL_DEV_FIXTURE_PREFIX = 'vorinthex-local-signal-v1';
export const MAIL_DEV_FIXTURE_AT = '2026-08-20T09:00:00.000Z';

const inboxes = [
  { slug: 'studio', name: 'Studio', description: 'Product, design, and launch work.', email: 'oscar.studio@signal.local' },
  { slug: 'personal', name: 'Personal', description: 'Friends, family, travel, and household mail.', email: 'oscar.personal@signal.local' },
  { slug: 'community', name: 'Community', description: 'Groups, events, newsletters, and volunteering.', email: 'oscar.community@signal.local' },
] as const;

const scenarios = [
  { slug: 'urgent-unread', subject: 'Urgent: approve tomorrow schedule', category: 'primary', inboxCategory: 'Urgent', priority: 'urgent', state: 'needs_action', unread: true, favorite: true, labels: ['INBOX', 'CATEGORY_PRIMARY', 'IMPORTANT', 'STARRED', 'UNREAD'] },
  { slug: 'important-unread', subject: 'Decision notes need your review', category: 'updates', inboxCategory: 'Important', priority: 'high', state: 'needs_action', unread: true, favorite: false, labels: ['INBOX', 'CATEGORY_UPDATES', 'IMPORTANT', 'UNREAD'] },
  { slug: 'urgent-read', subject: 'Time-sensitive venue confirmation', category: 'primary', inboxCategory: 'Urgent', priority: 'urgent', state: 'needs_action', unread: false, favorite: false, labels: ['INBOX', 'CATEGORY_PRIMARY', 'IMPORTANT'] },
  { slug: 'important-read', subject: 'Quarterly plan and decisions', category: 'forums', inboxCategory: 'Important', priority: 'high', state: 'done', unread: false, favorite: true, labels: ['INBOX', 'CATEGORY_FORUMS', 'IMPORTANT', 'STARRED'] },
  { slug: 'promotion', subject: 'A useful offer for the team', category: 'promotions', inboxCategory: 'Filtered', priority: 'low', state: 'filtered', unread: true, favorite: false, labels: ['INBOX', 'CATEGORY_PROMOTIONS', 'UNREAD'] },
  { slug: 'social', subject: 'You were mentioned in a photo', category: 'social', inboxCategory: 'Filtered', priority: 'low', state: 'filtered', unread: false, favorite: false, labels: ['INBOX', 'CATEGORY_SOCIAL'] },
  { slug: 'spam', subject: 'Unwanted prize notification', category: 'other', inboxCategory: 'Filtered', priority: 'low', state: 'filtered', unread: true, favorite: false, labels: ['SPAM', 'UNREAD'] },
  { slug: 'trash', subject: 'Old reservation receipt', category: 'updates', inboxCategory: 'Filtered', priority: 'low', state: 'done', unread: false, favorite: false, labels: ['TRASH', 'CATEGORY_UPDATES'] },
  { slug: 'primary-read', subject: 'Coffee and project catch-up', category: 'primary', inboxCategory: 'Important', priority: 'normal', state: 'waiting', unread: false, favorite: false, labels: ['INBOX', 'CATEGORY_PRIMARY'] },
] as const;

function thematicEmbedding(theme: string) {
  const values = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => {
    let hash = 2166136261;
    for (const character of `${theme}:${index % 31}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return ((hash >>> 0) % 2001 - 1000) / 1000;
  });
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return values.map((value) => value / magnitude);
}

export function mailDevFixtures(scopeKey: string, accountKeys?: readonly string[]) {
  const keys = accountKeys ?? inboxes.map((_, index) => `cmailfixtureaccount00000${index + 1}`);
  if (keys.length !== inboxes.length) throw new Error('Mail fixture account key count is invalid.');
  const accounts = inboxes.map((inbox, index) => ({ ...inbox, accountKey: keys[index]! }));
  const assets = emailDevelopmentAttachmentAssets(scopeKey);
  const threads = accounts.flatMap((account, accountIndex) => scenarios.map((scenario, scenarioIndex) => {
    const providerThreadId = `${MAIL_DEV_FIXTURE_PREFIX}:${account.slug}:${scenario.slug}`;
    const sender = `${scenario.slug}.${account.slug}@example.com`;
    const minute = accountIndex * 180 + scenarioIndex * 13;
    const firstAt = new Date(Date.parse(MAIL_DEV_FIXTURE_AT) + minute * 60_000).toISOString();
    const secondAt = new Date(Date.parse(firstAt) + 6 * 60_000).toISOString();
    const subject = `${account.name}: ${scenario.subject}`;
    const inboundBody = `Hi Oscar, this is the ${scenario.slug.replaceAll('-', ' ')} conversation for ${account.name}. Please review the concrete details and reply when appropriate.`;
    const outboundBody = `Thanks, I reviewed the ${account.name.toLowerCase()} details. I will follow up with the next step and keep everyone copied.`;
    const rootHeader = `<${providerThreadId}:1@example.com>`;
    const embedding = thematicEmbedding(`${account.slug}:${scenario.category}`);
    const attachmentRefs = accountIndex === 0 && scenarioIndex === 0
      ? [[assets[0]!, assets[1]!], [assets[5]!]]
      : accountIndex === 0 && scenarioIndex === 1
        ? [[assets[2]!, assets[3]!, assets[4]!, assets[6]!, assets[7]!, assets[8]!], []]
        : accountIndex === 1 && scenarioIndex === 0
          ? [[], [assets[5]!, assets[6]!]]
          : accountIndex === 2 && scenarioIndex === 1
            ? [[assets[4]!], [assets[8]!]]
            : [[], []];
    const attachmentFields = (attachments: typeof assets) => attachments.length
      ? { hasAttachments: true, attachmentAvailability: 'complete' as const, attachments: attachments.map(({ type, key }) => ({ type, key })) }
      : { hasAttachments: false, attachmentAvailability: 'none' as const };
    const messages = [
      { scopeKey, accountKey: account.accountKey, providerMessageId: `${providerThreadId}:1`, from: sender, fromName: `${account.name} Correspondent`, to: [MAIL_DEV_SEED_EMAIL], ...(scenarioIndex % 3 === 0 ? { cc: ['alex@example.com', 'team@example.com'] } : {}), subject, body: inboundBody, summary: inboundBody, direction: 'inbound' as const, sentAt: firstAt, ...attachmentFields(attachmentRefs[0]!), labels: [...scenario.labels], unread: scenario.unread, replyDepth: 0, messageIdHeader: rootHeader, inboxCategory: scenario.inboxCategory, embedding, embeddingContentVersion: 4 as const },
      { scopeKey, accountKey: account.accountKey, providerMessageId: `${providerThreadId}:2`, from: MAIL_DEV_SEED_EMAIL, to: [sender], ...(scenarioIndex % 3 === 0 ? { cc: ['alex@example.com', 'team@example.com'] } : {}), subject: `Re: ${subject}`, body: outboundBody, summary: outboundBody, direction: 'outbound' as const, sentAt: secondAt, ...attachmentFields(attachmentRefs[1]!), labels: ['SENT'], unread: false, replyDepth: 1, messageIdHeader: `<${providerThreadId}:2@example.com>`, inReplyTo: rootHeader, references: [rootHeader], parentMessageId: rootHeader, inboxCategory: scenario.inboxCategory, embedding, embeddingContentVersion: 4 as const },
    ];
    return {
      fixtureId: providerThreadId,
      thread: { scopeKey, accountKey: account.accountKey, providerThreadId, subject, summary: inboundBody, intent: scenario.state === 'filtered' ? 'Review low-priority mail' : 'Review the request', ...(scenario.state === 'needs_action' ? { action: 'Reply with a decision' } : {}), priority: scenario.priority, state: scenario.state, category: scenario.category, inboxCategory: scenario.inboxCategory, snippet: inboundBody, unread: scenario.unread, starred: scenario.labels.some((label) => label === 'STARRED'), labels: [...scenario.labels], latestFrom: sender, inInbox: true, lastMessageAt: secondAt, embedding, embeddingContentVersion: 4 as const, isFavorite: scenario.favorite },
      messages,
    };
  }));
  const tones = [
    { id: 'casual', slug: 'casual' as const, name: 'Casual', instruction: 'Use conversational language, natural contractions, and an approachable tone.', isFavorite: false },
    { id: 'formal', slug: 'formal' as const, name: 'Formal', instruction: 'Use professional language, complete sentences, and a clear conventional structure.', isFavorite: false },
    { id: 'direct', slug: 'direct' as const, name: 'Direct', instruction: 'Lead with the answer or action and avoid hedging.', isFavorite: false },
  ];
  const replyContext = [
    { id: 'availability', name: 'Availability', text: 'Avoid Friday meetings. Preferred meeting hours are 09:00-15:00 Europe/Stockholm.' },
    { id: 'decisions', name: 'Decision style', text: 'Lead with the decision, name one owner, and include an explicit due date.' },
    { id: 'travel', name: 'Travel preference', text: 'Prefer direct trains and flights. Do not book arrivals after 22:00.' },
    { id: 'introductions', name: 'Introductions', text: 'Ask both people before making an introduction and explain the mutual relevance.' },
    { id: 'signoff', name: 'Sign-off', text: 'Use "Best, Oscar" for formal mail and first name only for familiar correspondents.' },
  ];
  const drafts = [
    { id: 'studio-reply', variant: 'reply' as const, accountKey: accounts[0]!.accountKey, threadFixtureId: threads[0]!.fixtureId, messageProviderId: threads[0]!.messages[1]!.providerMessageId, replyMode: 'reply_all' as const, to: ['urgent-unread.studio@example.com'], cc: ['alex@example.com', 'team@example.com'], generatedContent: 'I can approve the schedule once the final owner is named.', finalContent: 'Approved. Alex owns the final schedule and will publish it by 15:00 today.', status: 'edited' as const, tone: 'Direct' },
    { id: 'personal-reply', variant: 'reply' as const, accountKey: accounts[1]!.accountKey, threadFixtureId: threads[9]!.fixtureId, messageProviderId: threads[9]!.messages[1]!.providerMessageId, replyMode: 'reply' as const, to: ['urgent-unread.personal@example.com'], cc: [], generatedContent: 'Tomorrow works for me. Shall we confirm the details?', status: 'generated' as const, tone: 'Casual' },
    { id: 'community-reply', variant: 'reply' as const, accountKey: accounts[2]!.accountKey, threadFixtureId: threads[19]!.fixtureId, messageProviderId: threads[19]!.messages[1]!.providerMessageId, replyMode: 'reply_all' as const, to: ['important-unread.community@example.com'], cc: ['alex@example.com'], generatedContent: 'Thank you for the notes. I have added comments and proposed owners.', finalContent: 'Thank you for the notes. My comments and proposed owners are now included.', status: 'edited' as const, tone: 'Formal' },
    { id: 'studio-new', variant: 'new' as const, accountKey: accounts[0]!.accountKey, to: ['maya@example.com'], cc: ['team@example.com'], subject: 'Launch decision recap', generatedContent: 'Here is the launch decision recap and the three assigned owners.', status: 'generated' as const, tone: 'Direct' },
    { id: 'personal-new', variant: 'new' as const, accountKey: accounts[1]!.accountKey, to: ['family@example.com'], subject: 'Weekend travel plan', generatedContent: 'The direct train leaves at 09:12. I suggest we meet at the platform at 08:55.', finalContent: 'The direct train leaves at 09:12. Let us meet at the platform at 08:55.', status: 'edited' as const, tone: 'Casual' },
    { id: 'community-new', variant: 'new' as const, accountKey: accounts[2]!.accountKey, to: ['volunteers@example.com'], bcc: ['organizer@example.com'], subject: 'Saturday volunteer briefing', generatedContent: 'Thank you for volunteering. The briefing starts at 10:00 by the main entrance.', status: 'generated' as const, tone: 'Formal' },
  ];
  return { accounts, threads, tones, replyContext, drafts };
}
