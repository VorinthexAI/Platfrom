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
  'agent.create': { id: 'agent.create', name: 'Create Agent', description: 'Creates or reuses a complete agent architecture from a validated Genesis manifest.', scopeId: null },
  'artifact.read': { id: 'artifact.read', name: 'Read Artifact', description: 'Lazily load an authorized artifact through its registered context resolver.', scopeId: null },
  'image.create': { id: 'image.create', name: 'Create Image', description: 'Generate a new image from a text prompt.', scopeId: null },
  'audio.transcribe-file': { id: 'audio.transcribe-file', name: 'Transcribe Audio', description: 'Convert speech in an uploaded audio file into text.', scopeId: null },
  'speech.narrate': { id: 'speech.narrate', name: 'Narrate', description: 'Synthesize spoken audio from text.', scopeId: null },
  'organization.member.list': { id: 'organization.member.list', name: 'List Organization Members', description: 'List members of the active organization with role, status, name, email, and alias filters plus pagination and sorting.', scopeId: null },
  'organization.member.read': { id: 'organization.member.read', name: 'Read Organization Members', description: 'Resolve and read detailed member information within the active organization without guessing when identifiers are ambiguous.', scopeId: null },
  'organization.member.add': { id: 'organization.member.add', name: 'Add Organization Member', description: 'Add an existing Vorinthex user to the active organization without sending an invitation.', scopeId: null },
  'organization.member.role.update': { id: 'organization.member.role.update', name: 'Update Organization Member Role', description: 'Update roles for members of the active organization while enforcing role hierarchy and last-owner safeguards.', scopeId: null },
  'organization.member.activate': { id: 'organization.member.activate', name: 'Activate Organization Member', description: 'Reactivate organization access for suspended or inactive members and resynchronize inherited agent access.', scopeId: null },
  'organization.member.suspend': { id: 'organization.member.suspend', name: 'Suspend Organization Member', description: 'Immediately block organization, scope, agent, and delegated execution access while preserving membership relations.', scopeId: null },
  'organization.member.remove': { id: 'organization.member.remove', name: 'Remove Organization Member', description: 'Remove members, immediately revoke runtime access, and clean related access, assignments, schedules, and sessions.', scopeId: null },
  'scope.list': { id: 'scope.list', name: 'List Scopes', description: 'List only scopes the initiating user may read in the active organization, with hierarchy filters and cursor pagination.', scopeId: null },
  'scope.read': { id: 'scope.read', name: 'Read Scopes', description: 'Resolve and read one or more authorized scopes by key, name, slug, alias, or path without guessing ambiguous matches.', scopeId: null },
  'scope.create': { id: 'scope.create', name: 'Create Scope', description: 'Create a non-root scope, its hierarchy relation, and an owner membership for the initiating creator.', scopeId: null },
  'scope.update': { id: 'scope.update', name: 'Update Scope', description: 'Update authorized scope metadata without moving, reordering, archiving, restoring, deleting, or changing access relations.', scopeId: null },
  'scope.move': { id: 'scope.move', name: 'Move Scope', description: 'Move or reorder a scope within its organization while preventing cycles and synchronizing inherited access.', scopeId: null },
  'scope.archive': { id: 'scope.archive', name: 'Archive Scope', description: 'Archive scopes without deleting their data and immediately block new operational activity.', scopeId: null },
  'scope.restore': { id: 'scope.restore', name: 'Restore Scope', description: 'Restore archived scopes under active parents while preserving grants and keeping schedules paused.', scopeId: null },
  'scope.remove': { id: 'scope.remove', name: 'Remove Scope', description: 'Permanently remove an archived empty leaf scope through owner-only confirmation and atomic cleanup.', scopeId: null },
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
