import { createHash } from 'node:crypto';
import { z } from 'zod';
import { newId } from '@/lib/ids';
import { coreAgent, executeCoreAgent } from '@/lib/ai/agents/core';
import { AgentStreamProtocolError, type AgentRuntimeDependencies } from '@/lib/ai/agents';
import type { ExecuteActionOptions } from '@/lib/ai/router';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { contextUserKey } from '@/lib/ai/tools/tool-context';
import { getFileInScope, type FileExtension } from '@/lib/db/files.node';
import { getFolderInScope } from '@/lib/db/folders.node';
import { getDefaultUserSearchService, type UserSearchService } from '@/lib/user-searches/service';
import { projectAppSearchRetrieval, type AppSearchRetrieval } from '@/lib/app-search/service';
import { documentStorage, type DocumentObjectStorage } from '@/lib/ai/document-processing';
import { projectToolResultRetrieval } from './tool-retrieval';
import { getDefaultConversationRepository, type ConversationRepository } from './repository';
import { prepareConversationAttachments, type ConversationAttachmentPersistenceDependencies } from './attachment-persistence';
import { getDefaultConversationAttachmentArtifactRepository, type ConversationAttachmentArtifactRepository } from './attachment-artifacts';
import {
  DEFAULT_CONVERSATION_NAME,
  conversationContextSeedInputSchema, conversationCreateServiceInputSchema, conversationFavoriteInputSchema, conversationHiddenInputSchema, conversationIncognitoSendInputSchema, conversationKeyInputSchema, conversationRoleInputSchema,
  conversationListInputSchema, conversationMessageDeleteInputSchema, conversationMessageDeleteResultSchema, conversationMessageListInputSchema, conversationMessageSchema, conversationRenameInputSchema, conversationSafeMessageSchema,
  conversationSearchInputSchema, conversationSendInputSchema, decodeCursor, encodeCursor, projectConversationMessage,
  type Conversation, type ConversationMessage,
} from './schemas';
import { issueConversationContextSeedToken, verifyConversationContextSeedToken } from './context-seed';
import type { ConversationArchiveState } from './archive-projection';
import { verifyOpeningGreetingToken, type OpeningGreetingSnapshot } from './opening-greeting';

async function taggedWorkspaceContext(context: ToolContext, fileKeys: string[], folderKeys: string[], budget: number) {
  if (!fileKeys.length && !folderKeys.length) return { files: [], preface: '' };
  const userKey = contextUserKey(context);
  const descriptions: string[] = [];
  for (const key of folderKeys) {
    const folder = await getFolderInScope(context.runtimeScopeKey, key, userKey);
    if (!folder) throw new ConversationError('NOT_FOUND', 'A tagged folder is no longer available.');
    descriptions.push(`Folder: ${JSON.stringify(folder.name)}`);
  }
  const files: Array<{ key: string; name: string; extension: FileExtension }> = [];
  for (const key of fileKeys) {
    const file = await getFileInScope(context.runtimeScopeKey, key, userKey);
    if (!file) throw new ConversationError('NOT_FOUND', 'A tagged file is no longer available.');
    files.push({ key: file.key, name: file.name, extension: file.extension });
    const media = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp3', 'mp4', 'mov'].includes(file.extension);
    const text = (media ? file.caption : file.extractedText)?.trim();
    const filename = file.name.toLowerCase().endsWith(`.${file.extension}`) ? file.name : `${file.name}.${file.extension}`;
    descriptions.push(`File: ${JSON.stringify(filename)}. ${text ? `${media ? 'Stored caption' : 'Extracted document text'}: ${JSON.stringify(text.slice(0, 2_000))}` : `No stored ${media ? 'caption' : 'document text'} is available.`}`);
  }
  const preface = `The user tagged these stored workspace items. Answer using the provided stored captions and extracted text; these are descriptions, not direct inspection of media bytes. Do not say you need to watch a video when its stored caption answers the question.\n${descriptions.join('\n')}\n\n`;
  return { files, preface: preface.slice(0, budget) };
}

const conversationCursorSchema = z.object({ favorite: z.boolean(), updatedAt: z.string().datetime(), key: z.string().cuid() }).strict();
const messageCursorSchema = z.object({ createdAt: z.string().datetime(), key: z.string().cuid() }).strict();
const MAX_CONTEXT_BYTES = 250_000;

export type ConversationTurnEvent =
  | { type: 'start'; correlationKey: string; conversationKey: string; userMessageKey: string; assistantMessageKey: string; userMessage: z.infer<typeof conversationSafeMessageSchema> }
  | { type: 'delta'; correlationKey: string; assistantMessageKey: string; text: string }
  | { type: 'done'; correlationKey: string; conversationKey: string; message: z.infer<typeof conversationSafeMessageSchema>; name?: string; replayed: boolean }
  | { type: 'error'; correlationKey: string; code: string; message: string };

export type ConversationSeedEvent =
  | { type: 'start'; correlationKey: string; assistantMessageKey: string }
  | { type: 'delta'; correlationKey: string; assistantMessageKey: string; text: string }
  | { type: 'done'; correlationKey: string; assistantMessageKey: string; message: string; persistenceToken: string };

export interface ConversationService {
  create(raw: unknown, context: ToolContext): Promise<Conversation>;
  list(raw: unknown, context: ToolContext): Promise<{ items: Conversation[]; nextCursor: string | null }>;
  search(raw: unknown, context: ToolContext): Promise<{ items: Conversation[]; nextCursor: string | null }>;
  rename(raw: unknown, context: ToolContext): Promise<Conversation>;
  favorite(raw: unknown, context: ToolContext): Promise<Conversation>;
  hide(raw: unknown, context: ToolContext): Promise<Conversation>;
  setRole(raw: unknown, context: ToolContext): Promise<Conversation>;
  seedContext(raw: unknown, context: ToolContext, onEvent: (event: ConversationSeedEvent) => void | Promise<void>): Promise<void>;
  delete(raw: unknown, context: ToolContext): Promise<{ deletedKey: string }>;
  deleteMessage(raw: unknown, context: ToolContext): Promise<{ deletedKeys: string[] }>;
  messages(raw: unknown, context: ToolContext): Promise<{ items: Array<z.infer<typeof conversationSafeMessageSchema>>; nextCursor: string | null }>;
  turn(raw: unknown, context: ToolContext, onEvent: (event: ConversationTurnEvent) => void | Promise<void>): Promise<void>;
  incognitoTurn(raw: unknown, context: ToolContext, onEvent: (event: ConversationTurnEvent) => void | Promise<void>): Promise<void>;
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
    const taggedContext = item.workspaceFiles?.length ? `\n\nFiles tagged with this historical user message: ${JSON.stringify(item.workspaceFiles.map(({ name, extension }) => `${name}.${extension}`))}` : '';
    const attachmentEnriched = content + attachmentContext + taggedContext;
    const enriched = attachmentEnriched + retrievalContext;
    return { role: item.role.toLowerCase() as 'user' | 'assistant', content: Buffer.byteLength(enriched, 'utf8') <= MAX_CONTEXT_BYTES ? enriched : attachmentEnriched, createdAt: item.createdAt };
  });
}

function prioritizedAgentContext(currentConversationSummary: string | null, recentMessages: ConversationMessage[]) {
  const context = projectAgentContext(recentMessages);
  const base = { currentConversationSummary: currentConversationSummary ?? undefined, context };
  while (context.length && Buffer.byteLength(JSON.stringify({ ...base, recalledContext: [] }), 'utf8') > MAX_CONTEXT_BYTES) context.shift();
  return { ...base, recalledContext: [] };
}

export interface ConversationServiceDependencies {
  repository?: ConversationRepository;
  id?: () => string;
  now?: () => string;
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
  enqueueArchiveJob?: (input: unknown) => Promise<unknown>;
  publishContentChanged?: (scopeKey: string) => Promise<unknown>;
  verifyOpeningGreeting?: typeof verifyOpeningGreetingToken;
}

export function createConversationService(dependencies: ConversationServiceDependencies = {}): ConversationService {
  const repository = dependencies.repository ?? getDefaultConversationRepository();
  const id = dependencies.id ?? newId;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const core = dependencies.core ?? executeCoreAgent;
  const agentDependencies: AgentRuntimeDependencies = { ...dependencies.agent, router: { ...dependencies.agent?.router, ...dependencies.router } };
  const userSearches = dependencies.userSearches ?? getDefaultUserSearchService();
  const attachmentArtifacts = dependencies.attachmentArtifacts ?? getDefaultConversationAttachmentArtifactRepository();
  const attachmentStorage = dependencies.attachmentStorage ?? documentStorage;
  const prepareAttachments = dependencies.prepareAttachments ?? prepareConversationAttachments;
  const enqueueArchiveJob = dependencies.enqueueArchiveJob ?? ((job: unknown) => import('./archive-projection-queue').then(({ enqueueConversationArchiveProjection }) => enqueueConversationArchiveProjection(job)));
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
    const rows = await repository.list(owner(context), { ...(query === undefined ? {} : { query }), cursor: decodeCursor(input.cursor, conversationCursorSchema), limit: input.limit + 1, favoriteOnly: input.favoriteOnly, hiddenOnly: input.hiddenOnly });
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
      const seed = input.openingContextSeedToken ? await verifyConversationContextSeedToken(input.openingContextSeedToken, new Date(at).getTime()) : null;
      if (input.openingContextSeedToken && (!seed || seed.teamKey !== ownership.teamKey || seed.scopeKey !== ownership.scopeKey || seed.userKey !== ownership.userKey)) throw new ConversationError('FORBIDDEN', 'The context seed is invalid or expired.');
      const openingMessage = opening ? conversationMessageSchema.parse({ key: opening.key, ...ownership, conversationKey: key, turnKey: `opening:${opening.key}`, requestHash: createHash('sha256').update(input.openingGreetingToken!).digest('hex'), type: 'TEXT', role: 'ASSISTANT', status: 'COMPLETED', content: opening.message, attachments: [], attachmentStatus: 'NONE', retrievals: [], guideTopics: { status: 'NONE' }, createdAt: opening.createdAt, completedAt: opening.createdAt })
        : seed ? conversationMessageSchema.parse({ key: seed.key, ...ownership, conversationKey: key, turnKey: `opening:${seed.key}`, requestHash: createHash('sha256').update(input.openingContextSeedToken!).digest('hex'), type: 'TEXT', role: 'ASSISTANT', status: 'COMPLETED', content: seed.message, attachments: [], retrievals: [], guideTopics: { status: 'NONE' }, createdAt: seed.createdAt, completedAt: seed.createdAt })
        : undefined;
      const actorKey = context.principal.kind === 'member' ? context.principal.userTeam.key : '';
      const created = await repository.create({ key, ...ownership, name: input.name ?? DEFAULT_CONVERSATION_NAME, isFavorite: false, isHidden: false, roleKey: input.roleKey, createdAt: at, updatedAt: at }, actorKey, openingMessage);
      if (created.name !== DEFAULT_CONVERSATION_NAME) await requestArchiveProjection(ownership, created.key, at, actorKey);
      return created;
    },
    list(raw: unknown, context: ToolContext) { return page(context, raw); },
    async search(raw: unknown, context: ToolContext) { const input = conversationSearchInputSchema.parse(raw), ownership = owner(context); const result = await page(context, input, input.query); if (input.recordHistory) await userSearches.record(ownership.userKey, input.query); return result; },
    async rename(raw: unknown, context: ToolContext) { const input = conversationRenameInputSchema.parse(raw), ownership = owner(context), at = now(); const value = await repository.update(ownership, input.conversationKey, { name: input.name, updatedAt: at }); if (!value) throw new ConversationError('NOT_FOUND', 'Conversation not found.'); const state = repository.readArchiveState ? await repository.readArchiveState(ownership, input.conversationKey) : null; if (state) enqueueArchiveState(state); else await requestArchiveProjection(ownership, input.conversationKey, at, context.principal.kind === 'member' ? context.principal.userTeam.key : ''); return value; },
    async favorite(raw: unknown, context: ToolContext) { const input = conversationFavoriteInputSchema.parse(raw); const value = await repository.update(owner(context), input.conversationKey, { isFavorite: input.isFavorite, updatedAt: now() }); if (!value) throw new ConversationError('NOT_FOUND', 'Conversation not found.'); return value; },
    async hide(raw: unknown, context: ToolContext) { const input = conversationHiddenInputSchema.parse(raw); const value = await repository.update(owner(context), input.conversationKey, { isHidden: input.isHidden, updatedAt: now() }); if (!value) throw new ConversationError('NOT_FOUND', 'Conversation not found.'); return value; },
    async setRole(raw: unknown, context: ToolContext) { const input = conversationRoleInputSchema.parse(raw); const value = await repository.update(owner(context), input.conversationKey, { roleKey: input.roleKey, updatedAt: now() }); if (!value) throw new ConversationError('NOT_FOUND', 'Conversation not found.'); return value; },
    async delete(raw: unknown, context: ToolContext) {
      const input = conversationKeyInputSchema.parse(raw), ownership = owner(context);
      if (!await repository.delete(ownership, input.conversationKey)) throw new ConversationError('NOT_FOUND', 'Conversation not found.');
      await import('./archive-projection').then(({ createConversationArchiveProjectionRepository }) => createConversationArchiveProjectionRepository().deleteProjected({ ...ownership, conversationKey: input.conversationKey })).catch((error) => console.error('conversation file projection delete failed', { conversationKey: input.conversationKey, error }));
      await publishContentChanged(ownership.scopeKey).catch(() => undefined);
      return { deletedKey: input.conversationKey };
    },
    async deleteMessage(raw: unknown, context: ToolContext) { const input = conversationMessageDeleteInputSchema.parse(raw), ownership = owner(context), at = now(); const deletedKeys = await repository.deleteMessageTurn(ownership, input.conversationKey, input.messageKey, at); if (!deletedKeys) throw new ConversationError('NOT_FOUND', 'Conversation message not found or cannot be deleted while its response is pending.'); await requestArchiveProjection(ownership, input.conversationKey, at, context.principal.kind === 'member' ? context.principal.userTeam.key : ''); return conversationMessageDeleteResultSchema.parse({ deletedKeys }); },
    async messages(raw: unknown, context: ToolContext) { const input = conversationMessageListInputSchema.parse(raw); const rows = await repository.listMessages(owner(context), input.conversationKey, decodeCursor(input.cursor, messageCursorSchema), input.limit + 1); if (!rows) throw new ConversationError('NOT_FOUND', 'Conversation not found.'); const hasMore = rows.length > input.limit; const items = hasMore ? rows.slice(1) : rows; const first = items[0]; return { items: items.map(projectConversationMessage), nextCursor: hasMore && first ? encodeCursor({ createdAt: first.createdAt, key: first.key }) : null }; },
    async turn(raw: unknown, context: ToolContext, onEvent: (event: ConversationTurnEvent) => void | Promise<void>) {
      const input = conversationSendInputSchema.parse(raw), ownership = owner(context), correlationKey = id(), at = now();
      const conversation = await repository.read(ownership, input.conversationKey);
      if (!conversation) throw new ConversationError('NOT_FOUND', 'Conversation not found.');
      if (input.roleKey && conversation.roleKey !== input.roleKey) throw new ConversationError('CONFLICT', 'The selected chat role has changed.');
      const assistantAt = new Date(new Date(at).getTime() + 1).toISOString();
        const requestHash = createHash('sha256').update(JSON.stringify({ conversationKey: input.conversationKey, message: input.message, attachmentKeys: input.attachmentKeys, referenceImageKeys: input.referenceImageKeys, workspaceFileKeys: input.workspaceFileKeys, workspaceFolderKeys: input.workspaceFolderKeys })).digest('hex');
       const tagged = await taggedWorkspaceContext(context, input.workspaceFileKeys, input.workspaceFolderKeys, Math.max(0, 20_000 - input.message.length));
      const actorKey = context.principal.kind === 'member' ? context.principal.userTeam.key : '';
      const started = await repository.beginTurn(ownership, input.conversationKey,
         { key: id(), ...ownership, conversationKey: input.conversationKey, turnKey: input.requestKey, requestHash, type: 'TEXT', role: 'USER', status: 'COMPLETED', content: input.message, workspaceFiles: tagged.files, attachments: [], attachmentStatus: input.attachmentKeys.length ? 'PENDING' : 'NONE', ...(input.attachmentKeys.length ? { pendingAttachmentKeys: input.attachmentKeys } : {}), retrievals: [], guideTopics: { status: 'NONE' }, createdAt: at, completedAt: at },
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
        if (input.attachmentKeys.length) {
          const claimed = await attachmentArtifacts.readClaimed(ownership, started.user.key, input.attachmentKeys);
          if (claimed.length !== input.attachmentKeys.length) throw new ConversationError('CONFLICT', 'Claimed attachment manifests are unavailable.');
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
        const contextSummaries = firstUserTurn && input.contextConversationKeys.length ? (await Promise.all(input.contextConversationKeys.map(async (conversationKey) => {
          const conversation = await repository.read(ownership, conversationKey);
          if (!conversation) return null;
          const summary = await repository.readArchiveSummary?.(ownership, conversationKey).catch(() => null) ?? null;
          return summary ? `Chat "${conversation.name}": ${summary}` : `Chat "${conversation.name}"`;
        }))).filter((value): value is string => Boolean(value)) : [];
         const agentContext = prioritizedAgentContext(currentConversationSummary, recent);
         if (!input.workspaceFileKeys.length && !input.workspaceFolderKeys.length) {
           const previousUser = [...recent].reverse().find((message) => message.role === 'USER');
           if (previousUser?.workspaceFiles?.length) {
             const prior = await taggedWorkspaceContext(context, previousUser.workspaceFiles.slice(0, 8).map(({ key }) => key), [], 8_000).catch(() => null);
             const historical = agentContext.context.find((message) => message.role === 'user' && message.createdAt === previousUser.createdAt);
             if (prior?.preface && historical && Buffer.byteLength(JSON.stringify(agentContext), 'utf8') + Buffer.byteLength(prior.preface, 'utf8') + 4 < MAX_CONTEXT_BYTES) historical.content = `${historical.content}\n\n${prior.preface}`;
           }
         }
        if (contextSummaries.length) agentContext.context.unshift({ role: 'user', content: `Prior chats used as context:\n${contextSummaries.join('\n\n')}`.slice(0, 20_000), createdAt: at });
        const retrievals: AppSearchRetrieval[] = [];
        let response: Awaited<ReturnType<typeof core>> | undefined;
        let agentError: unknown;
          const agentMessage = `${tagged.preface}${input.message}`;
         const maximumAttempts = attachments.some(({ kind }) => kind === 'image') ? 1 : 2;
        for (let attempt = 0; attempt < maximumAttempts && !response; attempt += 1) {
          retrievals.length = 0;
          const deltas: string[] = [];
          let emitted = false;
          try {
            response = await core({
              systemPrompt: coreAgent.systemPrompt,
              roleKey: conversation.roleKey,
              ...agentContext,
              message: agentMessage, currentDate: at, requestKey: input.requestKey, generateName: firstUserTurn, attachments,
            }, {
              toolContext: context, conversationService: service, currentConversationKey: input.conversationKey, currentUserMessageContent: agentMessage,
              onDelta: async (text) => {
                deltas.push(text);
                emitted = true;
                await onEvent({ type: 'delta', correlationKey, assistantMessageKey: started.assistant.key, text });
              },
              onEvidence: (sources) => { retrievals.push(...sources.slice(0, Math.max(0, 4 - retrievals.length))); },
              onToolSucceeded: (slug, arguments_, result) => {
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
          }
        }
        if (!response) throw agentError ?? new ConversationError('FAILED', 'Core did not return a response.');
        const completed = await repository.completeTurn(ownership, input.conversationKey, started.assistant.key, response.message, undefined, retrievals, now(), response.name);
        if (!completed) throw new ConversationError('CONFLICT', 'Conversation changed before the answer completed.');
        const nameApplied = completed.nameApplied;
        await onEvent({ type: 'done', correlationKey, conversationKey: input.conversationKey, message: projectConversationMessage(completed.message), ...(nameApplied && response.name ? { name: response.name } : {}), replayed: false });
        requestArchiveProjectionInBackground(ownership, input.conversationKey, completed.message.completedAt!, actorKey);
      } catch (error) {
        const failedAt = now();
        await repository.failTurn(ownership, input.conversationKey, started.assistant.key, failedAt);
        await requestArchiveProjection(ownership, input.conversationKey, failedAt, actorKey);
        throw error;
      } finally {
        void enqueueAttachmentPersistence().catch((error) => console.error('conversation attachment persistence scheduling failed; durable recovery will retry', { userMessageKey: started.user.key, error }));
      }
    },
    async seedContext(raw: unknown, context: ToolContext, onEvent: (event: ConversationSeedEvent) => void | Promise<void>) {
      const input = conversationContextSeedInputSchema.parse(raw), ownership = owner(context), correlationKey = id(), at = now();
      const assistantMessageKey = id();
      const briefs = (await Promise.all(input.conversationKeys.map(async (conversationKey) => {
        const conversation = await repository.read(ownership, conversationKey);
        if (!conversation) return null;
        const summary = await repository.readArchiveSummary?.(ownership, conversationKey).catch(() => null) ?? null;
        return { key: conversationKey, name: conversation.name, summary };
      }))).filter((value): value is { key: string; name: string; summary: string | null } => Boolean(value));
      if (!briefs.length) throw new ConversationError('NOT_FOUND', 'No readable chats were selected.');
      await onEvent({ type: 'start', correlationKey, assistantMessageKey });
      const source = briefs.map((brief) => brief.summary ? `Chat "${brief.name}":\n${brief.summary}` : `Chat "${brief.name}"`).join('\n\n');
      const deltas: string[] = [];
      let response: Awaited<ReturnType<typeof core>> | undefined;
      let agentError: unknown;
      try {
        response = await core({
          systemPrompt: coreAgent.systemPrompt,
          taskInstructions: 'The user started a new chat using other chats as context. Speak as Core, never as the user. Write a short orientation of what those chats are about so the user can continue. A few compact paragraphs, detailed enough to be useful, not a transcript and not a heading.',
          context: [],
          recalledContext: [],
          message: `Orient me on these chats:\n\n${source}`.slice(0, 20_000),
          currentDate: at,
          requestKey: correlationKey,
          generateName: false,
          attachments: [],
          preloadedTools: [],
        }, {
          toolContext: context,
          conversationService: service,
          currentUserMessageContent: source,
          onDelta: async (text) => {
            deltas.push(text);
            await onEvent({ type: 'delta', correlationKey, assistantMessageKey, text });
          },
        }, agentDependencies);
      } catch (error) {
        if (agentDependencies.router?.signal?.aborted) throw error;
        if (error instanceof AgentStreamProtocolError) throw error;
        agentError = error;
        if (deltas.length) response = { message: deltas.join(''), tools: [] };
      }
      if (!response?.message.trim()) throw agentError ?? new ConversationError('FAILED', 'Core did not return a response.');
      const message = response.message.trim().slice(0, 4_000);
      const persistenceToken = await issueConversationContextSeedToken({ key: assistantMessageKey, ...ownership, message, conversationKeys: briefs.map((brief) => brief.key), createdAt: at });
      await onEvent({ type: 'done', correlationKey, assistantMessageKey, message, persistenceToken });
    },
    async incognitoTurn(raw: unknown, context: ToolContext, onEvent: (event: ConversationTurnEvent) => void | Promise<void>) {
      const input = conversationIncognitoSendInputSchema.parse(raw), ownership = owner(context), correlationKey = id(), at = now();
      const assistantAt = new Date(new Date(at).getTime() + 1).toISOString();
      const conversationKey = id();
      const requestHash = createHash('sha256').update(JSON.stringify({ incognito: true, message: input.message, requestKey: input.requestKey })).digest('hex');
       const tagged = await taggedWorkspaceContext(context, input.workspaceFileKeys, input.workspaceFolderKeys, Math.max(0, 20_000 - input.message.length));
       const user = conversationMessageSchema.parse({ key: id(), ...ownership, conversationKey, turnKey: input.requestKey, requestHash, type: 'TEXT', role: 'USER', status: 'COMPLETED', content: input.message, workspaceFiles: tagged.files, attachments: [], attachmentStatus: 'NONE', retrievals: [], guideTopics: { status: 'NONE' }, createdAt: at, completedAt: at });
      const assistant = conversationMessageSchema.parse({ key: id(), ...ownership, conversationKey, turnKey: input.requestKey, requestHash, type: 'TEXT', role: 'ASSISTANT', status: 'PENDING', content: 'Pending', attachments: [], attachmentStatus: 'NONE', retrievals: [], guideTopics: { status: 'NONE' }, createdAt: assistantAt });
      await onEvent({ type: 'start', correlationKey, conversationKey, userMessageKey: user.key, assistantMessageKey: assistant.key, userMessage: projectConversationMessage(user) });
      const agentContext = {
        context: input.history.map((item) => ({ role: item.role.toLowerCase() as 'user' | 'assistant', content: item.content, createdAt: at })),
        recalledContext: [] as Array<{ role: 'user' | 'assistant'; content: string; createdAt: string }>,
      };
      const retrievals: AppSearchRetrieval[] = [];
       const agentMessage = `${tagged.preface}${input.message}`;
      const deltas: string[] = [];
      let response: Awaited<ReturnType<typeof core>> | undefined;
      let agentError: unknown;
      try {
        response = await core({
          systemPrompt: coreAgent.systemPrompt,
          roleKey: input.roleKey,
          ...agentContext,
          message: agentMessage, currentDate: at, requestKey: input.requestKey, generateName: false, attachments: [],
          preloadedTools: [],
        }, {
          toolContext: context, conversationService: service, currentUserMessageContent: agentMessage,
          onDelta: async (text) => {
            deltas.push(text);
            await onEvent({ type: 'delta', correlationKey, assistantMessageKey: assistant.key, text });
          },
          onEvidence: (sources) => { retrievals.push(...sources.slice(0, Math.max(0, 4 - retrievals.length))); },
          onToolSucceeded: (slug, _arguments, result) => {
            if (retrievals.length >= 4) return;
            const retrieval = projectToolResultRetrieval(slug, result);
            if (retrieval) retrievals.push(retrieval);
          },
        }, agentDependencies);
      } catch (error) {
        if (agentDependencies.router?.signal?.aborted) throw error;
        if (error instanceof AgentStreamProtocolError) throw error;
        agentError = error;
        if (deltas.length) response = { message: deltas.join(''), tools: [] };
      }
      if (!response) throw agentError ?? new ConversationError('FAILED', 'Core did not return a response.');
      const completed = conversationMessageSchema.parse({ ...assistant, status: 'COMPLETED', content: response.message, retrievals, completedAt: now(), guideTopics: { status: 'NONE' } });
      await onEvent({ type: 'done', correlationKey, conversationKey, message: projectConversationMessage(completed), replayed: false });
    },
  };
  return service;
}

let service: ConversationService | undefined;
export const getDefaultConversationService = () => service ??= createConversationService();
