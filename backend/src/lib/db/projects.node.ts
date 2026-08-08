import { z } from 'zod';
import { createNodeHelpers } from './base';
import { normalizeLegacyProjectContract } from './legacy-contracts';

export const PROJECTS_COLLECTION = 'projects';

const currentProjectSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  contentFolderKey: z.string().cuid(),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  embedding: z.array(z.number().finite()).default([]),
  deletedAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const projectSchema = Object.assign(
  z.preprocess(normalizeLegacyProjectContract, currentProjectSchema),
  { shape: currentProjectSchema.shape },
) as unknown as typeof currentProjectSchema;

export type Project = z.infer<typeof projectSchema>;
export const projectsEmbeddingFields = ['name', 'description'] as const;
const helpers = createNodeHelpers(PROJECTS_COLLECTION, projectSchema, projectsEmbeddingFields);
export const insertProject = helpers.insert;
export const getProjectById = helpers.getById;
export const updateProject = helpers.updateById;
export const deleteProject = helpers.deleteById;
export const upsertProjectByKey = helpers.upsertByKey;
export const getAllProjectsChunked = helpers.getAllChunked;
export const listProjectsPage = helpers.listPage;
