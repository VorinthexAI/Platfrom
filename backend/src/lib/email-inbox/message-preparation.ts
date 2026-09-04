import type { PreparedDocumentRepresentation } from '@/lib/ai/document-processing';
import type { EmailMessage, EmailThread } from './archive-payloads';
import { emailMessageSemanticText } from './archive-payloads';
import type { classifyEmailWithFallback } from './classification';
import { emailLabelsVisibleInInbox, inboxCategoryFor, type InboxCategory } from './classification';
import { emailMessageKey, emailThreadKey, type EmailRepository } from './repository';
import { latestEmailMessage } from './message-order';
import type { StagedEmailAttachment } from './attachment-ingestion';

type StoredFields = 'key' | 'threadKey' | 'createdAt' | 'updatedAt';
type PreparedMessageInput = Omit<EmailMessage, StoredFields | 'embedding' | 'embeddingContentVersion' | 'inboxCategory' | 'unread' | 'attachmentAvailability'> & Partial<Pick<EmailMessage, StoredFields | 'unread' | 'attachmentAvailability'>>;
type PreparedThreadInput = Omit<EmailThread, 'key' | 'createdAt' | 'updatedAt' | 'embedding' | 'embeddingContentVersion' | 'inboxCategory' | 'priority' | 'state' | 'category' | 'intent' | 'action' | 'labels' | 'starred' | 'isFavorite' | 'inInbox' | 'latestFrom' | 'lastMessageAt' | 'subject' | 'summary' | 'snippet' | 'unread'>;
type SyncThreadInput = Parameters<EmailRepository['syncThread']>[0];
type CurrentThreadInput = Omit<SyncThreadInput['thread'], 'embedding' | 'embeddingContentVersion' | 'archiveRepresentation'>;
type CurrentMessageInput = Omit<SyncThreadInput['messages'][number], 'embedding' | 'embeddingContentVersion' | 'archiveRepresentation'>;

function summary(value: string) { return value.replace(/\s+/g, ' ').trim().slice(0, 400) || '(Empty message)'; }
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
  const { key: _key, threadKey: _threadKey, scopeKey: _scopeKey, createdAt: _createdAt, updatedAt: _updatedAt, embedding: _embedding, archiveRepresentation: _representation, ...rest } = value;
  return rest;
}
export async function prepareAndPersistEmailThread(input: {
  thread: CurrentThreadInput;
  messages: CurrentMessageInput[];
  reconcileMessages?: boolean;
  prepareDocument: (input: { name: string; content: string; semanticSource: string }) => Promise<PreparedDocumentRepresentation>;
  repository: Pick<EmailRepository, 'syncThread'>;
  lease: { kind: 'sync' | 'send'; connectorKey: string; token: string };
  beforePersist: () => Promise<void>;
}) {
  if (!input.messages.length) throw new Error('Email thread has no messages');
  const threadKey = emailThreadKey(input.thread.scopeKey, input.thread.accountKey, input.thread.providerThreadId);
  const messages = await mapConcurrent(input.messages, PREPARATION_CONCURRENCY, async (message) => {
    const data = { ...message, embeddingContentVersion: 4 as const };
    const content = emailMessageSemanticText(message);
    const archiveRepresentation = await input.prepareDocument({ name: message.subject, content, semanticSource: content });
    return { ...data, embedding: archiveRepresentation.embedding, archiveRepresentation };
  }) as SyncThreadInput['messages'];
  const thread = { ...input.thread, embeddingContentVersion: 4 as const };
  const latest = latestEmailMessage(input.messages)!;
  const content = emailMessageSemanticText(latest);
  const archiveRepresentation = await input.prepareDocument({ name: thread.subject, content, semanticSource: content });
  await input.beforePersist();
  return input.repository.syncThread({
    thread: { ...thread, embedding: archiveRepresentation.embedding, archiveRepresentation },
    messages,
    reconcileMessages: input.reconcileMessages,
    lease: input.lease,
  });
}

export async function sortAndPersistInboxThread(input: {
  organizationKey: string;
  thread: PreparedThreadInput;
  messages: PreparedMessageInput[];
  reconcileMessages?: boolean;
  classify: typeof classifyEmailWithFallback;
  prepareDocument: (input: { name: string; content: string; semanticSource: string }) => Promise<PreparedDocumentRepresentation>;
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
    return { message, classification };
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
  const threadKey = emailThreadKey(input.thread.scopeKey, input.thread.accountKey, input.thread.providerThreadId);
  const messages = await mapConcurrent(classified, PREPARATION_CONCURRENCY, async ({ message, classification }) => {
    const { providerThreadId: _providerThreadId, ...messageFields } = withoutStored(message as unknown as Record<string, unknown>);
    const data = {
      ...messageFields,
      scopeKey: message.scopeKey,
      accountKey: message.accountKey,
      providerMessageId: message.providerMessageId,
      unread: message.unread ?? false,
      summary: summary(message.body),
      inboxCategory: inboxCategoryFor(message.labels ?? [], classification),
      embeddingContentVersion: 4 as const,
    };
    const content = emailMessageSemanticText(message);
    const archiveRepresentation = await input.prepareDocument({ name: message.subject, content, semanticSource: content });
    return { ...data, embedding: archiveRepresentation.embedding, archiveRepresentation };
  }) as Parameters<EmailRepository['syncThread']>[0]['messages'];
  const thread = {
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
    embedding: messages.find(({ providerMessageId }) => providerMessageId === latest.message.providerMessageId)!.embedding,
    embeddingContentVersion: 4 as const,
  };
  const content = emailMessageSemanticText(latest.message);
  const archiveRepresentation = await input.prepareDocument({ name: thread.subject, content, semanticSource: content });
  await input.beforePersist();
  return input.repository.syncThread({
    thread: { ...thread, embedding: archiveRepresentation.embedding, archiveRepresentation },
    messages,
    reconcileMessages: input.reconcileMessages,
    lease: input.lease,
    attachmentCommits: input.attachmentCommits,
  });
}
