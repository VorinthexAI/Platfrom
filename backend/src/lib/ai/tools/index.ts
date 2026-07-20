import { AiError } from '@/lib/ai/shared/result';
import { isValidToolIdFormat, toolDefinitionSchema, TOOL_IDS, type ToolDefinition } from './types';

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
export const TOOL_REGISTRY: Record<string, ToolDefinition> = {};
export function getTool(toolId: string): ToolDefinition { const tool = (TOOL_REGISTRY as Record<string, ToolDefinition>)[toolId]; if (!tool) throw new UnknownToolError(toolId); return tool; }
export function listTools() { return Object.values<ToolDefinition>(TOOL_REGISTRY); }
export function assertToolRegistryIntegrity() {
  if (new Set(TOOL_IDS).size !== TOOL_IDS.length) throw new Error('TOOL_IDS contains duplicates');
  for (const id of TOOL_IDS) if (!isValidToolIdFormat(id)) throw new Error(`Invalid tool id: ${id}`);
  for (const [key, definition] of Object.entries(TOOL_REGISTRY)) {
    const parsed = toolDefinitionSchema.parse(definition);
    if (parsed.id !== key) throw new Error(`Tool key mismatch: ${key}`);
  }
}
