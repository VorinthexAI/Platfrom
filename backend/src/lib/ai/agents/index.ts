export { runAgent, resolveAgentAllowlist, AgentStreamProtocolError, agentResponseSchema, internalAgentRequestSchema } from './runtime';
export type { AgentRuntimeDependencies, AgentExecutionContext, AgentRoutingMetric } from './runtime';
export type { AgentDefinition, AgentResponse, AgentToolStatus, InternalAgentRequest } from './schemas';
export { coreAgent, executeCoreAgent, CORE_TOOL_DEFINITIONS, agentQueryInputSchema, coreAgentToolInputSchema } from './core';
export type { AgentToolDependencies } from './core';

import { coreAgent } from './core';

export const AGENTS = Object.freeze([coreAgent]);
