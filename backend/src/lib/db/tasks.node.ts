import { z } from 'zod';
import { createNodeHelpers } from './base';

export const TASKS_COLLECTION = 'tasks';

export const taskStatusSchema = z.enum(['todo', 'in_progress', 'blocked', 'completed']);
export const taskPrioritySchema = z.enum(['low', 'medium', 'high', 'critical']);

export const taskSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  projectKey: z.string().cuid(),
  milestoneKey: z.string().cuid(),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  position: z.number().int().nonnegative(),
  embedding: z.array(z.number().finite()).default([]),
  deletedAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskPriority = z.infer<typeof taskPrioritySchema>;
export type Task = z.infer<typeof taskSchema>;
export const tasksEmbeddingFields = ['title', 'description'] as const;
const helpers = createNodeHelpers(TASKS_COLLECTION, taskSchema, tasksEmbeddingFields);
export const insertTask = helpers.insert;
export const getTaskById = helpers.getById;
export const updateTask = helpers.updateById;
export const deleteTask = helpers.deleteById;
export const upsertTaskByKey = helpers.upsertByKey;
export const getAllTasksChunked = helpers.getAllChunked;
export const listTasksPage = helpers.listPage;
