import { z } from 'zod';
import { createNodeHelpers } from './base';

export const SCOPE_AGENTS_COLLECTION = 'scopeAgents';
export const ACCESS_ROLES = ['owner', 'admin', 'moderator', 'viewer'] as const;
export const accessRoleSchema = z.enum(ACCESS_ROLES);

export const scopeAgentSchema = z.object({
  key: z.string().cuid(),
  organizationKey: z.string().trim().min(1),
  scopeKey: z.string().cuid(),
  agentKey: z.string().cuid(),
  position: z.number().int().positive(),
  status: z.enum(['active', 'archived']).default('active'),
  minimumAccessRole: accessRoleSchema,
  createdByUserOrganizationKey: z.string().cuid().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number().finite()).default([]),
});

export type ScopeAgent = z.infer<typeof scopeAgentSchema>;
const helpers = createNodeHelpers(SCOPE_AGENTS_COLLECTION, scopeAgentSchema);
export const insertScopeAgent = helpers.insert;
export const getScopeAgentById = helpers.getById;
export const updateScopeAgent = helpers.updateById;
export const deleteScopeAgent = helpers.deleteById;
export const upsertScopeAgentByKey = helpers.upsertByKey;
export const getAllScopeAgentsChunked = helpers.getAllChunked;
export const listScopeAgentsPage = helpers.listPage;
