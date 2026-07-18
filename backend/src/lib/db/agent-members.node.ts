import { z } from 'zod';
import { createNodeHelpers } from './base';

export const AGENT_MEMBERS_COLLECTION = 'agentMembers';
export const agentMemberSchema = z.object({
  key: z.string().cuid(),
  organizationKey: z.string().trim().min(1),
  scopeKey: z.string().cuid(),
  agentKey: z.string().cuid(),
  scopeAgentKey: z.string().cuid(),
  userOrganizationKey: z.string().cuid(),
  source: z.enum(['inherited', 'explicit']),
  createdByUserOrganizationKey: z.string().cuid().nullable().default(null),
  createdAt: z.string(),
  embedding: z.array(z.number().finite()).default([]),
});

export type AgentMember = z.infer<typeof agentMemberSchema>;
const helpers = createNodeHelpers(AGENT_MEMBERS_COLLECTION, agentMemberSchema);
export const insertAgentMember = helpers.insert;
export const getAgentMemberById = helpers.getById;
export const updateAgentMember = helpers.updateById;
export const deleteAgentMember = helpers.deleteById;
export const upsertAgentMemberByKey = helpers.upsertByKey;
export const getAllAgentMembersChunked = helpers.getAllChunked;
export const listAgentMembersPage = helpers.listPage;
