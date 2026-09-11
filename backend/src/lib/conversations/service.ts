import { createHash } from 'node:crypto';
import { z } from 'zod';
import { newId } from '@/lib/ids';
import { embedText } from '@/lib/embeddings';
import { coreAgent, executeCoreAgent } from '@/lib/ai/agents/core';
import type { AgentRuntimeDependencies } from '@/lib/ai/agents';
import type { ExecuteActionOptions } from '@/lib/ai/router';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { getDefaultUserSearchService, type UserSearchService } from '@/lib/user-searches/service';
import { appSearchCountOutputSchema, appSearchSumOutputSchema, projectAppSearchRetrieval, type AppSearchCountOutput, type AppSearchRetrieval, type AppSearchSumOutput } from '@/lib/app-search/service';
import { documentStorage, type DocumentObjectStorage } from '@/lib/ai/document-processing';
import { managedImageGenerateInputSchema } from '@/lib/image-generation/service';
import { projectToolResultRetrieval } from './tool-retrieval';
import { getDefaultConversationRepository, type ConversationRepository } from './repository';
import { prepareConversationAttachments, type ConversationAttachmentPersistenceDependencies } from './attachment-persistence';
import { getDefaultConversationAttachmentArtifactRepository, type ConversationAttachmentArtifactRepository } from './attachment-artifacts';
import {
  conversationCreateInputSchema, conversationFavoriteInputSchema, conversationImageTurnInputSchema, conversationImageTurnResultSchema, conversationKeyInputSchema,
  conversationListInputSchema, conversationMessageDeleteInputSchema, conversationMessageDeleteResultSchema, conversationMessageListInputSchema, conversationRenameInputSchema, conversationSafeMessageSchema,
  conversationSearchInputSchema, conversationSendInputSchema, decodeCursor, encodeCursor, projectConversationMessage,
  type Conversation, type ConversationMessage,
} from './schemas';

const conversationCursorSchema = z.object({ favorite: z.boolean(), updatedAt: z.string().datetime(), key: z.string().cuid() }).strict();
const messageCursorSchema = z.object({ createdAt: z.string().datetime(), key: z.string().cuid() }).strict();
const MAX_CONTEXT_BYTES = 250_000;

function exactAggregateFallback(results: readonly (AppSearchCountOutput | AppSearchSumOutput)[]) {
  const sums = results.filter((result): result is AppSearchSumOutput => result.operation === 'sum');
  if (sums.length) return sums.flatMap((result) => result.groups.map(({ matchedCount, sum, unit }) => `${matchedCount} matching resources; ${sum} ${unit}`)).join('\n');
  const counts = results.flatMap((result) => result.operation === 'count' ? result.groups.map(({ collectionSlug, count }) => ({ collectionSlug, count })) : []);
  if (counts.length === 1) return String(counts[0]!.count);
  return counts.map(({ collectionSlug, count }) => `${collectionSlug}: ${count}`).join('\n');
}

export type ConversationTurnEvent =
  | { type: 'start'; correlationKey: string; conversationKey: string; userMessageKey: string; assistantMessageKey: string; userMessage: z.infer<typeof conversationSafeMessageSchema> }
  | { type: 'delta'; correlationKey: string; assistantMessageKey: string; text: string }
  | { type: 'done'; correlationKey: string; conversationKey: string; message: z.infer<typeof conversationSafeMessageSchema>; name?: string; replayed: boolean }
  | { type: 'error'; correlationKey: string; code: string; message: string };

export interface ConversationService {
  create(raw: unknown, context: ToolContext): Promise<Conversation>;
  list(raw: unknown, context: ToolContext): Promise<{ items: Conversation[]; nextCursor: string | null }>;
  search(raw: unknown, context: ToolContext): Promise<{ items: Conversation[]; nextCursor: string | null }>;
  rename(raw: unknown, context: ToolContext): Promise<Conversation>;
  favorite(raw: unknown, context: ToolContext): Promise<Conversation>;
  delete(raw: unknown, context: ToolContext): Promise<{ deletedKey: string }>;
  deleteMessage(raw: unknown, context: ToolContext): Promise<{ deletedKeys: string[] }>;
  messages(raw: unknown, context: ToolContext): Promise<{ items: Array<z.infer<typeof conversationSafeMessageSchema>>; nextCursor: string | null }>;
  turn(raw: unknown, context: ToolContext, onEvent: (event: ConversationTurnEvent) => void | Promise<void>): Promise<void>;
  enqueueImageTurn(raw: unknown, context: ToolContext, stagedImageArtifactKeys?: readonly string[]): Promise<z.infer<typeof conversationImageTurnResultSchema>>;
}

export class ConversationError extends Error {
  constructor(readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'FAILED', message: string) { super(message); }
}

type Owner = { teamKey: string; scopeKey: string; userKey: string };
function owner(context: ToolContext): Owner {
  if (context.principal.kind !== 'member' || context.principal.userTeam.status !== 'active') throw new ConversationError('FORBIDDEN', 'An active user team membership is required.');
  if (context.principal.userTeam.teamKey !== context.teamKey || context.principal.userTeam.userId !== context.principal.user.key) throw new ConversationError('FORBIDDEN', 'Membership does not belong to the selected user and team.');
  return { teamKey: context.teamKey, scopeKey: context.runtimeScopeKey, userKey: context.principal.user.key };
}

export function conversationReferenceContext(retrievals: readonly AppSearchRetrieval[]) {
  let ordinal = 0;
  return retrievals.map((retrieval) => ({
    ...(retrieval.query ? { query: retrieval.query } : {}),
    references: retrieval.groups.flatMap((group) => group.results.map((result) => ({
      ordinal: ++ordinal,
      collectionSlug: group.collectionSlug,
      label: result.label,
      ...(result.destinationCollectionSlug ? { destinationCollectionSlug: result.destinationCollectionSlug } : {}),
    }))),
  }));
}

function projectAgentContext(messages: ConversationMessage[]) {
  return messages.map((item) => {
    const retrievalContext = item.retrievals.length ? `\n\nTyped historical resource references (ordinals support phrases such as "the second one"; re-run app.search before relying on current resource state): ${JSON.stringify(conversationReferenceContext(item.retrievals))}` : '';
    return { role: item.role.toLowerCase() as 'user' | 'assistant', content: item.content.length + retrievalContext.length <= 100_000 ? item.content + retrievalContext : item.content, createdAt: item.createdAt };
  });
}

function prioritizedAgentContext(recentMessages: ConversationMessage[], recalledMessages: ConversationMessage[]) {
  const context = projectAgentContext(recentMessages);
  while (context.length && Buffer.byteLength(JSON.stringify({ context, recalledContext: [] }), 'utf8') > MAX_CONTEXT_BYTES) context.shift();
  const recalledByRelevance = projectAgentContext(recalledMessages);
  while (recalledByRelevance.length) {
    const recalledContext = [...recalledByRelevance].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    if (Buffer.byteLength(JSON.stringify({ context, recalledContext }), 'utf8') <= MAX_CONTEXT_BYTES) return { context, recalledContext };
    recalledByRelevance.pop();
  }
  return { context, recalledContext: [] };
}

function rethrowAbort(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
}

export interface ConversationServiceDependencies {
  repository?: ConversationRepository;
  id?: () => string;
  now?: () => string;
  embed?: typeof embedText;
  agent?: AgentRuntimeDependencies;
  router?: ExecuteActionOptions;
  core?: typeof executeCoreAgent;
  userSearches?: UserSearchService;
  attachmentArtifacts?: Pick<ConversationAttachmentArtifactRepository, 'readClaimed'>;
  attachmentStorage?: Pick<DocumentObjectStorage, 'download'> & Partial<Pick<DocumentObjectStorage, 'delete'>>;
  prepareAttachments?: typeof prepareConversationAttachments;
  attachmentPersistence?: Omit<ConversationAttachmentPersistenceDependencies, 'storage'>;
  enqueueAttachmentJob?: (input: unknown) => Promise<unknown>;
  enqueueImageJob?: (input: unknown) => Promise<unknown>;
}

export function createConversationService(dependencies: ConversationServiceDependencies = {}): ConversationService {
  const repository = dependencies.repository ?? getDefaultConversationRepository();
  const id = dependencies.id ?? newId;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const embed = dependencies.embed ?? embedText;
  const core = dependencies.core ?? executeCoreAgent;
  const agentDependencies: AgentRuntimeDependencies = { ...dependencies.agent, router: { ...dependencies.agent?.router, ...dependencies.router } };
  const userSearches = dependencies.userSearches ?? getDefaultUserSearchService();
  const attachmentArtifacts = dependencies.attachmentArtifacts ?? getDefaultConversationAttachmentArtifactRepository();
  const attachmentStorage = dependencies.attachmentStorage ?? documentStorage;
  const prepareAttachments = dependencies.prepareAttachments ?? prepareConversationAttachments;
  let service: ConversationService;

  const page = async (context: ToolContext, raw: unknown, query?: string) => {
    const input = query === undefined ? conversationListInputSchema.parse(raw) : conversationSearchInputSchema.parse(raw);
    const rows = await repository.list(owner(context), { ...(query === undefined ? {} : { query }), cursor: decodeCursor(input.cursor, conversationCursorSchema), limit: input.limit + 1, favoriteOnly: input.favoriteOnly });
    const hasMore = rows.length > input.limit; const items = rows.slice(0, input.limit); const last = items.at(-1);
    return { items, nextCursor: hasMore && last ? encodeCursor({ favorite: last.isFavorite, updatedAt: last.updatedAt, key: last.key }) : null };
  };

  service = {
    async create(raw: unknown, context: ToolContext) { const input = conversationCreateInputSchema.parse(raw), at = now(); return repository.create({ key: id(), ...owner(context), name: input.name ?? 'New chat', isFavorite: false, createdAt: at, updatedAt: at }); },
    list(raw: unknown, context: ToolContext) { return page(context, raw); },
    async search(raw: unknown, context: ToolContext) { const input = conversationSearchInputSchema.parse(raw), ownership = owner(context); const result = await page(context, input, input.query); if (input.recordHistory) await userSearches.record(ownership.userKey, input.query); return result; },
    async rename(raw: unknown, context: ToolContext) { const input = conversationRenameInputSchema.parse(raw); const value = await repository.update(owner(context), input.conversationKey, { name: input.name, updatedAt: now() }); if (!value) throw new ConversationError('NOT_FOUND', 'Conversation not found.'); return value; },
    async favorite(raw: unknown, context: ToolContext) { const input = conversationFavoriteInputSchema.parse(raw); const value = await repository.update(owner(context), input.conversationKey, { isFavorite: input.isFavorite, updatedAt: now() }); if (!value) throw new ConversationError('NOT_FOUND', 'Conversation not found.'); return value; },
    async delete(raw: unknown, context: ToolContext) { const input = conversationKeyInputSchema.parse(raw); if (!await repository.delete(owner(context), input.conversationKey)) throw new ConversationError('NOT_FOUND', 'Conversation not found.'); return { deletedKey: input.conversationKey }; },
    async deleteMessage(raw: unknown, context: ToolContext) { const input = conversationMessageDeleteInputSchema.parse(raw); const deletedKeys = await repository.deleteMessageTurn(owner(context), input.conversationKey, input.messageKey, now()); if (!deletedKeys) throw new ConversationError('NOT_FOUND', 'Conversation message not found or cannot be deleted while its response is pending.'); return conversationMessageDeleteResultSchema.parse({ deletedKeys }); },
    async messages(raw: unknown, context: ToolContext) { const input = conversationMessageListInputSchema.parse(raw); const rows = await repository.listMessages(owner(context), input.conversationKey, decodeCursor(input.cursor, messageCursorSchema), input.limit + 1); if (!rows) throw new ConversationError('NOT_FOUND', 'Conversation not found.'); const hasMore = rows.length > input.limit; const items = hasMore ? rows.slice(1) : rows; const first = items[0]; return { items: items.map(projectConversationMessage), nextCursor: hasMore && first ? encodeCursor({ createdAt: first.createdAt, key: first.key }) : null }; },
    async turn(raw: unknown, context: ToolContext, onEvent: (event: ConversationTurnEvent) => void | Promise<void>) {
      const input = conversationSendInputSchema.parse(raw), ownership = owner(context), correlationKey = id(), at = now();
      const assistantAt = new Date(new Date(at).getTime() + 1).toISOString();
      const requestHash = createHash('sha256').update(JSON.stringify({ conversationKey: input.conversationKey, message: input.message, attachmentKeys: input.attachmentKeys, referenceImageKeys: input.referenceImageKeys })).digest('hex');
      const actorKey = context.principal.kind === 'member' ? context.principal.userTeam.key : '';
      const started = await repository.beginTurn(ownership, input.conversationKey,
        { key: id(), ...ownership, conversationKey: input.conversationKey, turnKey: input.requestKey, requestHash, type: 'TEXT', role: 'USER', status: 'COMPLETED', content: input.message, attachments: [], attachmentStatus: input.attachmentKeys.length ? 'PENDING' : 'NONE', ...(input.attachmentKeys.length ? { pendingAttachmentKeys: input.attachmentKeys } : {}), retrievals: [], createdAt: at, completedAt: at },
        { key: id(), ...ownership, conversationKey: input.conversationKey, turnKey: input.requestKey, requestHash, type: 'TEXT', role: 'ASSISTANT', status: 'PENDING', content: 'Pending', attachments: [], attachmentStatus: 'NONE', retrievals: [], createdAt: assistantAt }, actorKey);
      if (!started) throw new ConversationError('NOT_FOUND', 'Conversation not found.');
      if (started.state === 'idempotency-conflict') throw new ConversationError('CONFLICT', 'The request key was already used for a different message.');
      if (started.state === 'busy') throw new ConversationError('CONFLICT', 'Another turn is already in progress for this conversation.');
      if (started.state === 'attachment-conflict') throw new ConversationError('CONFLICT', 'Prepared attachments are missing, expired, or already claimed.');
      if (started.state === 'replay') {
        await onEvent({ type: 'start', correlationKey, conversationKey: input.conversationKey, userMessageKey: started.user.key, assistantMessageKey: started.assistant.key, userMessage: projectConversationMessage(started.user) });
        if (started.assistant.status === 'COMPLETED') { await onEvent({ type: 'done', correlationKey, conversationKey: input.conversationKey, message: projectConversationMessage(started.assistant), replayed: true }); return; }
        throw new ConversationError('CONFLICT', 'This turn is already in progress or previously failed.');
      }

      if (!input.attachmentKeys.length) await onEvent({ type: 'start', correlationKey, conversationKey: input.conversationKey, userMessageKey: started.user.key, assistantMessageKey: started.assistant.key, userMessage: projectConversationMessage(started.user) });

      try {
        let attachments: Awaited<ReturnType<typeof prepareConversationAttachments>> = [];
        let stagedImageArtifactKeys: string[] = [];
        if (input.attachmentKeys.length) {
          const claimed = await attachmentArtifacts.readClaimed(ownership, started.user.key, input.attachmentKeys);
          if (claimed.length !== input.attachmentKeys.length) throw new ConversationError('CONFLICT', 'Claimed attachment manifests are unavailable.');
          stagedImageArtifactKeys = claimed.filter(({ kind }) => kind === 'image').map(({ key }) => key);
          attachments = await prepareAttachments(claimed, context, { ...dependencies.attachmentPersistence, storage: { download: attachmentStorage.download.bind(attachmentStorage), delete: attachmentStorage.delete?.bind(attachmentStorage) ?? documentStorage.delete.bind(documentStorage) } });
          const enqueue = dependencies.enqueueAttachmentJob ?? ((job: unknown) => import('./attachment-persistence-queue').then(({ enqueueConversationAttachmentPersistence }) => enqueueConversationAttachmentPersistence(job)));
          void Promise.all(input.attachmentKeys.map((artifactKey) => enqueue({ schemaVersion: 1, artifactKey, userMessageKey: started.user.key }))).catch((error) => console.error('conversation attachment enqueue failed; durable recovery will retry', { userMessageKey: started.user.key, error }));
          await onEvent({ type: 'start', correlationKey, conversationKey: input.conversationKey, userMessageKey: started.user.key, assistantMessageKey: started.assistant.key, userMessage: projectConversationMessage(started.user) });
        }
        const latest = await repository.latestCompletedMessages(ownership, input.conversationKey, at, 50);
        if (!latest) throw new ConversationError('NOT_FOUND', 'Conversation not found.');
        const recent = latest.filter(({ key, createdAt }) => key !== started.user.key && createdAt < at).slice(-50);
        const excludedKeys = [started.user.key, ...recent.map(({ key }) => key)];
        let recalled: ConversationMessage[] = [];
        try {
          const embedding = await embed({ text: input.message, purpose: 'document', signal: agentDependencies.router?.signal, timeoutMs: agentDependencies.router?.timeoutMs });
          const indexing = repository.setMessageEmbedding(ownership, input.conversationKey, started.user.key, embedding).catch((error) => {
            rethrowAbort(error, agentDependencies.router?.signal);
            console.error('conversation user message indexing failed open', { messageKey: started.user.key, error });
          });
          const recall = repository.semanticMessages(ownership, embedding, { before: at, excludedKeys, limit: 20 }).catch((error) => {
            rethrowAbort(error, agentDependencies.router?.signal);
            console.error('conversation semantic recall failed open', { messageKey: started.user.key, error });
            return [];
          });
          const [, rows] = await Promise.all([indexing, recall]);
          if (rows.length) {
            const excluded = new Set(excludedKeys);
            recalled = rows.filter(({ message }) => message.createdAt < at && !excluded.has(message.key)).slice(0, 20).map(({ message }) => message);
          }
        } catch (error) {
          rethrowAbort(error, agentDependencies.router?.signal);
          console.error('conversation user message embedding failed open', { messageKey: started.user.key, error });
        }
        const agentContext = prioritizedAgentContext(recent, recalled);
        const retrievals: AppSearchRetrieval[] = [];
        let response: Awaited<ReturnType<typeof core>> | undefined;
        let agentError: unknown;
        const successfulAggregates = new Map<string, AppSearchCountOutput | AppSearchSumOutput>();
        let successfulImageTurn: z.infer<typeof conversationImageTurnResultSchema> | undefined;
        const maximumAttempts = attachments.some(({ kind }) => kind === 'image') ? 1 : 2;
        for (let attempt = 0; attempt < maximumAttempts && !response; attempt += 1) {
          retrievals.length = 0;
          const deltas: string[] = [];
          let emitted = false;
          try {
            response = await core({
              systemPrompt: input.referenceImageKeys.length || stagedImageArtifactKeys.length ? `${coreAgent.systemPrompt}\nThe user supplied image editing context. Use app.generate-image to transform it; its trusted references are supplied automatically. Do not answer an image-edit request with text.` : coreAgent.systemPrompt,
              ...agentContext,
              message: input.message, currentDate: at, requestKey: input.requestKey, generateName: started.first, attachments,
            }, {
              toolContext: context, conversationService: service, currentConversationKey: input.conversationKey, currentUserMessageContent: input.message, currentReferenceImageKeys: input.referenceImageKeys, currentStagedImageArtifactKeys: stagedImageArtifactKeys,
              onDelta: async (text) => {
                deltas.push(text);
                emitted = true;
                await onEvent({ type: 'delta', correlationKey, assistantMessageKey: started.assistant.key, text });
              },
              onToolSucceeded: (slug, arguments_, result) => {
                if (slug === 'app.generate-image') {
                  const parsed = conversationImageTurnResultSchema.safeParse(result);
                  if (parsed.success) { successfulImageTurn = parsed.data; return true; }
                  return;
                }
                if (slug === 'app.search') {
                  const aggregate = z.union([appSearchCountOutputSchema, appSearchSumOutputSchema]).safeParse(result);
                  if (aggregate.success && aggregate.data.groups.length) successfulAggregates.set(JSON.stringify(arguments_), aggregate.data);
                  if (retrievals.length >= 4) return;
                  const retrieval = projectAppSearchRetrieval(arguments_, result);
                  if (retrieval) retrievals.push(retrieval);
                  return;
                }
                if (retrievals.length >= 4) return;
                const retrieval = projectToolResultRetrieval(slug, result);
                if (retrieval) retrievals.push(retrieval);
              },
            }, agentDependencies);
          } catch (error) {
            if (agentDependencies.router?.signal?.aborted) throw error;
            agentError = error;
            console.error('conversation agent attempt failed', { conversationKey: input.conversationKey, attempt: attempt + 1, error });
            if (emitted) response = { message: deltas.join(''), tools: [] };
            else if (successfulImageTurn) response = { message: 'I am creating your image now.', tools: [] };
          }
        }
        if (!response) {
          const fallback = successfulAggregates.size ? exactAggregateFallback([...successfulAggregates.values()]) : 'I could not complete that request reliably. Please try again.';
          const completed = await repository.completeTurn(ownership, input.conversationKey, started.assistant.key, fallback, undefined, [], now());
          if (!completed) throw agentError ?? new ConversationError('FAILED', 'Conversation changed before the fallback response completed.');
          await onEvent({ type: 'done', correlationKey, conversationKey: input.conversationKey, message: projectConversationMessage(completed.message), replayed: false });
          return;
        }
        if (successfulImageTurn) {
          const completed = await repository.completeTurn(ownership, input.conversationKey, started.assistant.key, response.message, undefined, [], now(), response.name);
          if (!completed) throw new ConversationError('CONFLICT', 'Conversation changed before image generation started.');
          const imageAssistant = await repository.setImageStatusText(ownership, input.conversationKey, successfulImageTurn.assistant.key, response.message);
          if (!imageAssistant) throw new ConversationError('CONFLICT', 'Image generation response changed before its status could be saved.');
          if (!await repository.deleteMessageTurn(ownership, input.conversationKey, started.assistant.key, now())) throw new ConversationError('CONFLICT', 'Superseded text turn could not be removed.');
          await onEvent({ type: 'done', correlationKey, conversationKey: input.conversationKey, message: projectConversationMessage(imageAssistant), ...(completed.nameApplied && response.name ? { name: response.name } : {}), replayed: successfulImageTurn.replayed });
          return;
        }
        const completed = await repository.completeTurn(ownership, input.conversationKey, started.assistant.key, response.message, undefined, retrievals, now(), response.name);
        if (!completed) throw new ConversationError('CONFLICT', 'Conversation changed before the answer completed.');
        await onEvent({ type: 'done', correlationKey, conversationKey: input.conversationKey, message: projectConversationMessage(completed.message), ...(completed.nameApplied && response.name ? { name: response.name } : {}), replayed: false });
        void embed({ text: response.message, purpose: 'document', signal: agentDependencies.router?.signal, timeoutMs: agentDependencies.router?.timeoutMs })
          .then(async (embedding) => { await repository.setMessageEmbedding(ownership, input.conversationKey, started.assistant.key, embedding); })
          .catch(() => undefined);
      } catch (error) {
        await repository.failTurn(ownership, input.conversationKey, started.assistant.key, now());
        throw error;
      }
    },
    async enqueueImageTurn(raw: unknown, context: ToolContext, rawStagedImageArtifactKeys: readonly string[] = []) {
      const input = conversationImageTurnInputSchema.parse(raw), ownership = owner(context), at = now();
      const stagedImageArtifactKeys = z.array(z.string().cuid()).max(8).refine((keys) => new Set(keys).size === keys.length, 'Staged image artifact keys must be unique.').parse(rawStagedImageArtifactKeys);
      if (input.referenceImageKeys.length + stagedImageArtifactKeys.length > 8) throw new ConversationError('CONFLICT', 'Image generation accepts at most eight references.');
      const assistantAt = new Date(new Date(at).getTime() + 1).toISOString();
      const imageInput = { prompt: input.prompt, referenceImageKeys: input.referenceImageKeys, size: input.size, quality: input.quality, mode: input.mode };
      const requestHash = createHash('sha256').update(JSON.stringify({ conversationKey: input.conversationKey, ...imageInput, userMessage: input.userMessage, stagedImageArtifactKeys })).digest('hex');
      const started = await repository.beginImageTurn(ownership, input.conversationKey,
        { key: id(), ...ownership, conversationKey: input.conversationKey, turnKey: input.requestKey, requestHash, type: 'IMAGE', role: 'USER', status: 'COMPLETED', content: input.userMessage ?? input.prompt, attachments: [], attachmentStatus: 'NONE', retrievals: [], createdAt: at, completedAt: at },
        { key: id(), ...ownership, conversationKey: input.conversationKey, turnKey: input.requestKey, requestHash, type: 'IMAGE', role: 'ASSISTANT', status: 'PENDING', content: JSON.stringify(imageInput), ...(stagedImageArtifactKeys.length ? { imageReferenceArtifactKeys: stagedImageArtifactKeys } : {}), attachments: [], attachmentStatus: 'NONE', retrievals: [], createdAt: assistantAt });
      if (!started) throw new ConversationError('NOT_FOUND', 'Conversation not found.');
      if (started.state === 'idempotency-conflict') throw new ConversationError('CONFLICT', 'The request key was already used for a different message.');
      if (started.assistant.status === 'PENDING') {
        const enqueue = dependencies.enqueueImageJob ?? ((job: unknown) => import('./image-turn-queue').then(({ enqueueConversationImageTurn }) => enqueueConversationImageTurn(job)));
        const durableInput = managedImageGenerateInputSchema.parse(JSON.parse(started.assistant.content));
        await enqueue({ schemaVersion: 1, assistantMessageKey: started.assistant.key, conversationKey: input.conversationKey, ...ownership, actorKey: context.principal.kind === 'member' ? context.principal.userTeam.key : '', requestKey: started.assistant.key, input: durableInput, stagedImageArtifactKeys: started.assistant.imageReferenceArtifactKeys ?? [] }).catch((error) => console.error('conversation image enqueue failed; startup recovery will retry', { assistantMessageKey: started.assistant.key, error }));
      }
      return conversationImageTurnResultSchema.parse({ user: projectConversationMessage(started.user), assistant: projectConversationMessage(started.assistant), replayed: started.state === 'replay' });
    },
  };
  return service;
}

let service: ConversationService | undefined;
export const getDefaultConversationService = () => service ??= createConversationService();
