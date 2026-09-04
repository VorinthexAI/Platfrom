import { aql } from 'arangojs';
import { z } from 'zod';
import { createNodeHelpers, withArangoKey } from './base';
import { db } from './client';

export const TAG_ASSIGNMENTS_COLLECTION = 'tagAssignments';
export const sourceTypeSchema = z.enum(['folder', 'document', 'image-collection', 'image', 'image-highlight', 'image-memory', 'place', 'trip', 'email-inbox', 'email-tone', 'email-thread', 'email-message', 'email-draft', 'book']);
export const tagAssignmentSourceSchema = z.enum(['user', 'ai']);
export const tagAssignmentSchema = z.object({ key: z.string().cuid(), scopeKey: z.string().cuid(), tagKey: z.string().cuid(), sourceType: sourceTypeSchema, sourceKey: z.string().cuid(), source: tagAssignmentSourceSchema, createdAt: z.string().datetime() });
export type TagAssignment = z.infer<typeof tagAssignmentSchema>;
export const tagAssignmentsEmbeddingFields = [] as const;
const helpers = createNodeHelpers(TAG_ASSIGNMENTS_COLLECTION, tagAssignmentSchema, tagAssignmentsEmbeddingFields, { requireEmbedding: false });
export const insertTagAssignment = helpers.insert;
export const getTagAssignmentById = helpers.getById;
export const updateTagAssignment = helpers.updateById;
export const deleteTagAssignment = helpers.deleteById;
export const upsertTagAssignmentByKey = helpers.upsertByKey;
export const getAllTagAssignmentsChunked = helpers.getAllChunked;
export const listTagAssignmentsPage = helpers.listPage;
export async function listTagAssignmentsByScope(scopeKey: string, sourceType?: z.infer<typeof sourceTypeSchema>, sourceKey?: string): Promise<TagAssignment[]> {
  const cursor = await db.query(aql`FOR assignment IN ${db.collection(TAG_ASSIGNMENTS_COLLECTION)} FILTER assignment.scopeKey == ${scopeKey} FILTER ${sourceType ?? null} == null || assignment.sourceType == ${sourceType ?? null} FILTER ${sourceKey ?? null} == null || assignment.sourceKey == ${sourceKey ?? null} SORT assignment.createdAt ASC, assignment._key ASC RETURN assignment`);
  return (await cursor.all()).map((assignment) => tagAssignmentSchema.parse(withArangoKey(assignment)));
}
