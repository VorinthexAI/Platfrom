import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const TEAMS_COLLECTION = 'teams';

export const teamSchema = z.object({
  key: z.string(),
  ownerId: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable().default(null),
  isActive: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type Team = z.infer<typeof teamSchema>;

export const teamsEmbedKeys = z.enum(['name', 'slug', 'description']);

const helpers = createNodeHelpers(TEAMS_COLLECTION, teamSchema, teamsEmbedKeys.options);

export const insertTeam = helpers.insert;
export const getTeamById = helpers.getById;
export const updateTeam = helpers.updateById;
export const deleteTeam = helpers.deleteById;
export const upsertTeamByKey = helpers.upsertByKey;
export const getAllTeamsChunked = helpers.getAllChunked;
export const listTeamsPage = helpers.listPage;

export async function getTeamBySlug(slug: string): Promise<Team | null> {
  const cursor = await db.query(aql`
    FOR team IN ${db.collection(TEAMS_COLLECTION)}
      FILTER team.slug == ${slug}
      LIMIT 1
      RETURN team
  `);
  const doc = await cursor.next();
  return doc ? teamSchema.parse(withArangoKey(doc)) : null;
}
