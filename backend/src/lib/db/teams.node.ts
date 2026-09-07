import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers } from './base';
import { withArangoKey } from './base';
import { newId } from '@/lib/ids';

export const TEAMS_COLLECTION = 'teams';

export const teamSchema = z.object({
  key: z.string(),
  name: z.string(),
  /** Exactly one team is the root Founders team. */
  is_root: z.boolean().default(false),
  slug: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  isActive: z.boolean().default(true),
  /**
   * THE source of truth for team-wide MFA enforcement: when true, every
   * selected membership must be assured through TOTP (root members may use
   * the founders gate specialization). Email or OAuth first establishes a
   * base identity session; it never substitutes for team MFA. Never derive MFA
   * requirements from is_root — the root team simply carries
   * mfa_enabled: true (set by arango-migrate).
   */
  mfa_enabled: z.boolean().default(false),
  metadata: z.record(z.unknown()).default({}),
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
export const upsertTeam = helpers.upsertByKey;
export const getAllTeamsChunked = helpers.getAllChunked;
export const listTeamsPage = helpers.listPage;

export async function getRootTeam(): Promise<Team | null> {
  const cursor = await db.query(aql`
    FOR team IN ${db.collection(TEAMS_COLLECTION)}
      FILTER team.is_root == true
      LIMIT 1
      RETURN team
  `);
  const doc = await cursor.next();
  return doc ? teamSchema.parse(withArangoKey(doc)) : null;
}

type RootTeamDependencies = {
  getRootTeam: typeof getRootTeam;
  insertTeam: typeof insertTeam;
  createId: typeof newId;
  now: () => string;
};

export async function getRootTeamKey(dependencies: Partial<RootTeamDependencies> = {}) {
  const getRoot = dependencies.getRootTeam ?? getRootTeam;
  const insertRoot = dependencies.insertTeam ?? insertTeam;
  const createId = dependencies.createId ?? newId;
  const currentTime = dependencies.now ?? (() => new Date().toISOString());
  const existing = await getRoot();
  if (existing) return existing.key;

  const now = currentTime();
  const created = await insertRoot({
    key: createId(),
    name: 'Founders',
    is_root: true,
    slug: 'founders',
    mfa_enabled: true,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  });
  return created.key;
}

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
