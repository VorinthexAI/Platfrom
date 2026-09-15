import { createHash } from 'node:crypto';
import { z } from 'zod';
import { newId } from '@/lib/ids';
import { embedText } from '@/lib/embeddings';
import { coreAgent, executeCoreAgent } from '@/lib/ai/agents/core';
import { AgentStreamProtocolError, type AgentRuntimeDependencies } from '@/lib/ai/agents';
import type { ExecuteActionOptions } from '@/lib/ai/router';
import { runTool } from '@/lib/ai/tools';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { agentGuideOutputSchema } from '@/lib/ai/tools/agent-guide';
import { getDefaultUserSearchService, type UserSearchService } from '@/lib/user-searches/service';
import { projectAppSearchRetrieval, type AppSearchRetrieval } from '@/lib/app-search/service';
import { documentStorage, type DocumentObjectStorage } from '@/lib/ai/document-processing';
import { managedImageGenerateInputSchema } from '@/lib/image-generation/service';
import { projectToolResultRetrieval } from './tool-retrieval';
import { getDefaultConversationRepository, type ConversationRepository } from './repository';
import { prepareConversationAttachments, type ConversationAttachmentPersistenceDependencies } from './attachment-persistence';
import { getDefaultConversationAttachmentArtifactRepository, type ConversationAttachmentArtifactRepository } from './attachment-artifacts';
import {
  DEFAULT_CONVERSATION_NAME,
  conversationCreateServiceInputSchema, conversationFavoriteInputSchema, conversationImageTurnInputSchema, conversationImageTurnResultSchema, conversationKeyInputSchema,
  conversationListInputSchema, conversationMessageDeleteInputSchema, conversationMessageDeleteResultSchema, conversationMessageListInputSchema, conversationMessageSchema, conversationRenameInputSchema, conversationSafeMessageSchema,
  conversationSearchInputSchema, conversationSendInputSchema, decodeCursor, encodeCursor, projectConversationMessage,
  type Conversation, type ConversationMessage,
} from './schemas';
import { verifyOpeningGreetingToken, type OpeningGreetingSnapshot } from './opening-greeting';
import type { ConversationArchiveState } from './archive-projection';

const conversationCursorSchema = z.object({ favorite: z.boolean(), updatedAt: z.string().datetime(), key: z.string().cuid() }).strict();
const messageCursorSchema = z.object({ createdAt: z.string().datetime(), key: z.string().cuid() }).strict();
const MAX_CONTEXT_BYTES = 250_000;

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
    const content = item.type === 'IMAGE' && item.role === 'ASSISTANT'
      ? `A generated image was saved in Gallery. Visible description: ${item.imageSummaryText ?? 'Description unavailable.'}`
      : item.content;
    const attachmentContext = item.attachmentContext?.length ? `\n\nAttachments supplied with this historical user message, in original order: ${JSON.stringify(item.attachmentContext)}` : '';
    const attachmentEnriched = content + attachmentContext;
    const enriched = attachmentEnriched + retrievalContext;
    return { role: item.role.toLowerCase() as 'user' | 'assistant', content: Buffer.byteLength(enriched, 'utf8') <= MAX_CONTEXT_BYTES ? enriched : attachmentEnriched, createdAt: item.createdAt };
  });
}

function prioritizedAgentContext(currentConversationSummary: string | null, recentMessages: ConversationMessage[], recalledMessages: ConversationMessage[]) {
  const context = projectAgentContext(recentMessages);
  const base = { currentConversationSummary: currentConversationSummary ?? undefined, context };
  while (context.length && Buffer.byteLength(JSON.stringify({ ...base, recalledContext: [] }), 'utf8') > MAX_CONTEXT_BYTES) context.shift();
  const recalledByRelevance = projectAgentContext(recalledMessages);
  while (recalledByRelevance.length) {
    const recalledContext = [...recalledByRelevance].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    if (Buffer.byteLength(JSON.stringify({ ...base, recalledContext }), 'utf8') <= MAX_CONTEXT_BYTES) return { ...base, recalledContext };
    recalledByRelevance.pop();
  }
  return { ...base, recalledContext: [] };
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
  attachmentArtifacts?: Pick<ConversationAttachmentArtifactRepository, 'readClaimed'> & Partial<Pick<ConversationAttachmentArtifactRepository, 'releaseClaimed'>>;
  attachmentStorage?: Pick<DocumentObjectStorage, 'download'> & Partial<Pick<DocumentObjectStorage, 'delete'>>;
  prepareAttachments?: typeof prepareConversationAttachments;
  attachmentPersistence?: Omit<ConversationAttachmentPersistenceDependencies, 'storage'>;
  enqueueAttachmentJob?: (input: unknown) => Promise<unknown>;
  scheduleAttachmentJobs?: (callback: () => void) => void;
  enqueueImageJob?: (input: unknown) => Promise<unknown>;
  enqueueArchiveJob?: (input: unknown) => Promise<unknown>;
  enqueueGuideTopicsJob?: (input: unknown) => Promise<unknown>;
  runGuide?: typeof runTool;
  publishContentChanged?: (scopeKey: string) => Promise<unknown>;
  verifyOpeningGreeting?: typeof verifyOpeningGreetingToken;
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
  const enqueueArchiveJob = dependencies.enqueueArchiveJob ?? ((job: unknown) => import('./archive-projection-queue').then(({ enqueueConversationArchiveProjection }) => enqueueConversationArchiveProjection(job)));
  const enqueueGuideTopicsJob = dependencies.enqueueGuideTopicsJob ?? ((job: unknown) => import('./guide-topics-queue').then(({ enqueueConversationGuideTopics }) => enqueueConversationGuideTopics(job)));
  const publishContentChanged = dependencies.publishContentChanged ?? ((scopeKey: string) => import('@/api/events').then(({ publishScopeEvent }) => publishScopeEvent(scopeKey, 'content.changed')));
  const enqueueArchiveState = (state: ConversationArchiveState | null) => {
    if (!state) return;
    void enqueueArchiveJob({ schemaVersion: 1, conversationKey: state.conversationKey, teamKey: state.teamKey, scopeKey: state.scopeKey, userKey: state.userKey, actorKey: state.actorKey, desiredRevision: state.desiredRevision })
      .catch((error) => console.error('conversation archive projection enqueue failed; durable recovery will retry', { conversationKey: state.conversationKey, desiredRevision: state.desiredRevision, error }));
  };
  const scheduleAttachmentJobs = dependencies.scheduleAttachmentJobs ?? ((callback: () => void) => { const timer = setTimeout(callback, 250); timer.unref?.(); });
  const requestArchiveProjection = async (ownership: Owner, conversationKey: string, at: string, actorKey: string) => {
    if (repository.requestArchiveProjection) enqueueArchiveState(await repository.requestArchiveProjection(ownership, conversationKey, at, actorKey));
  };
  const requestArchiveProjectionInBackground = (ownership: Owner, conversationKey: string, at: string, actorKey: string) => {
    void requestArchiveProjection(ownership, conversationKey, at, actorKey)
      .catch((error) => console.error('conversation Archive projection request failed; durable recovery will retry', { conversationKey, error }));
  };
  let service: ConversationService;

  const page = async (context: ToolContext, raw: unknown, query?: string) => {
    const input = query === undefined ? conversationListInputSchema.parse(raw) : conversationSearchInputSchema.parse(raw);
    const rows = await repository.list(owner(context), { ...(query === undefined ? {} : { query }), cursor: decodeCursor(input.cursor, conversationCursorSchema), limit: input.limit + 1, favoriteOnly: input.favoriteOnly });
    const hasMore = rows.length > input.limit; const items = rows.slice(0, input.limit); const last = items.at(-1);
    return { items, nextCursor: hasMore && last ? encodeCursor({ favorite: last.isFavorite, updatedAt: last.updatedAt, key: last.key }) : null };
  };

  service = {
    async create(raw: unknown, context: ToolContext) {
      const input = conversationCreateServiceInputSchema.parse(raw), at = now(), ownership = owner(context), key = id();
      let opening: OpeningGreetingSnapshot | undefined;
      if (input.openingGreetingToken) {
        opening = await (dependencies.verifyOpeningGreeting ?? verifyOpeningGreetingToken)(input.openingGreetingToken, new Date(at).getTime()) ?? undefined;
        if (!opening || opening.teamKey !== ownership.teamKey || opening.scopeKey !== ownership.scopeKey || opening.userKey !== ownership.userKey) throw new ConversationError('FORBIDDEN', 'The opening greeting is invalid or expired.');
      }
      const openingMessage = opening ? conversationMessageSchema.parse({ key: opening.key, ...ownership, conversationKey: key, turnKey: `opening:${opening.key}`, requestHash: createHash('sha256').update(input.openingGreetingToken!).digest('hex'), type: 'TEXT', role: 'ASSISTANT', status: 'COMPLETED', content: opening.message, attachments: [], attachmentStatus: 'NONE', retrievals: [], guideTopics: opening.guideTopics, guideTopicMode: opening.guideTopicMode, createdAt: opening.createdAt, completedAt: opening.createdAt }) : undefined;
      const actorKey = context.principal.kind === 'member' ? context.principal.userTeam.key : '';
      const created = await repository.create({ key, ...ownership, name: input.name ?? DEFAULT_CONVERSATION_NAME, isFavorite: false, createdAt: at, updatedAt: at }, actorKey, openingMessage);
      if (created.name !== DEFAULT_CONVERSATION_NAME) await requestArchiveProjection(ownership, created.key, at, actorKey);
      return created;
    },
    list(raw: unknown, context: ToolContext) { return page(context, raw); },
    async search(raw: unknown, context: ToolContext) { const input = conversationSearchInputSchema.parse(raw), ownership = owner(context); const result = await page(context, input, input.query); if (input.recordHistory) await userSearches.record(ownership.userKey, input.query); return result; },
    async rename(raw: unknown, context: ToolContext) { const input = conversationRenameInputSchema.parse(raw), ownership = owner(context), at = now(); const value = await repository.update(ownership, input.conversationKey, { name: input.name, updatedAt: at }); if (!value) throw new ConversationError('NOT_FOUND', 'Conversation not found.'); const state = repository.readArchiveState ? await repository.readArchiveState(ownership, input.conversationKey) : null; if (state) enqueueArchiveState(state); else await requestArchiveProjection(ownership, input.conversationKey, at, context.principal.kind === 'member' ? context.principal.userTeam.key : ''); return value; },
    async favorite(raw: unknown, context: ToolContext) { const input = conversationFavoriteInputSchema.parse(raw); const value = await repository.update(owner(context), input.conversationKey, { isFavorite: input.isFavorite, updatedAt: now() }); if (!value) throw new ConversationError('NOT_FOUND', 'Conversation not found.'); return value; },
    async delete(raw: unknown, context: ToolContext) { const input = conversationKeyInputSchema.parse(raw), ownership = owner(context); if (!await repository.delete(ownership, input.conversationKey)) throw new ConversationError('NOT_FOUND', 'Conversation not found.'); await publishContentChanged(ownership.scopeKey).catch(() => undefined); return { deletedKey: input.conversationKey }; },
    async deleteMessage(raw: unknown, context: ToolContext) { const input = conversationMessageDeleteInputSchema.parse(raw), ownership = owner(context), at = now(); const deletedKeys = await repository.deleteMessageTurn(ownership, input.conversationKey, input.messageKey, at); if (!deletedKeys) throw new ConversationError('NOT_FOUND', 'Conversation message not found or cannot be deleted while its response is pending.'); await requestArchiveProjection(ownership, input.conversationKey, at, context.principal.kind === 'member' ? context.principal.userTeam.key : ''); return conversationMessageDeleteResultSchema.parse({ deletedKeys }); },
    async messages(raw: unknown, context: ToolContext) { const input = conversationMessageListInputSchema.parse(raw); const rows = await repository.listMessages(owner(context), input.conversationKey, decodeCursor(input.cursor, messageCursorSchema), input.limit + 1); if (!rows) throw new ConversationError('NOT_FOUND', 'Conversation not found.'); const hasMore = rows.length > input.limit; const items = hasMore ? rows.slice(1) : rows; const first = items[0]; return { items: items.map(projectConversationMessage), nextCursor: hasMore && first ? encodeCursor({ createdAt: first.createdAt, key: first.key }) : null }; },
    async turn(raw: unknown, context: ToolContext, onEvent: (event: ConversationTurnEvent) => void | Promise<void>) {
      const input = conversationSendInputSchema.parse(raw), ownership = owner(context), correlationKey = id(), at = now();
      const assistantAt = new Date(new Date(at).getTime() + 1).toISOString();
      const requestHash = createHash('sha256').update(JSON.stringify({ conversationKey: input.conversationKey, message: input.message, attachmentKeys: input.attachmentKeys, referenceImageKeys: input.referenceImageKeys, guideTopicSelection: input.guideTopicSelection })).digest('hex');
      const actorKey = context.principal.kind === 'member' ? context.principal.userTeam.key : '';
      const selectedGuideMode = input.guideTopicSelection ? await repository.validateGuideTopicSelection(ownership, input.conversationKey, input.guideTopicSelection, input.message) : null;
      if (input.guideTopicSelection && !selectedGuideMode) throw new ConversationError('CONFLICT', 'The selected guide topic is stale or invalid.');
      const started = await repository.beginTurn(ownership, input.conversationKey,
        { key: id(), ...ownership, conversationKey: input.conversationKey, turnKey: input.requestKey, requestHash, type: 'TEXT', role: 'USER', status: 'COMPLETED', content: input.message, attachments: [], attachmentStatus: input.attachmentKeys.length ? 'PENDING' : 'NONE', ...(input.attachmentKeys.length ? { pendingAttachmentKeys: input.attachmentKeys } : {}), retrievals: [], guideTopics: { status: 'NONE' }, ...(selectedGuideMode ? { selectedGuideMode } : {}), createdAt: at, completedAt: at },
        { key: id(), ...ownership, conversationKey: input.conversationKey, turnKey: input.requestKey, requestHash, type: 'TEXT', role: 'ASSISTANT', status: 'PENDING', content: 'Pending', attachments: [], attachmentStatus: 'NONE', retrievals: [], guideTopics: { status: 'NONE' }, createdAt: assistantAt }, actorKey);
      if (!started) throw new ConversationError('NOT_FOUND', 'Conversation not found.');
      if (started.state === 'idempotency-conflict') throw new ConversationError('CONFLICT', 'The request key was already used for a different message.');
      if (started.state === 'busy') throw new ConversationError('CONFLICT', 'Another turn is already in progress for this conversation.');
      if (started.state === 'attachment-conflict') throw new ConversationError('CONFLICT', 'Prepared attachments are missing, expired, or already claimed.');
      if (started.state === 'guide-selection-conflict') throw new ConversationError('CONFLICT', 'The selected guide topic is stale or invalid.');
      if (started.state === 'replay') {
        await onEvent({ type: 'start', correlationKey, conversationKey: input.conversationKey, userMessageKey: started.user.key, assistantMessageKey: started.assistant.key, userMessage: projectConversationMessage(started.user) });
        if (started.assistant.status === 'COMPLETED') { await onEvent({ type: 'done', correlationKey, conversationKey: input.conversationKey, message: projectConversationMessage(started.assistant), replayed: true }); return; }
        throw new ConversationError('CONFLICT', 'This turn is already in progress or previously failed.');
      }
      if (!input.attachmentKeys.length) await onEvent({ type: 'start', correlationKey, conversationKey: input.conversationKey, userMessageKey: started.user.key, assistantMessageKey: started.assistant.key, userMessage: projectConversationMessage(started.user) });

      let enqueueAttachmentPersistence = async () => {};
      try {
        let attachments: Awaited<ReturnType<typeof prepareConversationAttachments>> = [];
        let stagedImageArtifactKeys: string[] = [];
        if (input.attachmentKeys.length) {
          const claimed = await attachmentArtifacts.readClaimed(ownership, started.user.key, input.attachmentKeys);
          if (claimed.length !== input.attachmentKeys.length) throw new ConversationError('CONFLICT', 'Claimed attachment manifests are unavailable.');
          stagedImageArtifactKeys = claimed.filter(({ kind }) => kind === 'image').map(({ key }) => key);
          attachments = await prepareAttachments(claimed, context, { ...dependencies.attachmentPersistence, storage: { download: attachmentStorage.download.bind(attachmentStorage), delete: attachmentStorage.delete?.bind(attachmentStorage) ?? documentStorage.delete.bind(documentStorage) } });
          const enqueue = dependencies.enqueueAttachmentJob ?? ((job: unknown) => import('./attachment-persistence-queue').then(({ enqueueConversationAttachmentPersistence }) => enqueueConversationAttachmentPersistence(job)));
          enqueueAttachmentPersistence = async () => {
            await attachmentArtifacts.releaseClaimed?.(ownership, started.user.key, input.attachmentKeys, now());
            scheduleAttachmentJobs(() => {
            void Promise.all(input.attachmentKeys.map((artifactKey) => enqueue({ schemaVersion: 1, artifactKey, userMessageKey: started.user.key }))).catch((error) => console.error('conversation attachment enqueue failed; durable recovery will retry', { userMessageKey: started.user.key, error }));
            });
          };
          await onEvent({ type: 'start', correlationKey, conversationKey: input.conversationKey, userMessageKey: started.user.key, assistantMessageKey: started.assistant.key, userMessage: projectConversationMessage(started.user) });
        }
        const [latest, currentConversationSummary] = await Promise.all([
          repository.latestCompletedMessages(ownership, input.conversationKey, at, 10),
          repository.readArchiveSummary?.(ownership, input.conversationKey).catch((error) => {
            console.error('conversation Archive summary read failed open', { conversationKey: input.conversationKey, error });
            return null;
          }) ?? Promise.resolve(null),
        ]);
        if (!latest) throw new ConversationError('NOT_FOUND', 'Conversation not found.');
        const recent = latest.filter(({ key, createdAt }) => key !== started.user.key && createdAt < at).slice(-10);
        const firstUserTurn = started.first || !recent.some(({ role }) => role === 'USER');
        const excludedKeys = [started.user.key, ...recent.map(({ key }) => key)];
        let recalled: ConversationMessage[] = [];
        try {
          const embedding = await embed({ text: input.message, purpose: 'document', signal: agentDependencies.router?.signal, timeoutMs: agentDependencies.router?.timeoutMs });
          const indexing = repository.setMessageEmbedding(ownership, input.conversationKey, started.user.key, embedding).catch((error) => {
            rethrowAbort(error, agentDependencies.router?.signal);
            console.error('conversation user message indexing failed open', { messageKey: started.user.key, error });
          });
          const recall = repository.semanticMessages(ownership, embedding, { before: at, excludedKeys, limit: 5 }).catch((error) => {
            rethrowAbort(error, agentDependencies.router?.signal);
            console.error('conversation semantic recall failed open', { messageKey: started.user.key, error });
            return [];
          });
          const [, rows] = await Promise.all([indexing, recall]);
          if (rows.length) {
            const seenMessageKeys = new Set(excludedKeys);
            recalled = rows.flatMap(({ message }) => {
              if (message.createdAt >= at || seenMessageKeys.has(message.key)) return [];
              seenMessageKeys.add(message.key);
              return [message];
            }).slice(0, 5);
          }
        } catch (error) {
          rethrowAbort(error, agentDependencies.router?.signal);
          console.error('conversation user message embedding failed open', { messageKey: started.user.key, error });
        }
        const agentContext = prioritizedAgentContext(currentConversationSummary, recent, recalled);
        const retrievals: AppSearchRetrieval[] = [];
        let successfulGuide: { mode: 'recommend' | 'explain'; context: unknown } | undefined;
        const selectedGuideMode = started.user.selectedGuideMode;
        if (selectedGuideMode) {
          const guideResult = await (dependencies.runGuide ?? runTool)('agent.guide', 'agents.core', { mode: selectedGuideMode }, { ...agentDependencies.tools?.dependencies, ...agentDependencies.router, contentContext: context, requestKey: `${input.requestKey}:selected-guide` });
          const parsedGuide = agentGuideOutputSchema.parse(guideResult);
          if (parsedGuide.mode === 'greet' || parsedGuide.mode === 'topics') throw new ConversationError('FAILED', 'Selected guide topic did not resolve to workspace guidance.');
          successfulGuide = { mode: parsedGuide.mode, context: parsedGuide };
        }
        let response: Awaited<ReturnType<typeof core>> | undefined;
        let agentError: unknown;
        let successfulImageTurn: z.infer<typeof conversationImageTurnResultSchema> | undefined;
        const maximumAttempts = attachments.some(({ kind }) => kind === 'image') ? 1 : 2;
        for (let attempt = 0; attempt < maximumAttempts && !response; attempt += 1) {
          retrievals.length = 0;
          const deltas: string[] = [];
          let emitted = false;
          try {
            response = await core({
              systemPrompt: `${input.referenceImageKeys.length || stagedImageArtifactKeys.length ? `${coreAgent.systemPrompt}\nThe user supplied image editing context. Use app.generate-image to transform it; its trusted references are supplied automatically. Do not answer an image-edit request with text.` : coreAgent.systemPrompt}${selectedGuideMode ? '\nThis request came from a server-validated guide topic. Answer concisely and directly from the preloaded canonical guidance.' : ''}`,
              ...agentContext,
              message: input.message, currentDate: at, requestKey: input.requestKey, generateName: firstUserTurn, attachments,
              preloadedTools: successfulGuide ? [{ slug: 'agent.guide' as const, arguments: { mode: successfulGuide.mode }, result: successfulGuide.context }] : [],
            }, {
              toolContext: context, conversationService: service, currentConversationKey: input.conversationKey, currentUserMessageContent: input.message, currentReferenceImageKeys: input.referenceImageKeys, currentStagedImageArtifactKeys: stagedImageArtifactKeys,
              onDelta: async (text) => {
                deltas.push(text);
                emitted = true;
                await onEvent({ type: 'delta', correlationKey, assistantMessageKey: started.assistant.key, text });
              },
              onToolSucceeded: (slug, arguments_, result) => {
                if (slug === 'agent.guide') {
                  const parsed = agentGuideOutputSchema.safeParse(result);
                  if (parsed.success && (parsed.data.mode === 'recommend' || parsed.data.mode === 'explain')) successfulGuide = { mode: parsed.data.mode, context: parsed.data };
                }
                if (slug === 'app.generate-image') {
                  const parsed = conversationImageTurnResultSchema.safeParse(result);
                  if (parsed.success) { successfulImageTurn = parsed.data; return true; }
                  return;
                }
                if (slug === 'app.search') {
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
            if (error instanceof AgentStreamProtocolError) throw error;
            agentError = error;
            console.error('conversation agent attempt failed', { conversationKey: input.conversationKey, attempt: attempt + 1, error });
            if (emitted) response = { message: deltas.join(''), tools: [] };
            else if (successfulImageTurn) response = { message: input.message, tools: [] };
          }
        }
        if (!response) throw agentError ?? new ConversationError('FAILED', 'Core did not return a response.');
        if (successfulImageTurn) {
          const completed = await repository.completeTurn(ownership, input.conversationKey, started.assistant.key, response.message, undefined, [], now(), response.name);
          if (!completed) throw new ConversationError('CONFLICT', 'Conversation changed before image generation started.');
          const imageAssistant = await repository.setImageStatusText(ownership, input.conversationKey, successfulImageTurn.assistant.key, response.message);
          if (!imageAssistant) throw new ConversationError('CONFLICT', 'Image generation response changed before its status could be saved.');
          const supersededKeys = await repository.deleteMessageTurn(ownership, input.conversationKey, started.assistant.key, now());
          if (!supersededKeys) throw new ConversationError('CONFLICT', 'Superseded text turn could not be removed.');
          const nameApplied = completed.nameApplied;
          await onEvent({ type: 'done', correlationKey, conversationKey: input.conversationKey, message: projectConversationMessage(imageAssistant), ...(nameApplied && response.name ? { name: response.name } : {}), replayed: successfulImageTurn.replayed });
          requestArchiveProjectionInBackground(ownership, input.conversationKey, now(), actorKey);
          return;
        }
        const completed = await repository.completeTurn(ownership, input.conversationKey, started.assistant.key, response.message, undefined, retrievals, now(), response.name, successfulGuide);
        if (!completed) throw new ConversationError('CONFLICT', 'Conversation changed before the answer completed.');
        const nameApplied = completed.nameApplied;
        await onEvent({ type: 'done', correlationKey, conversationKey: input.conversationKey, message: projectConversationMessage(completed.message), ...(nameApplied && response.name ? { name: response.name } : {}), replayed: false });
        requestArchiveProjectionInBackground(ownership, input.conversationKey, completed.message.completedAt!, actorKey);
        if (completed.message.guideTopics?.status === 'PENDING' && completed.message.guideTopicGeneration) {
          void enqueueGuideTopicsJob({ schemaVersion: 1, assistantMessageKey: completed.message.key, conversationKey: input.conversationKey, ...ownership, actorKey, generation: completed.message.guideTopicGeneration })
            .catch((error) => console.error('conversation guide topic enqueue failed; durable recovery will retry', { assistantMessageKey: completed.message.key, generation: completed.message.guideTopicGeneration, error }));
        }
        void embed({ text: response.message, purpose: 'document', signal: agentDependencies.router?.signal, timeoutMs: agentDependencies.router?.timeoutMs })
          .then(async (embedding) => { await repository.setMessageEmbedding(ownership, input.conversationKey, started.assistant.key, embedding); })
          .catch(() => undefined);
      } catch (error) {
        const failedAt = now();
        await repository.failTurn(ownership, input.conversationKey, started.assistant.key, failedAt);
        await requestArchiveProjection(ownership, input.conversationKey, failedAt, actorKey);
        throw error;
      } finally {
        void enqueueAttachmentPersistence().catch((error) => console.error('conversation attachment persistence scheduling failed; durable recovery will retry', { userMessageKey: started.user.key, error }));
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
        { key: id(), ...ownership, conversationKey: input.conversationKey, turnKey: input.requestKey, requestHash, type: 'IMAGE', role: 'USER', status: 'COMPLETED', content: input.userMessage ?? input.prompt, attachments: [], attachmentStatus: 'NONE', retrievals: [], guideTopics: { status: 'NONE' }, createdAt: at, completedAt: at },
        { key: id(), ...ownership, conversationKey: input.conversationKey, turnKey: input.requestKey, requestHash, type: 'IMAGE', role: 'ASSISTANT', status: 'PENDING', content: JSON.stringify(imageInput), ...(stagedImageArtifactKeys.length ? { imageReferenceArtifactKeys: stagedImageArtifactKeys } : {}), attachments: [], attachmentStatus: 'NONE', retrievals: [], guideTopics: { status: 'NONE' }, createdAt: assistantAt });
      if (!started) throw new ConversationError('NOT_FOUND', 'Conversation not found.');
      if (started.state === 'idempotency-conflict') throw new ConversationError('CONFLICT', 'The request key was already used for a different message.');
      if (started.state === 'created') await requestArchiveProjection(ownership, input.conversationKey, at, context.principal.kind === 'member' ? context.principal.userTeam.key : '');
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
