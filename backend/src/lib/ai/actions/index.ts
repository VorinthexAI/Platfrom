import { ACTION_SLUGS, isValidActionIdFormat } from './types';

export { ACTION_SLUGS, actionIdSchema, type ActionId } from './types';
export { ACTION_DEFINITIONS, getActionDefinition, type ActionDefinition, type ActionModelBinding, type ActionModelPolicy } from './definitions';
export { createDataActions, traverseInputSchema, traverseNodes, type ActionNode, type TraverseInput } from './data';
export { coreChatContentSchema, coreChatMessageSchema, coreChatToolDefinitionSchema, coreChatInputSchema, type CoreChatContent, type CoreChatMessage, type CoreChatToolDefinition, type CoreChatInput } from './core-chat';
export {
  actionSchema,
  getActionById,
  getActionBySlug,
  insertAction,
  updateAction,
  deleteAction,
  type Action,
} from '@/lib/db/actions.node';

export function assertActionRegistryIntegrity(): void {
  if (new Set(ACTION_SLUGS).size !== ACTION_SLUGS.length) {
    throw new Error('ACTION_SLUGS contains duplicate action slugs');
  }
  for (const slug of ACTION_SLUGS) {
    if (!isValidActionIdFormat(slug)) {
      throw new Error(`Action slug does not follow lowercase dot notation: ${slug}`);
    }
  }
}
