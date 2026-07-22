import { z } from 'zod';
import { createNodeHelpers } from './base';

export const MILESTONES_COLLECTION = 'milestones';

export const milestoneStatusSchema = z.enum(['planned', 'active', 'completed', 'cancelled']);

export const milestoneSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  projectKey: z.string().cuid(),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  status: milestoneStatusSchema,
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  completedAt: z.string().datetime().optional(),
  order: z.number().int().nonnegative(),
  embedding: z.array(z.number().finite()).default([]),
  deletedAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type MilestoneStatus = z.infer<typeof milestoneStatusSchema>;
export type Milestone = z.infer<typeof milestoneSchema>;
export const milestonesEmbeddingFields = ['name', 'description'] as const;
const helpers = createNodeHelpers(MILESTONES_COLLECTION, milestoneSchema, milestonesEmbeddingFields);
export const insertMilestone = helpers.insert;
export const getMilestoneById = helpers.getById;
export const updateMilestone = helpers.updateById;
export const deleteMilestone = helpers.deleteById;
export const upsertMilestoneByKey = helpers.upsertByKey;
export const getAllMilestonesChunked = helpers.getAllChunked;
export const listMilestonesPage = helpers.listPage;
