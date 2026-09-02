import { createHash } from 'node:crypto';
import { z } from 'zod';
import { newId } from '@/lib/ids';
import { embedText } from '@/lib/embeddings';
import { coreAgent, executeCoreAgent } from '@/lib/ai/agents/core';
import type { AgentRuntimeDependencies } from '@/lib/ai/agents';
import type { ExecuteActionOptions } from '@/lib/ai/router';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { getDefaultUserSearchService, type UserSearchService } from '@/lib/user-searches/service';
import { appSearchRetrievalSchema, projectAppSearchRetrieval, type AppSearchRetrieval } from '@/lib/app-search/service';
import { getDefaultConversationRepository, type ConversationRepository } from './repository';
import {
  agentQueryInputSchema, conversationCreateInputSchema, conversationFavoriteInputSchema, conversationKeyInputSchema,
  conversationListInputSchema, conversationMessageListInputSchema, conversationRenameInputSchema, conversationSafeMessageSchema,
  conversationSearchInputSchema, conversationSendInputSchema, decodeCursor, encodeCursor, projectConversationMessage,
  type Conversation, type ConversationMessage,
} from './schemas';

const conversationCursorSchema = z.object({ favorite: z.boolean(), updatedAt: z.string().datetime(), key: z.string().cuid() }).strict();
const messageCursorSchema = z.object({ createdAt: z.string().datetime(), key: z.string().cuid() }).strict();
const queryResultSchema = z.object({ messages: z.array(z.object({ key: z.string().cuid(), conversationKey: z.string().cuid(), role: z.enum(['USER', 'ASSISTANT']), content: z.string(), retrievals: z.array(appSearchRetrievalSchema).max(4), createdAt: z.string().datetime(), similarity: z.number().min(-1).max(1) }).strict()) }).strict();

export type ConversationTurnEvent =
  | { type: 'start'; correlationKey: string; conversationKey: string; userMessageKey: string; assistantMessageKey: string }
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
  messages(raw: unknown, context: ToolContext): Promise<{ items: Array<z.infer<typeof conversationSafeMessageSchema>>; nextCursor: string | null }>;
  query(context: ToolContext, raw: unknown): Promise<z.infer<typeof queryResultSchema>>;
  turn(raw: unknown, context: ToolContext, onEvent: (event: ConversationTurnEvent) => void | Promise<void>): Promise<void>;
}

export class ConversationError extends Error {
  constructor(readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'FAILED', message: string) { super(message); }
}

type Owner = { organizationKey: string; scopeKey: string; userKey: string };
function owner(context: ToolContext): Owner {
  if (context.principal.kind !== 'member' || context.principal.userOrganization.status !== 'active') throw new ConversationError('FORBIDDEN', 'An active user organization membership is required.');
  if (context.principal.userOrganization.organizationId !== context.organizationKey || context.principal.userOrganization.userId !== context.principal.user.key) throw new ConversationError('FORBIDDEN', 'Membership does not belong to the selected user and organization.');
  return { organizationKey: context.organizationKey, scopeKey: context.runtimeScopeKey, userKey: context.principal.user.key };
}

/** Deterministic upper-bound estimate: one estimated token per UTF-8 byte. */
export function estimateConservativeTokens(text: string) { return Buffer.byteLength(text, 'utf8'); }

export function trimConversationQueryResults(rows: Array<{ message: ConversationMessage; similarity: number }>, maxTokens = 10_000, countTokens = estimateConservativeTokens) {
  const chronological = [...rows].sort((left, right) => left.message.createdAt.localeCompare(right.message.createdAt) || left.message.key.localeCompare(right.message.key));
  const project = ({ message, similarity }: (typeof chronological)[number]) => ({ key: message.key, conversationKey: message.conversationKey, role: message.role, content: message.content, retrievals: message.retrievals, createdAt: message.createdAt, similarity });
  while (chronological.length && countTokens(JSON.stringify({ messages: chronological.map(project) })) > maxTokens) chronological.shift();
  return queryResultSchema.parse({ messages: chronological.map(project) });
}

function recentAgentContext(messages: ConversationMessage[]) {
  const context = messages.map((item) => {
    const retrievalContext = item.retrievals.length ? `\n\nHistorical retrieval references (re-run app.search before relying on current resource state): ${JSON.stringify(item.retrievals)}` : '';
    return { role: item.role.toLowerCase() as 'user' | 'assistant', content: item.content.length + retrievalContext.length <= 100_000 ? item.content + retrievalContext : item.content, createdAt: item.createdAt };
  });
  while (context.length && Buffer.byteLength(JSON.stringify(context), 'utf8') > 250_000) context.shift();
  return context;
}

export interface ConversationServiceDependencies {
  repository?: ConversationRepository;
  id?: () => string;
  now?: () => string;
  embed?: typeof embedText;
  agent?: AgentRuntimeDependencies;
  router?: ExecuteActionOptions;
  core?: typeof executeCoreAgent;
  countTokens?: (text: string) => number;
  userSearches?: UserSearchService;
}

export function createConversationService(dependencies: ConversationServiceDependencies = {}): ConversationService {
  const repository = dependencies.repository ?? getDefaultConversationRepository();
  const id = dependencies.id ?? newId;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const embed = dependencies.embed ?? embedText;
  const core = dependencies.core ?? executeCoreAgent;
  const agentDependencies: AgentRuntimeDependencies = { ...dependencies.agent, router: { ...dependencies.agent?.router, ...dependencies.router } };
  const userSearches = dependencies.userSearches ?? getDefaultUserSearchService();
  let service: ConversationService;

  const page = async (context: ToolContext, raw: unknown, query?: string) => {
    const input = query === undefined ? conversationListInputSchema.parse(raw) : conversationSearchInputSchema.parse(raw);
    const rows = await repository.list(owner(context), { ...(query === undefined ? {} : { query }), cursor: decodeCursor(input.cursor, conversationCursorSchema), limit: input.limit + 1, favoriteOnly: input.favoriteOnly });
    const hasMore = rows.length > input.limit; const items = rows.slice(0, input.limit); const last = items.at(-1);
    return { items, nextCursor: hasMore && last ? encodeCursor({ favorite: last.isFavorite, updatedAt: last.updatedAt, key: last.key }) : null };
  };

  const query = async (context: ToolContext, raw: unknown) => {
    const input = agentQueryInputSchema.parse(raw), ownership = owner(context);
    const embedding = await embed({ text: input.query, purpose: 'query', signal: agentDependencies.router?.signal, timeoutMs: agentDependencies.router?.timeoutMs });
    return trimConversationQueryResults(await repository.semanticMessages(ownership, embedding, input.limit), 10_000, dependencies.countTokens);
  };

  service = {
    async create(raw: unknown, context: ToolContext) { const input = conversationCreateInputSchema.parse(raw), at = now(); return repository.create({ key: id(), ...owner(context), name: input.name ?? 'New chat', isFavorite: false, createdAt: at, updatedAt: at }); },
    list(raw: unknown, context: ToolContext) { return page(context, raw); },
    async search(raw: unknown, context: ToolContext) { const input = conversationSearchInputSchema.parse(raw), ownership = owner(context); const result = await page(context, input, input.query); if (input.recordHistory) await userSearches.record(ownership.userKey, input.query); return result; },
    async rename(raw: unknown, context: ToolContext) { const input = conversationRenameInputSchema.parse(raw); const value = await repository.update(owner(context), input.conversationKey, { name: input.name, updatedAt: now() }); if (!value) throw new ConversationError('NOT_FOUND', 'Conversation not found.'); return value; },
    async favorite(raw: unknown, context: ToolContext) { const input = conversationFavoriteInputSchema.parse(raw); const value = await repository.update(owner(context), input.conversationKey, { isFavorite: input.isFavorite, updatedAt: now() }); if (!value) throw new ConversationError('NOT_FOUND', 'Conversation not found.'); return value; },
    async delete(raw: unknown, context: ToolContext) { const input = conversationKeyInputSchema.parse(raw); if (!await repository.delete(owner(context), input.conversationKey)) throw new ConversationError('NOT_FOUND', 'Conversation not found.'); return { deletedKey: input.conversationKey }; },
    async messages(raw: unknown, context: ToolContext) { const input = conversationMessageListInputSchema.parse(raw); const rows = await repository.listMessages(owner(context), input.conversationKey, decodeCursor(input.cursor, messageCursorSchema), input.limit + 1); if (!rows) throw new ConversationError('NOT_FOUND', 'Conversation not found.'); const hasMore = rows.length > input.limit; const items = hasMore ? rows.slice(1) : rows; const first = items[0]; return { items: items.map(projectConversationMessage), nextCursor: hasMore && first ? encodeCursor({ createdAt: first.createdAt, key: first.key }) : null }; },
    query,
    async turn(raw: unknown, context: ToolContext, onEvent: (event: ConversationTurnEvent) => void | Promise<void>) {
      const input = conversationSendInputSchema.parse(raw), ownership = owner(context), correlationKey = id(), at = now();
      const assistantAt = new Date(new Date(at).getTime() + 1).toISOString();
      const requestHash = createHash('sha256').update(JSON.stringify({ conversationKey: input.conversationKey, message: input.message })).digest('hex');
      const started = await repository.beginTurn(ownership, input.conversationKey,
        { key: id(), ...ownership, conversationKey: input.conversationKey, turnKey: input.requestKey, requestHash, role: 'USER', status: 'COMPLETED', content: input.message, retrievals: [], createdAt: at, completedAt: at },
        { key: id(), ...ownership, conversationKey: input.conversationKey, turnKey: input.requestKey, requestHash, role: 'ASSISTANT', status: 'PENDING', content: 'Pending', retrievals: [], createdAt: assistantAt });
      if (!started) throw new ConversationError('NOT_FOUND', 'Conversation not found.');
      if (started.state === 'idempotency-conflict') throw new ConversationError('CONFLICT', 'The request key was already used for a different message.');
      if (started.state === 'busy') throw new ConversationError('CONFLICT', 'Another turn is already in progress for this conversation.');
      await onEvent({ type: 'start', correlationKey, conversationKey: input.conversationKey, userMessageKey: started.user.key, assistantMessageKey: started.assistant.key });
      if (started.state === 'replay') {
        if (started.assistant.status === 'COMPLETED') { await onEvent({ type: 'done', correlationKey, conversationKey: input.conversationKey, message: projectConversationMessage(started.assistant), replayed: true }); return; }
        throw new ConversationError('CONFLICT', 'This turn is already in progress or previously failed.');
      }

      const persistUserEmbedding = embed({ text: input.message, purpose: 'document', signal: agentDependencies.router?.signal, timeoutMs: agentDependencies.router?.timeoutMs })
        .then(async (embedding) => { await repository.setMessageEmbedding(ownership, input.conversationKey, started.user.key, embedding); })
        .catch(() => undefined);
      try {
        const latest = await repository.latestCompletedMessages(ownership, input.conversationKey, 51);
        if (!latest) throw new ConversationError('NOT_FOUND', 'Conversation not found.');
        const recent = latest.filter(({ key }) => key !== started.user.key).slice(-50);
        const retrievals: AppSearchRetrieval[] = [];
        const response = await core({
          systemPrompt: coreAgent.systemPrompt,
          context: recentAgentContext(recent),
          message: input.message, currentDate: at, requestKey: input.requestKey, generateName: started.first,
        }, {
          toolContext: context, conversationService: service,
          onDelta: async (text) => { await onEvent({ type: 'delta', correlationKey, assistantMessageKey: started.assistant.key, text }); },
          onToolSucceeded: (slug, arguments_, result) => {
            if (slug !== 'app.search' || retrievals.length >= 4) return;
            const retrieval = projectAppSearchRetrieval(arguments_, result);
            if (retrieval) retrievals.push(retrieval);
          },
        }, agentDependencies);
        await persistUserEmbedding;
        const embedding = await embed({ text: response.message, purpose: 'document', signal: agentDependencies.router?.signal, timeoutMs: agentDependencies.router?.timeoutMs }).catch(() => undefined);
        const completed = await repository.completeTurn(ownership, input.conversationKey, started.assistant.key, response.message, embedding, retrievals, now(), response.name);
        if (!completed) throw new ConversationError('CONFLICT', 'Conversation changed before the answer completed.');
        await onEvent({ type: 'done', correlationKey, conversationKey: input.conversationKey, message: projectConversationMessage(completed.message), ...(completed.nameApplied && response.name ? { name: response.name } : {}), replayed: false });
      } catch (error) {
        await repository.failTurn(ownership, input.conversationKey, started.assistant.key, now());
        void persistUserEmbedding;
        throw error;
      }
    },
  };
  return service;
}

let service: ConversationService | undefined;
export const getDefaultConversationService = () => service ??= createConversationService();
