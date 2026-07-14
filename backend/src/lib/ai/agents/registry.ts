import { AiError } from '@/lib/ai/shared/result';
import { agentDefinitionSchema, type AgentDefinition } from './types';

export class UnknownAgentError extends AiError {
  constructor(agentId: string) {
    super('unknown_agent', `Unknown agent: ${agentId}`);
  }
}

export class DuplicateAgentError extends AiError {
  constructor(agentId: string) {
    super('duplicate_agent', `An agent with id ${agentId} is already registered`);
  }
}

/** Built-in agents shipped with the framework. Unguardrailed by default —
 * guardrails reference organization scope ids that exist only at runtime,
 * so scoped agents are registered dynamically via {@link registerAgent}. */
export const BUILT_IN_AGENTS: readonly AgentDefinition[] = [
  agentDefinitionSchema.parse({
    id: 'vorinthex.assistant',
    name: 'Vorinthex Assistant',
    description: 'General-purpose conversational agent for questions and multi-step problem solving.',
    skill: [
      'You are the Vorinthex assistant. Answer precisely and concretely.',
      'Use reason.solve for multi-step problems before replying; keep answers grounded in what you actually derived.',
    ].join('\n'),
    toolIds: ['ask.answer', 'reason.solve'],
  }),
  agentDefinitionSchema.parse({
    id: 'vorinthex.creator',
    name: 'Vorinthex Creator',
    description: 'Media-creation agent for images and narration.',
    skill: [
      'You are the Vorinthex creator. Turn briefs into finished media.',
      'Confirm the brief conversationally, then produce the asset with the matching creation tool.',
    ].join('\n'),
    toolIds: ['ask.answer', 'image.create', 'speech.narrate'],
    defaultStrategy: 'quality',
  }),
];

const registry = new Map<string, AgentDefinition>(BUILT_IN_AGENTS.map((agent) => [agent.id, agent]));

/** Validates and registers a runtime agent. Duplicate ids are rejected. */
export function registerAgent(definition: unknown): AgentDefinition {
  const agent = agentDefinitionSchema.parse(definition);
  if (registry.has(agent.id)) throw new DuplicateAgentError(agent.id);
  registry.set(agent.id, agent);
  return agent;
}

export function getAgent(agentId: string): AgentDefinition {
  const agent = registry.get(agentId);
  if (!agent) throw new UnknownAgentError(agentId);
  return agent;
}

export function listAgents(): readonly AgentDefinition[] {
  return [...registry.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Test hook: restores the registry to the built-in agents only. */
export function resetAgentRegistry(): void {
  registry.clear();
  for (const agent of BUILT_IN_AGENTS) registry.set(agent.id, agent);
}
