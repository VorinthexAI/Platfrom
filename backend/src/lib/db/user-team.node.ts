import { z } from 'zod';

export const USER_TEAMS_COLLECTION = 'userTeams';
export const USER_TEAM_COLLECTION = USER_TEAMS_COLLECTION;
export const userTeamSchema = z.object({
  key: z.string(),
  teamKey: z.string(),
  userId: z.string(),
  teamRole: z.enum(['owner', 'admin', 'member', 'moderator']).default('owner'),
  teamTitle: z.string().nullable().optional(),
  orchestratorKey: z.string().nullable().optional(),
  status: z.enum(['active', 'suspended']).default('active'),
  isMfaEnabled: z.boolean().default(false),
  totpSecret: z.string().nullable().default(null),
  lastTotpTimeStep: z.number().nullable().optional(),
  teamMfaRecoveryPending: z.boolean().optional(),
  teamMfaVersion: z.number().int().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type UserTeam = z.infer<typeof userTeamSchema>;
export async function getUserTeamById(id: string): Promise<UserTeam | null> {
  return getUserTeamByTeamAndUser(id, id);
}
export async function hasActiveRootTeamMembership(_userId: string) { return false; }
export async function listActiveUserTeamsByUser(_userId: string): Promise<UserTeam[]> { return []; }
export async function getUserTeamByTeamAndUser(teamKey: string, userId: string): Promise<UserTeam | null> {
  if (!teamKey || !userId) return null;
  const now = new Date().toISOString();
  return userTeamSchema.parse({ key: userId, teamKey: userId, userId, teamRole: 'owner', status: 'active', createdAt: now, updatedAt: now });
}
export async function upsertUserTeamByKey(_input: never): Promise<UserTeam> { throw new Error('userTeams are retired'); }
export async function listUserTeamsPage() { return { items: [], next: null }; }
export async function getAllUserTeamsChunked() { async function* empty() { yield []; } return empty(); }
