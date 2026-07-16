import { z } from 'zod';
import { agentMemorySchema, type AgentMemory } from './schema';
import { getDefaultAgentMemoryRepository, type AgentMemoryRepository } from './repository';

const memorySelectionSchema = agentMemorySchema.omit({ key: true, embedding: true, createdAt: true }).extend({
  selected: z.boolean(),
}).strict();

export interface AgentMemoryService {
  persistSelection(input: unknown): Promise<AgentMemory | null>;
}

/** Memory is persisted only after an explicit durable-knowledge selection. */
export function createAgentMemoryService(repository: AgentMemoryRepository = getDefaultAgentMemoryRepository()): AgentMemoryService {
  return {
    async persistSelection(input) {
      const selection = memorySelectionSchema.parse(input);
      if (!selection.selected) return null;
      const { selected: _selected, ...memory } = selection;
      return repository.insertMemory(memory);
    },
  };
}
