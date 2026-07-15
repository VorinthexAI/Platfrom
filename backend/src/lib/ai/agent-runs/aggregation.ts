import type { AgentRunCall, AgentRunStep, AgentRunStepStatus } from './schema';
import type { AgentRunInsert } from './types';

export type AgentRunStepInput = {
  stepId: string;
  status: AgentRunStepStatus;
  skillKeys: string[];
  startedAt: string;
  endedAt: string;
  elapsedMs: number;
};

const unique = (values: readonly string[]) => [...new Set(values)];

export function aggregateAgentRun(input: {
  organizationKey: string;
  scopeKey: string;
  agentKey: string;
  status: 'accepted' | 'rejected';
  reason: string;
  score: number;
  startedAt: string;
  endedAt: string;
  elapsedMs: number;
  steps: AgentRunStepInput[];
  calls: AgentRunCall[];
}): AgentRunInsert {
  const steps: AgentRunStep[] = input.steps.map((step) => {
    const calls = input.calls.filter((call) => call.stepId === step.stepId);
    return {
      ...step,
      callIds: calls.map((call) => call.callId),
      inputTokens: calls.reduce((sum, call) => sum + call.inputTokens, 0),
      outputTokens: calls.reduce((sum, call) => sum + call.outputTokens, 0),
      totalTokens: calls.reduce((sum, call) => sum + call.totalTokens, 0),
    };
  });

  return {
    ...input,
    steps,
    stepsCount: steps.length,
    callsCount: input.calls.length,
    inputTokens: input.calls.reduce((sum, call) => sum + call.inputTokens, 0),
    outputTokens: input.calls.reduce((sum, call) => sum + call.outputTokens, 0),
    totalTokens: input.calls.reduce((sum, call) => sum + call.totalTokens, 0),
    skillKeys: unique([...steps.flatMap((step) => step.skillKeys), ...input.calls.map((call) => call.skillKey)]),
    toolKeys: unique(input.calls.flatMap((call) => call.toolKey ? [call.toolKey] : [])),
    actionKeys: unique(input.calls.map((call) => call.actionKey)),
    modelKeys: unique(input.calls.map((call) => call.modelKey)),
    providerKeys: unique(input.calls.map((call) => call.providerKey)),
  };
}
