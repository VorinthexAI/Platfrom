import { ACTION_SLUGS, actionDefinitionSchema, isValidActionIdFormat, type ActionDefinition, type ActionId } from './types';
import { AUDIO_ACTIONS } from './audio';
import { CORE_ACTIONS } from './core';
import { IMAGE_ACTIONS } from './image';
import { VIDEO_ACTIONS } from './video';
import { WEB_ACTIONS } from './web';

export { ACTION_SLUGS, actionIdSchema, actionDefinitionSchema, type ActionDefinition, type ActionId } from './types';
export { CORE_ACTIONS } from './core';
export { WEB_ACTIONS } from './web';
export { IMAGE_ACTIONS } from './image';
export { VIDEO_ACTIONS } from './video';
export { AUDIO_ACTIONS } from './audio';

export const ACTION_REGISTRY = {
  ...CORE_ACTIONS,
  ...WEB_ACTIONS,
  ...IMAGE_ACTIONS,
  ...VIDEO_ACTIONS,
  ...AUDIO_ACTIONS,
} satisfies Record<ActionId, ActionDefinition>;

export function getAction(actionId: ActionId): ActionDefinition {
  return ACTION_REGISTRY[actionId];
}

/**
 * Verifies the registry against `ACTION_SLUGS`: every slug present, no unknown
 * or duplicate keys, valid dot notation, non-empty names/descriptions.
 * Ran by the test suite and safe to call at startup.
 */
export function assertActionRegistryIntegrity(): void {
  const seen = new Set<string>();
  for (const id of ACTION_SLUGS) {
    if (seen.has(id)) throw new Error(`Duplicate action slug in ACTION_SLUGS: ${id}`);
    seen.add(id);
    if (!isValidActionIdFormat(id)) throw new Error(`Action id does not follow <domain>.<action> dot notation: ${id}`);
  }

  const registryKeys = Object.keys(ACTION_REGISTRY);
  for (const id of ACTION_SLUGS) {
    if (!registryKeys.includes(id)) throw new Error(`ACTION_REGISTRY is missing action: ${id}`);
  }
  for (const key of registryKeys) {
    if (!seen.has(key)) throw new Error(`ACTION_REGISTRY contains unknown action id: ${key}`);
  }

  for (const [key, definition] of Object.entries(ACTION_REGISTRY)) {
    const parsed = actionDefinitionSchema.parse(definition);
    if (parsed.id !== key) throw new Error(`ACTION_REGISTRY key ${key} does not match its definition id ${parsed.id}`);
  }
}
