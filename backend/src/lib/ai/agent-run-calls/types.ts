import type { z } from 'zod';
import type { AgentRunCall, agentRunCallSchema } from './schema';

export type AgentRunCallInsert = Omit<z.input<typeof agentRunCallSchema>, 'key'> & { key?: string };
export interface AgentRunCallRepository {
  insertCall(input: AgentRunCallInsert): Promise<AgentRunCall>;
  listCallsForRun(agentRunKey: string): Promise<readonly AgentRunCall[]>;
}
