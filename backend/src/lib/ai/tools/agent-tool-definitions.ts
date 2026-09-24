import { coreAgentToolInputSchema } from '@/lib/ai/agents/schemas';
import type { AgentRuntimeDependencies } from '@/lib/ai/agents';
import type { ConversationService } from '@/lib/conversations/service';
import { contentZodToJsonSchema } from './content-json-schema';
import type { ToolContext } from './tool-context';
import type { gatherWorkspaceContext } from '@/lib/ai/agents/workspace-context';
import type { AppSearchRetrieval } from '@/lib/app-search/service';
import { z } from 'zod';

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
  name: 'agents.core',
  inputSchema: coreAgentToolInputSchema,
  isReadOnly: () => false,
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
