import { coreAgentToolInputSchema } from '@/lib/ai/agents/schemas';
import type { AgentRuntimeDependencies } from '@/lib/ai/agents';
import type { ConversationService } from '@/lib/conversations/service';
import { contentZodToJsonSchema } from './content-json-schema';
import type { ToolContext } from './tool-context';
import type { gatherWorkspaceContext } from '@/lib/ai/agents/workspace-context';
import type { AppSearchRetrieval } from '@/lib/app-search/service';
import { z } from 'zod';
import { agentQueryInputSchema } from '@/lib/ai/agents/workspace-query-schema';

export const agentContextInputSchema = z.object({}).strict();

export interface AgentToolDependencies {
  context: ToolContext;
  conversations?: ConversationService;
  requestKey?: string;
  agentDependencies?: AgentRuntimeDependencies;
  currentUserMessageContent?: string;
  recentConversationContext?: string[];
  currentConversationKey?: string;
  onEvidence?: (retrievals: AppSearchRetrieval[]) => void;
  signal?: AbortSignal;
}

export function createAgentContextTool(gather?: typeof gatherWorkspaceContext) {
  return {
    name: 'agent.context',
    inputSchema: agentContextInputSchema,
    isReadOnly: () => true,
    providerDefinition: {
      name: 'agent.context',
      description: 'Read relevant authorized workspace and account evidence for the current user request. Call once only when private data is needed; then answer from this evidence without another read call.',
      inputSchema: contentZodToJsonSchema(agentContextInputSchema),
    },
    async execute(raw: unknown, dependencies: AgentToolDependencies) {
      agentContextInputSchema.parse(raw);
      if (!dependencies.requestKey) throw new Error('agent.context requires a trusted request key.');
      if (!dependencies.currentUserMessageContent) throw new Error('agent.context requires the trusted current user request.');
      const run = gather ?? dependencies.agentDependencies?.workspaceContext ?? (await import('@/lib/ai/agents/workspace-context')).gatherWorkspaceContext;
      const gathered = await run(dependencies.currentUserMessageContent, dependencies.context, { signal: dependencies.signal, conversations: dependencies.conversations, currentConversationKey: dependencies.currentConversationKey }, dependencies.recentConversationContext ?? []);
      const { navigation, ...modelEvidence } = gathered;
      if (navigation?.length) dependencies.onEvidence?.(navigation);
      return modelEvidence;
    },
  } as const;
}

export const AGENT_TOOL_DEFINITIONS = Object.freeze([createAgentContextTool(), {
  name: 'agent.query',
  inputSchema: agentQueryInputSchema,
  isReadOnly: (): boolean => true,
  providerDefinition: {
    name: 'agent.query',
    description: 'Read current-scope authorized workspace data in one batch. For unknown or cross-app resource types use resource workspace with operation search or discover and a concise distinguishing query. Otherwise request search, list, exact count, sum, or named read over registered resources. For a named collection, folder, inbox, trip, or place use parent.name; for an unambiguous follow-up use parent.recent. A read should specify the exact title in query. For storage sums use field sizeBytes (the default for images, documents, and files); for listening minutes sum books with estimatedMinutes. Memories and highlights can be listed within a collection; trip-guides and place-references require their named trip or place. Never supply identity or scope keys.',
    inputSchema: contentZodToJsonSchema(agentQueryInputSchema),
  },
  async execute(raw: unknown, dependencies: AgentToolDependencies) {
    agentQueryInputSchema.parse(raw);
    if (!dependencies.requestKey) throw new Error('agent.query requires a trusted request key.');
    const { queryWorkspace } = await import('@/lib/ai/agents/workspace-query');
    const history = dependencies.conversations && dependencies.currentConversationKey
      ? await dependencies.conversations.messages({ conversationKey: dependencies.currentConversationKey, limit: 20 }, dependencies.context)
      : undefined;
    const prior = history?.items.filter((item) => item.role === 'ASSISTANT' && item.status === 'COMPLETED' && item.retrievals.length).at(-1);
    return queryWorkspace(raw, dependencies.context, { message: dependencies.currentUserMessageContent, recent: prior?.retrievals, onEvidence: dependencies.onEvidence, signal: dependencies.signal });
  },
}, {
  name: 'agents.core',
  inputSchema: coreAgentToolInputSchema,
  isReadOnly: (): boolean => false,
  providerDefinition: {
    name: 'agents.core',
    description: 'Ask the canonical private workspace agent to answer a message with authorized business tools.',
    inputSchema: contentZodToJsonSchema(coreAgentToolInputSchema),
  },
  async execute(raw: unknown, dependencies: AgentToolDependencies) {
    if (!dependencies.requestKey) throw new Error('agents.core requires a trusted request key.');
    const input = coreAgentToolInputSchema.parse(raw);
    const { coreAgent, executeCoreAgent } = await import('@/lib/ai/agents/core');
    return executeCoreAgent({ ...input, systemPrompt: coreAgent.systemPrompt, currentDate: new Date().toISOString(), requestKey: dependencies.requestKey }, { toolContext: dependencies.context, conversationService: dependencies.conversations }, dependencies.agentDependencies);
  },
}]);
