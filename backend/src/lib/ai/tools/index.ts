import { ACTION_REGISTRY } from '@/lib/ai/actions';
import { AiError } from '@/lib/ai/shared/result';
import { isValidToolIdFormat, toolDefinitionSchema, TOOL_IDS, type ToolDefinition, type ToolId } from './types';

export { TOOL_IDS, toolIdSchema, toolDefinitionSchema, isValidToolIdFormat, type ToolId, type ToolDefinition } from './types';

export class UnknownToolError extends AiError {
  constructor(toolId: string) {
    super('unknown_tool', `Unknown tool: ${toolId}`);
  }
}

/**
 * Built-in tools. Every tool references an action only — the router picks
 * the model/provider route at execution time from the organization's
 * enabled providers. Built-ins are unscoped (scopeId: null): available to
 * any agent WITHOUT guardrails, denied to guardrailed agents unless an
 * organization-scoped variant is defined.
 */
export const TOOL_REGISTRY = {
  'ask.answer': {
    id: 'ask.answer',
    name: 'Ask',
    description: 'Answer the user over the current message history. Granting this tool is what gives an agent a conversational surface at all.',
    actionId: 'core.ask',
    scopeId: null,
  },

  'reason.solve': {
    id: 'reason.solve',
    name: 'Solve',
    description: 'Work through a hard problem step by step before answering.',
    actionId: 'core.reason',
    scopeId: null,
    routing: { strategy: 'quality' },
  },

  'image.create': {
    id: 'image.create',
    name: 'Create Image',
    description: 'Generate a new image from a text prompt.',
    actionId: 'image.generate',
    scopeId: null,
    routing: { strategy: 'quality' },
  },

  'audio.transcribe-file': {
    id: 'audio.transcribe-file',
    name: 'Transcribe Audio',
    description: 'Convert speech in an uploaded audio file into text.',
    actionId: 'audio.transcribe',
    scopeId: null,
    routing: { strategy: 'cost' },
  },

  'speech.narrate': {
    id: 'speech.narrate',
    name: 'Narrate',
    description: 'Synthesize spoken audio from text.',
    actionId: 'audio.generate-speech',
    scopeId: null,
  },
} satisfies Record<ToolId, ToolDefinition>;

export function getTool(toolId: string): ToolDefinition {
  const tool = (TOOL_REGISTRY as Record<string, ToolDefinition>)[toolId];
  if (!tool) throw new UnknownToolError(toolId);
  return tool;
}

export function listTools(): readonly ToolDefinition[] {
  return Object.values<ToolDefinition>(TOOL_REGISTRY);
}

/**
 * Verifies the registry: every TOOL_IDS entry present, no unknown keys,
 * dot notation, every referenced action registered, non-empty names and
 * descriptions — and, structurally, tools reference actions only (the
 * strict schema has no field that could hold a provider or endpoint).
 */
export function assertToolRegistryIntegrity(): void {
  const seen = new Set<string>();
  for (const id of TOOL_IDS) {
    if (seen.has(id)) throw new Error(`Duplicate tool id in TOOL_IDS: ${id}`);
    seen.add(id);
    if (!isValidToolIdFormat(id)) throw new Error(`Tool id does not follow <domain>.<tool> dot notation: ${id}`);
  }

  const registryKeys = Object.keys(TOOL_REGISTRY);
  for (const id of TOOL_IDS) {
    if (!registryKeys.includes(id)) throw new Error(`TOOL_REGISTRY is missing tool: ${id}`);
  }
  for (const key of registryKeys) {
    if (!seen.has(key)) throw new Error(`TOOL_REGISTRY contains unknown tool id: ${key}`);
  }

  for (const [key, definition] of Object.entries(TOOL_REGISTRY)) {
    const parsed = toolDefinitionSchema.parse(definition);
    if (parsed.id !== key) throw new Error(`TOOL_REGISTRY key ${key} does not match its definition id ${parsed.id}`);
    if (!(parsed.actionId in ACTION_REGISTRY)) {
      throw new Error(`Tool ${key} references unregistered action ${parsed.actionId}`);
    }
  }
}
