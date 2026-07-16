import { AiError } from '@/lib/ai/shared/result';
import type { z } from 'zod';
import type { agentRunSchema, AgentRun } from './schema';

export type AgentRunInsert = Omit<z.input<typeof agentRunSchema>, 'key' | 'createdAt'>;
export type AgentRunUpdate = Pick<AgentRun, 'status' | 'reason' | 'score' | 'endedAt' | 'elapsedMs'>;

export interface AgentRunRepository {
  insertRun(input: AgentRunInsert): Promise<AgentRun>;
  updateRun(key: string, input: AgentRunUpdate): Promise<AgentRun>;
  getRunById(key: string): Promise<AgentRun | null>;
  listRunsForOrganization(organizationKey: string, limit?: number): Promise<readonly AgentRun[]>;
}

export class AgentRunNotFoundError extends AiError {
  constructor(key: string) {
    super('agent_run_not_found', `Agent run not found: ${key}`);
  }
}

export interface AgentRunsDatabase {
  query(query: string, bindVars?: Record<string, unknown>): Promise<{ all(): Promise<unknown[]>; next(): Promise<unknown> }>;
  collection(name: string): {
    save(doc: Record<string, unknown>, options?: { returnNew?: boolean }): Promise<unknown>;
    document(selector: string): Promise<unknown>;
    update(selector: string, doc: Record<string, unknown>, options?: { returnNew?: boolean }): Promise<unknown>;
  };
}

export interface AgentRunsSetupDatabase {
  collection(name: string): {
    exists(): Promise<boolean>;
    create(): Promise<unknown>;
    ensureIndex(index: { type: 'persistent'; fields: string[]; unique: boolean }): Promise<unknown>;
  };
}
