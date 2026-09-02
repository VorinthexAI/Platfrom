import { coreAgentToolInputSchema } from '@/lib/ai/agents/schemas';
import type { AgentRuntimeDependencies } from '@/lib/ai/agents';
import type { ConversationService } from '@/lib/conversations/service';
import { contentZodToJsonSchema } from './content-json-schema';
import type { ToolContext } from './tool-context';

export interface AgentToolDependencies {
  context: ToolContext;
  conversations?: ConversationService;
  requestKey?: string;
  agentDependencies?: AgentRuntimeDependencies;
}

export const AGENT_TOOL_DEFINITIONS = Object.freeze([{
  name: 'agents.core',
  inputSchema: coreAgentToolInputSchema,
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
