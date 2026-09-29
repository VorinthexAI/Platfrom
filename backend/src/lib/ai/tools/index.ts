import { z } from 'zod';
import type { RouterDependencies } from '@/lib/ai/router';
import { sanitizedAgentMessageSchema } from './input-sanitizer';
import type { ContentToolInput, ContentToolName, ContentToolOutput } from './content-schemas';
import type { ToolContext } from './tool-context';
import { PUBLIC_TOOL_DEFINITIONS, TRUSTED_TOOL_DEFINITIONS, UNIFIED_TOOL_DEFINITIONS } from './tool-definitions';
import type { PublicToolDependencies } from './tool-definition';
import { WORKSPACE_TOOL_DEFINITIONS, type WorkspaceToolDependencies } from './workspace-tool-definitions';
import type { TrustedAccountToolDependencies, TrustedAccountToolName } from './account-tool-definitions';
import { CONVERSATION_TOOL_DEFINITIONS } from './conversation-tool-definitions';
import type { AgentRuntimeDependencies } from '@/lib/ai/agents';
import { AGENT_TOOL_DEFINITIONS } from './agent-tool-definitions';
import type { AgentToolDependencies } from './agent-tool-definitions';
import { observeToolExecution, type ToolBillingDependencies } from '@/lib/ai/events/runtime';
import type { ToolEventRecorder } from '@/lib/ai/events/service';
import type { GuideTopic } from '@/lib/conversations/schemas';

export const TOOL_NAMES = UNIFIED_TOOL_DEFINITIONS.map(({ name }) => name) as [string, ...string[]];
export const toolNameSchema = z.enum(TOOL_NAMES);
export const MODEL_TOOL_NAMES = PUBLIC_TOOL_DEFINITIONS.map(({ name }) => name) as [string, ...string[]];
const modelToolNameSchema = z.enum(MODEL_TOOL_NAMES);
const publicToolDefinitionsByName = new Map(PUBLIC_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));
const workspaceToolDefinitionsByName = new Map(WORKSPACE_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));
const trustedToolDefinitionsByName = new Map(TRUSTED_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));
const conversationToolDefinitionsByName = new Map(CONVERSATION_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));
const agentToolDefinitionsByName = new Map(AGENT_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));
export type TrustedToolName = TrustedAccountToolName;
export type TrustedToolDependencies = TrustedAccountToolDependencies;

export const toolInputSchemas: Record<string, z.ZodTypeAny> = Object.fromEntries(
  UNIFIED_TOOL_DEFINITIONS.map((definition) => [definition.name, definition.inputSchema]),
);

export const TOOL_DEFINITIONS = PUBLIC_TOOL_DEFINITIONS.map(({ providerDefinition }) => providerDefinition);

export function isToolReadOnly(name: string, rawInput: unknown) {
  const toolName = modelToolNameSchema.parse(name);
  const definition = publicToolDefinitionsByName.get(toolName)!;
  return definition.isReadOnly(rawInput);
}

export interface ToolDependencies extends RouterDependencies {
  signal?: AbortSignal;
  contentContext?: ToolContext;
  timeoutMs?: number;
  requestKey?: string;
  conversationService?: AgentToolDependencies['conversations'];
  currentConversationKey?: string;
  currentUserMessageContent?: string;
  recentConversationContext?: string[];
  onEvidence?: (retrievals: import('@/lib/app-search/service').AppSearchRetrieval[]) => void;
  currentReferenceImageKeys?: string[];
  currentStagedImageArtifactKeys?: string[];
  agentDependencies?: AgentRuntimeDependencies;
  recordEvent?: ToolEventRecorder;
  appScopeKey?: string;
  billing?: ToolBillingDependencies;
  onGreetingDelta?: (text: string) => void | Promise<void>;
  onGuideTopic?: (topic: GuideTopic) => void | Promise<void>;
  executeWorkspaceContent?: WorkspaceToolDependencies['executeContent'];
}

export async function runTool(name: string, _skill: string, rawInput: unknown, dependencies: ToolDependencies & { contentContext: ToolContext }): Promise<unknown> {
  const toolName = modelToolNameSchema.parse(name);
  toolInputSchemas[toolName]!.parse(rawInput);
  return observeToolExecution(toolName, dependencies.contentContext, async () => {
    if (toolName === 'app.generate-image') {
      if (!dependencies.requestKey) throw new Error('app.generate-image requires a trusted request key.');
      if (!dependencies.conversationService || !dependencies.currentConversationKey) throw new Error('app.generate-image requires a conversation.');
      return dependencies.conversationService.enqueueImageTurn({ ...(rawInput as object), conversationKey: dependencies.currentConversationKey, requestKey: dependencies.requestKey }, dependencies.contentContext, dependencies.currentStagedImageArtifactKeys ?? []);
    }
    const agentDefinition = agentToolDefinitionsByName.get(toolName);
    if (agentDefinition) return agentDefinition.execute(rawInput, { context: dependencies.contentContext, conversations: dependencies.conversationService, currentConversationKey: dependencies.currentConversationKey, requestKey: dependencies.requestKey, agentDependencies: dependencies.agentDependencies, currentUserMessageContent: dependencies.currentUserMessageContent, recentConversationContext: dependencies.recentConversationContext, onEvidence: dependencies.onEvidence, signal: dependencies.signal });
    const conversationDefinition = conversationToolDefinitionsByName.get(toolName);
    if (conversationDefinition) return conversationDefinition.execute(rawInput, { context: dependencies.contentContext, conversations: dependencies.conversationService, requestKey: dependencies.requestKey, currentConversationKey: dependencies.currentConversationKey, currentReferenceImageKeys: dependencies.currentReferenceImageKeys });
    const workspaceDefinition = workspaceToolDefinitionsByName.get(toolName);
    if (workspaceDefinition) return workspaceDefinition.execute(rawInput, { context: dependencies.contentContext, requestKey: dependencies.requestKey, executeContent: dependencies.executeWorkspaceContent, signal: dependencies.signal, timeoutMs: dependencies.timeoutMs });
    const definition = publicToolDefinitionsByName.get(toolName)!;
    return (definition.execute as (input: unknown, dependencies: PublicToolDependencies) => Promise<unknown>)(rawInput, {
      context: dependencies.contentContext,
      requestKey: dependencies.requestKey,
      conversationService: dependencies.conversationService,
      signal: dependencies.signal,
      timeoutMs: dependencies.timeoutMs,
      onGreetingDelta: dependencies.onGreetingDelta,
      onGuideTopic: dependencies.onGuideTopic,
      executeContent: dependencies.executeWorkspaceContent,
    });
  }, { recorder: dependencies.recordEvent, appScopeKey: dependencies.appScopeKey, idempotencyKey: dependencies.requestKey, input: rawInput, ...dependencies.billing });
}

export async function runTrustedTool(name: TrustedToolName, rawInput: unknown, dependencies: TrustedToolDependencies): Promise<unknown> {
  const definition = trustedToolDefinitionsByName.get(name);
  if (!definition) throw new Error(`Unknown trusted tool ${name}`);
  definition.inputSchema.parse(rawInput);
  return (definition.execute as (input: unknown, dependencies: TrustedToolDependencies) => Promise<unknown>)(rawInput, dependencies);
}

export { sanitizeAgentInput, sanitizedAgentMessageSchema } from './input-sanitizer';
export * from './content-errors';
export * from './content-schemas';
export * from './content-json-schema';
export * from './content-registry';
export * from './content-runtime';
export * from './content-run';
export * from './tool-context';
