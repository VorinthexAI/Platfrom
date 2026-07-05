import { z } from 'zod';
import { createNodeHelpers } from './base';

export const ORCHESTRATORS_COLLECTION = 'orchestrators';

export const orchestratorSchema = z.object({
  key: z.string(),
  name: z.string(),
  storagePath: z.string(),
  model: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type Orchestrator = z.infer<typeof orchestratorSchema>;

export const orchestratorsEmbedKeys = z.enum(['name', 'model']);

const helpers = createNodeHelpers(ORCHESTRATORS_COLLECTION, orchestratorSchema, orchestratorsEmbedKeys.options);

export const insertOrchestrator = helpers.insert;
export const getOrchestratorById = helpers.getById;
export const updateOrchestrator = helpers.updateById;
export const deleteOrchestrator = helpers.deleteById;
export const upsertOrchestratorByKey = helpers.upsertByKey;
export const getAllOrchestratorsChunked = helpers.getAllChunked;
export const listOrchestratorsPage = helpers.listPage;

