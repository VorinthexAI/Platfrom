import type { embedText } from '@/lib/embeddings';
import type { EmailMessage, EmailThread } from './archive-payloads';
import { emailMessageSemanticText } from './archive-payloads';
import type { classifyEmailWithFallback } from './classification';
import { emailLabelsVisibleInInbox, inboxCategoryFor, type InboxCategory } from './classification';
import type { EmailRepository } from './repository';
import { latestEmailMessage } from './message-order';
import type { StagedEmailAttachment } from './attachment-ingestion';

type StoredFields = 'key' | 'threadKey' | 'createdAt' | 'updatedAt';
type PreparedMessageInput = Omit<EmailMessage, StoredFields | 'embedding' | 'embeddingContentVersion' | 'inboxCategory' | 'unread' | 'attachmentAvailability'> & Partial<Pick<EmailMessage, StoredFields | 'unread' | 'attachmentAvailability'>>;
type PreparedThreadInput = Omit<EmailThread, 'key' | 'createdAt' | 'updatedAt' | 'embedding' | 'embeddingContentVersion' | 'inboxCategory' | 'priority' | 'state' | 'category' | 'intent' | 'action' | 'labels' | 'starred' | 'isFavorite' | 'inInbox' | 'latestFrom' | 'lastMessageAt' | 'subject' | 'summary' | 'snippet' | 'unread'>;

function summary(value: string) { return value.replace(/\s+/g, ' ').trim().slice(0, 400) || '(Empty message)'; }
function bounded(value: string) { return value.slice(0, 24_000); }
const PREPARATION_CONCURRENCY = 8;
async function mapConcurrent<T, R>(values: T[], concurrency: number, operation: (value: T) => Promise<R>) {
  const results = new Array<R>(values.length);
  let next = 0;
  const workers = await Promise.allSettled(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await operation(values[index]!);
    }
  }));
  const failure = workers.find((worker): worker is PromiseRejectedResult => worker.status === 'rejected');
  if (failure) throw failure.reason;
  return results;
}
function withoutStored<T extends Record<string, unknown>>(value: T) {
  const { key: _key, threadKey: _threadKey, providerThreadId: _providerThreadId, createdAt: _createdAt, updatedAt: _updatedAt, embedding: _embedding, embeddingContentVersion: _version, inboxCategory: _category, ...rest } = value;
  return rest;
}

export async function classifyEmbedAndPersistThread(input: {
  organizationKey: string;
  thread: PreparedThreadInput;
  messages: PreparedMessageInput[];
  reconcileMessages?: boolean;
  classify: typeof classifyEmailWithFallback;
  embed: typeof embedText;
  repository: Pick<EmailRepository, 'syncThread'>;
  lease: { kind: 'sync'; connectorKey: string; token: string };
  beforePersist: () => Promise<void>;
  attachmentCommits?: StagedEmailAttachment[];
}) {
  if (!input.messages.length) throw new Error('Email thread has no messages');
  if (new Set(input.messages.map(({ providerMessageId }) => providerMessageId)).size !== input.messages.length) throw new Error('Email provider thread contains duplicate message IDs');
  const classified = await mapConcurrent(input.messages, PREPARATION_CONCURRENCY, async (message) => {
    const classification = await input.classify(input.organizationKey, {
      labels: message.labels ?? [], subject: message.subject, from: message.from, body: message.body, direction: message.direction,
    });
    const embedding = await input.embed({ text: bounded(emailMessageSemanticText(message)) });
    return { message, classification, embedding };
  });
  const visible = classified.filter(({ message }) => message.labels?.includes('INBOX'));
  const relevant = visible.length ? visible : classified;
  const latestMessage = latestEmailMessage(relevant.map(({ message }) => message))!;
  const latest = relevant.find(({ message }) => message.providerMessageId === latestMessage.providerMessageId)!;
  const labels = [...new Set(relevant.flatMap(({ message }) => message.labels ?? []))];
  const inboxCategory: InboxCategory = relevant.some(({ message, classification }) => inboxCategoryFor(message.labels ?? [], classification) === 'Filtered')
    ? 'Filtered'
    : relevant.some(({ message, classification }) => inboxCategoryFor(message.labels ?? [], classification) === 'Urgent') ? 'Urgent' : 'Important';
  const starred = labels.includes('STARRED');
  const messages = classified.map(({ message, classification, embedding }) => ({
    ...withoutStored(message as unknown as Record<string, unknown>),
    scopeKey: message.scopeKey,
    accountKey: message.accountKey,
    providerMessageId: message.providerMessageId,
    unread: message.unread ?? false,
    summary: summary(message.body),
    inboxCategory: inboxCategoryFor(message.labels ?? [], classification),
    embedding,
    embeddingContentVersion: 3 as const,
  })) as Parameters<EmailRepository['syncThread']>[0]['messages'];
  await input.beforePersist();
  return input.repository.syncThread({
    thread: {
      ...input.thread,
      subject: latest.message.subject,
      summary: summary(latest.message.body),
      snippet: summary(latest.message.body),
      intent: latest.classification.intent,
      ...(latest.classification.action ? { action: latest.classification.action } : {}),
      priority: latest.classification.priority,
      state: latest.classification.state,
      category: latest.classification.category,
      inboxCategory,
      unread: labels.includes('UNREAD'),
      starred,
      isFavorite: starred,
      labels,
      latestFrom: latest.message.from,
      inInbox: emailLabelsVisibleInInbox(labels),
      lastMessageAt: latest.message.sentAt,
      embedding: latest.embedding,
      embeddingContentVersion: 3,
    },
    messages,
    reconcileMessages: input.reconcileMessages,
    lease: input.lease,
    attachmentCommits: input.attachmentCommits,
  });
}
