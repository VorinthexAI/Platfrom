import { contentZodToJsonSchema } from './content-json-schema';
import type { ToolContext } from './tool-context';
import { getDefaultConversationService, type ConversationService } from '@/lib/conversations/service';
import { conversationCreateInputSchema, conversationFavoriteInputSchema, conversationKeyInputSchema, conversationListInputSchema, conversationMessageListInputSchema, conversationModelSendInputSchema, conversationRenameInputSchema, conversationSearchInputSchema } from '@/lib/conversations/schemas';
import { assistantQueryToolContract, executeAssistantQueryAdapter } from './conversation-tool-contracts';

export interface ConversationToolDependencies { context: ToolContext; conversations?: ConversationService; currentConversationKey?: string; requestKey?: string }
const build = (name: string, description: string, inputSchema: any, execute: (input: unknown, service: ConversationService, dependencies: ConversationToolDependencies) => Promise<unknown>) => ({
  name, inputSchema, providerDefinition: { name, description, inputSchema: contentZodToJsonSchema(inputSchema) },
  async execute(raw: unknown, dependencies: ConversationToolDependencies) { return execute(inputSchema.parse(raw), dependencies.conversations ?? getDefaultConversationService(), dependencies); },
});

export const CONVERSATION_TOOL_DEFINITIONS = Object.freeze([
  build('conversation.create', 'Create a private conversation in the current scope.', conversationCreateInputSchema, (input, service, deps) => service.create(input, deps.context)),
  build('conversation.list', 'List private conversations, favorites first.', conversationListInputSchema, (input, service, deps) => service.list(input, deps.context)),
  build('conversation.search', 'Search private conversations by name.', conversationSearchInputSchema, (input, service, deps) => service.search(input, deps.context)),
  build('conversation.rename', 'Rename a private conversation.', conversationRenameInputSchema, (input, service, deps) => service.rename(input, deps.context)),
  build('conversation.favorite', 'Set a private conversation favorite state.', conversationFavoriteInputSchema, (input, service, deps) => service.favorite(input, deps.context)),
  build('conversation.delete', 'Permanently delete a private conversation and its messages.', conversationKeyInputSchema, (input, service, deps) => service.delete(input, deps.context)),
  build('conversation.message.list', 'List messages in a private conversation.', conversationMessageListInputSchema, (input, service, deps) => service.messages(input, deps.context)),
  build('conversation.message.send', 'Send an idempotent user turn and complete its assistant answer.', conversationModelSendInputSchema, async (input, service, deps) => { if (!deps.requestKey) throw new Error('conversation.message.send requires a trusted request key.'); const events: unknown[] = []; await service.turn({ ...(input as object), requestKey: deps.requestKey }, deps.context, (event) => { events.push(event); }); return events.at(-1); }),
  { ...assistantQueryToolContract, async execute(raw: unknown, dependencies: ConversationToolDependencies) { const service = dependencies.conversations ?? getDefaultConversationService(); return executeAssistantQueryAdapter(raw, { currentConversationKey: dependencies.currentConversationKey, query: (conversationKey, input) => service.query(dependencies.context, conversationKey, input) }); } },
]);
