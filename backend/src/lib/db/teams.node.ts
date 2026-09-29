import { z } from 'zod';

export const TEAMS_COLLECTION = 'teams';
export const teamSchema = z.object({
  key: z.string(),
  name: z.string(),
  slug: z.string().nullable().optional(),
  personalOwnerUserId: z.string().nullable().optional(),
  is_root: z.boolean().default(false),
  isActive: z.boolean().default(true),
  mfa_enabled: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});
export type Team = z.infer<typeof teamSchema>;
export async function getTeamById(_id: string): Promise<Team | null> { return null; }
export async function getRootTeam(): Promise<Team | null> { return null; }
export async function getRootTeamKey() { return null; }
export async function upsertTeam(_input: never): Promise<Team> { throw new Error('teams are retired'); }
export async function listTeamsPage() { return { items: [], next: null }; }
export async function getAllTeamsChunked() { async function* empty() { yield []; } return empty(); }
