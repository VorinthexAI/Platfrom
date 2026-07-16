import type { z } from 'zod';
import type { AgentRunStep, agentRunStepSchema } from './schema';

export type AgentRunStepInsert = Omit<z.input<typeof agentRunStepSchema>, 'key'> & { key?: string };
export interface AgentRunStepRepository {
  insertStep(input: AgentRunStepInsert): Promise<AgentRunStep>;
  listStepsForRun(agentRunKey: string): Promise<readonly AgentRunStep[]>;
}
