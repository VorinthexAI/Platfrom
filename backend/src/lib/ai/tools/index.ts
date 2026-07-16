import { AiError } from '@/lib/ai/shared/result';
import { isValidToolIdFormat, toolDefinitionSchema, TOOL_IDS, type ToolDefinition, type ToolId } from './types';

export { TOOL_IDS, toolIdSchema, toolDefinitionSchema, isValidToolIdFormat, type ToolId, type ToolDefinition } from './types';
export {
  toolSchema,
  getToolById,
  getToolBySlug,
  insertTool,
  updateTool,
  deleteTool,
  type Tool,
} from '@/lib/db/tools.node';
export {
  toolActionSchema,
  getToolActionById,
  getToolActionByPair,
  listToolActionsByToolKey,
  type ToolAction,
} from '@/lib/db/tool-actions.node';
export class UnknownToolError extends AiError { constructor(toolId: string) { super('unknown_tool', `Unknown tool: ${toolId}`); } }
export const TOOL_REGISTRY = {
  'ask.answer': { id: 'ask.answer', name: 'Ask', description: 'Answer the user over the current message history. Granting this tool is what gives an agent a conversational surface at all.', scopeId: null },
  'reason.solve': { id: 'reason.solve', name: 'Solve', description: 'Work through a hard problem step by step before answering.', scopeId: null },
  'image.create': { id: 'image.create', name: 'Create Image', description: 'Generate a new image from a text prompt.', scopeId: null },
  'audio.transcribe-file': { id: 'audio.transcribe-file', name: 'Transcribe Audio', description: 'Convert speech in an uploaded audio file into text.', scopeId: null },
  'speech.narrate': { id: 'speech.narrate', name: 'Narrate', description: 'Synthesize spoken audio from text.', scopeId: null },
} satisfies Record<ToolId, ToolDefinition>;
export function getTool(toolId: string): ToolDefinition { const tool = (TOOL_REGISTRY as Record<string, ToolDefinition>)[toolId]; if (!tool) throw new UnknownToolError(toolId); return tool; }
export function listTools() { return Object.values<ToolDefinition>(TOOL_REGISTRY); }
export function assertToolRegistryIntegrity() {
  const keys = Object.keys(TOOL_REGISTRY);
  if (new Set(TOOL_IDS).size !== TOOL_IDS.length) throw new Error('TOOL_IDS contains duplicates');
  for (const id of TOOL_IDS) {
    if (!isValidToolIdFormat(id)) throw new Error(`Invalid tool id: ${id}`);
    if (!keys.includes(id)) throw new Error(`TOOL_REGISTRY is missing tool: ${id}`);
  }
  for (const [key, definition] of Object.entries(TOOL_REGISTRY)) {
    const parsed = toolDefinitionSchema.parse(definition);
    if (parsed.id !== key) throw new Error(`Tool key mismatch: ${key}`);
  }
}
