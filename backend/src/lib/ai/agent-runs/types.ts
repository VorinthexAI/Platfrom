import { AiError } from '@/lib/ai/shared/result';
import type { z } from 'zod';
import type { agentRunSchema, AgentRun } from './schema';

/** Insert payload — the repository stamps `key`, `createdAt`, and `updatedAt`. */
export type AgentRunInsert = Omit<z.input<typeof agentRunSchema>, 'key' | 'createdAt' | 'updatedAt'>;

/** Patch payload — identity and creation fields are immutable. */
export type AgentRunPatch = Partial<
  Omit<z.input<typeof agentRunSchema>, 'key' | 'organizationId' | 'agentId' | 'toolId' | 'actionId' | 'startedAt' | 'createdAt' | 'updatedAt'>
>;

export interface AgentRunRepository {
  insertRun(input: AgentRunInsert): Promise<AgentRun>;
  updateRun(key: string, patch: AgentRunPatch): Promise<AgentRun>;
  getRunById(key: string): Promise<AgentRun | null>;
  listRunsForOrganization(organizationId: string, limit?: number): Promise<readonly AgentRun[]>;
}

export class AgentRunNotFoundError extends AiError {
  constructor(key: string) {
    super('agent_run_not_found', `Agent run not found: ${key}`);
  }
}

/** Narrow structural slice of an arangojs `Database` — fakeable in tests. */
export interface AgentRunsDatabase {
  query(
    query: string,
    bindVars?: Record<string, unknown>,
  ): Promise<{ all(): Promise<unknown[]>; next(): Promise<unknown> }>;
  collection(name: string): {
    save(doc: Record<string, unknown>, options?: { returnNew?: boolean }): Promise<unknown>;
    update(
      selector: string,
      patch: Record<string, unknown>,
      options?: { returnNew?: boolean; mergeObjects?: boolean },
    ): Promise<unknown>;
    document(selector: string): Promise<unknown>;
  };
}

/** The slice used by idempotent collection/index setup. */
export interface AgentRunsSetupDatabase {
  collection(name: string): {
    exists(): Promise<boolean>;
    create(): Promise<unknown>;
    ensureIndex(index: { type: 'persistent'; fields: string[]; unique: boolean }): Promise<unknown>;
  };
}
