import { contentZodToJsonSchema } from './content-json-schema';
import type { ToolContext } from './tool-context';
import type { ConversationService } from '@/lib/conversations/service';
import { conversationCreateInputSchema, conversationFavoriteInputSchema, conversationImageTurnModelInputSchema, conversationKeyInputSchema, conversationListInputSchema, conversationMessageDeleteInputSchema, conversationMessageListInputSchema, conversationModelSendInputSchema, conversationRenameInputSchema, conversationSearchInputSchema } from '@/lib/conversations/schemas';
import { agentQueryToolContract, executeAgentQueryAdapter } from './conversation-tool-contracts';

type ConversationToolService = Omit<ConversationService, 'query'> & { query(context: ToolContext, input: unknown): Promise<unknown> };
export interface ConversationToolDependencies { context: ToolContext; conversations?: ConversationToolService; requestKey?: string; currentConversationKey?: string; currentReferenceImageKeys?: string[] }
const defaultService = async () => (await import('@/lib/conversations/service')).getDefaultConversationService() as unknown as ConversationToolService;
const build = (name: string, description: string, inputSchema: any, execute: (input: unknown, service: ConversationToolService, dependencies: ConversationToolDependencies) => Promise<unknown>) => ({
  name, inputSchema, providerDefinition: { name, description, inputSchema: contentZodToJsonSchema(inputSchema) },
  async execute(raw: unknown, dependencies: ConversationToolDependencies) { return execute(inputSchema.parse(raw), dependencies.conversations ?? await defaultService(), dependencies); },
});

export const CONVERSATION_TOOL_DEFINITIONS = Object.freeze([
  build('conversation.create', 'Create a private conversation in the current scope.', conversationCreateInputSchema, (input, service, deps) => service.create(input, deps.context)),
  build('conversation.list', 'List private conversations, favorites first.', conversationListInputSchema, (input, service, deps) => service.list(input, deps.context)),
  build('conversation.search', 'Search private conversations by name.', conversationSearchInputSchema, (input, service, deps) => service.search(input, deps.context)),
  build('conversation.rename', 'Rename a private conversation.', conversationRenameInputSchema, (input, service, deps) => service.rename(input, deps.context)),
  build('conversation.favorite', 'Set a private conversation favorite state.', conversationFavoriteInputSchema, (input, service, deps) => service.favorite(input, deps.context)),
  build('conversation.delete', 'Permanently delete a private conversation and its messages.', conversationKeyInputSchema, (input, service, deps) => service.delete(input, deps.context)),
  build('conversation.message.list', 'List messages in a private conversation.', conversationMessageListInputSchema, (input, service, deps) => service.messages(input, deps.context)),
  build('conversation.message.delete', 'Permanently delete a private conversation turn containing the selected message.', conversationMessageDeleteInputSchema, (input, service, deps) => service.deleteMessage(input, deps.context)),
  build('conversation.message.send', 'Send an idempotent user turn and complete its assistant answer.', conversationModelSendInputSchema, async (input, service, deps) => { if (!deps.requestKey) throw new Error('conversation.message.send requires a trusted request key.'); const events: unknown[] = []; await service.turn({ ...(input as object), requestKey: deps.requestKey }, deps.context, (event) => { events.push(event); }); return events.at(-1); }),
  build('conversation.image.enqueue', 'Generate an image in the current Core conversation as one non-blocking image turn.', conversationImageTurnModelInputSchema, async (input, service, deps) => {
    if (!deps.requestKey) throw new Error('conversation.image.enqueue requires a trusted request key.');
    if (!deps.currentConversationKey) throw new Error('conversation.image.enqueue requires a trusted current conversation.');
    return service.enqueueImageTurn({ ...(input as object), ...(deps.currentReferenceImageKeys?.length ? { referenceImageKeys: deps.currentReferenceImageKeys } : {}), conversationKey: deps.currentConversationKey, requestKey: deps.requestKey }, deps.context);
  }),
  { ...agentQueryToolContract, async execute(raw: unknown, dependencies: ConversationToolDependencies) { const service = dependencies.conversations ?? await defaultService(); return executeAgentQueryAdapter(raw, { query: (input) => service.query(dependencies.context, input) }); } },
]);
