import { getAction } from '@/lib/ai/actions';
import { getTool } from '@/lib/ai/tools';
import type { AgentDefinition } from './types';

/**
 * Prompt compilation: deterministically assembles an agent's system prompt
 * from its skill text and its granted tools (with each tool's action
 * described from the action registry — a single source of truth, never
 * hand-duplicated into prompts). Same agent in → same prompt out; the
 * router and providers stay entirely out of the prompt.
 */
export function compileAgentSystemPrompt(agent: AgentDefinition): string {
  const toolLines = agent.toolIds.map((toolId) => {
    const tool = getTool(toolId);
    const action = getAction(tool.actionId);
    return `- ${tool.id} — ${tool.name}: ${tool.description} (action ${tool.actionId}: ${action.description})`;
  });

  return [
    `# ${agent.name}`,
    '',
    agent.skill.trim(),
    '',
    '## Available tools',
    ...toolLines,
  ].join('\n');
}
