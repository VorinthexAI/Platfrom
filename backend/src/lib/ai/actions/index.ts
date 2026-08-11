import { analyzeAudioAction } from './analyze-audio';
import { analyzeVideoAction } from './analyze-video';
import { askAction } from './ask';
import { captionImageAction } from './caption-image';
import { chatAction } from './chat';
import { deepReasonAction } from './deep-reason';
import { deleteActionDefinition } from './delete';
import { documentEmbedAction } from './document-embed';
import { documentExtractAction } from './document-extract';
import { documentGenerateContentAction } from './document-generate-content';
import { documentGenerateHtmlAction } from './document-generate-html';
import { documentInsertAction } from './document-insert';
import { documentValidateAction } from './document-validate';
import { editImageAction } from './edit-image';
import { editVideoAction } from './edit-video';
import { enhanceAction } from './enhance';
import { embedAction } from './embed';
import { extendVideoAction } from './extend-video';
import { generateImageAction } from './generate-image';
import { generateMusicAction } from './generate-music';
import { generateSpeechAction } from './generate-speech';
import { generateVideoAction } from './generate-video';
import { insertActionDefinition } from './insert';
import { orchestratorChatAction } from './orchestrator-chat';
import { readAction } from './read';
import { reasonAction } from './reason';
import { speakAction } from './speak';
import { storageUploadAction } from './storage-upload';
import { transcribeAction } from './transcribe';
import { translateAction } from './translate';
import { traverseAction } from './traverse';
import { ACTION_SLUGS, actionIdSchema, isValidActionIdFormat, type ActionDefinition, type ActionId } from './types';
import { updateActionDefinition } from './update';
import { upsertAction } from './upsert';
import { webSearchAction } from './web-search';

export type { ActionDefinition, ActionId, ActionModelBinding, ActionModelPolicy } from './types';
export { analyzeAudioAction } from './analyze-audio';
export { analyzeVideoAction } from './analyze-video';
export { askAction } from './ask';
export { captionImageAction } from './caption-image';
export { chatAction } from './chat';
export { deepReasonAction } from './deep-reason';
export { deleteActionDefinition } from './delete';
export { documentEmbedAction } from './document-embed';
export { documentExtractAction } from './document-extract';
export { documentGenerateContentAction } from './document-generate-content';
export { documentGenerateHtmlAction } from './document-generate-html';
export { documentInsertAction } from './document-insert';
export { documentValidateAction } from './document-validate';
export { editImageAction } from './edit-image';
export { editVideoAction } from './edit-video';
export { enhanceAction } from './enhance';
export { embedAction } from './embed';
export { extendVideoAction } from './extend-video';
export { generateImageAction } from './generate-image';
export { generateMusicAction } from './generate-music';
export { generateSpeechAction } from './generate-speech';
export { generateVideoAction } from './generate-video';
export { insertActionDefinition } from './insert';
export { orchestratorChatAction } from './orchestrator-chat';
export { readAction } from './read';
export { reasonAction } from './reason';
export { speakAction } from './speak';
export { storageUploadAction } from './storage-upload';
export { transcribeAction } from './transcribe';
export { translateAction } from './translate';
export { traverseAction } from './traverse';
export { updateActionDefinition } from './update';
export { upsertAction } from './upsert';
export { webSearchAction } from './web-search';
export { ACTION_SLUGS, actionIdSchema, isValidActionIdFormat } from './types';
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

/** Stable, provider- and domain-neutral runtime primitives. */
export const ACTION_DEFINITIONS: readonly ActionDefinition[] = [
  askAction, chatAction, reasonAction, deepReasonAction, embedAction, speakAction, transcribeAction, webSearchAction,
  traverseAction, readAction, insertActionDefinition, upsertAction, updateActionDefinition, deleteActionDefinition,
  generateImageAction, editImageAction, generateVideoAction, editVideoAction, extendVideoAction, analyzeVideoAction,
  generateSpeechAction, analyzeAudioAction, generateMusicAction, orchestratorChatAction,
  documentValidateAction, storageUploadAction, documentExtractAction, documentGenerateHtmlAction,
  documentGenerateContentAction, documentEmbedAction, documentInsertAction, enhanceAction, translateAction, captionImageAction,
];
export const getActionDefinition = (id: ActionId) => ACTION_DEFINITIONS.find((definition) => definition.id === id);

export function assertActionRegistryIntegrity(): void {
  if (new Set(ACTION_SLUGS).size !== ACTION_SLUGS.length) {
    throw new Error('ACTION_SLUGS contains duplicate action slugs');
  }
  for (const slug of ACTION_SLUGS) {
    if (!isValidActionIdFormat(slug)) {
      throw new Error(`Action slug does not follow lowercase dot notation: ${slug}`);
    }
  }
  const definitions = new Map(ACTION_DEFINITIONS.map((definition) => [definition.id, definition]));
  if (definitions.size !== ACTION_DEFINITIONS.length || ACTION_SLUGS.some((slug) => !definitions.has(slug))) {
    throw new Error('ACTION_SLUGS and ACTION_DEFINITIONS must define the same unique actions');
  }
  for (const definition of ACTION_DEFINITIONS) {
    if (definition.modelPolicy === 'none' && definition.models.length > 0) throw new Error(`${definition.id} cannot bind models with modelPolicy none`);
    if (definition.modelPolicy === 'required' && definition.models.length === 0) throw new Error(`${definition.id} requires at least one model binding`);
  }
}
