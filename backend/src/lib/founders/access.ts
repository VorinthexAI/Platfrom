import type { User } from '@/lib/db/users.node';

export type FoundersAccessDenialCode = 'NOT_FOUNDER' | 'FORBIDDEN';
export async function getFoundersAccess(_user: User) {
  return { allowed: false as const, code: 'NOT_FOUNDER' as const };
}
export class FoundersAccessError extends Error {
  code = 'FORBIDDEN';
  constructor(message = 'Founders HQ is retired.') { super(message); }
}
export async function assertFoundersAccess(_userKey: string) { throw new FoundersAccessError(); }
export async function listAccessibleTeams(_userKey?: string) { return []; }
export async function listAccessibleScopes(_membership?: unknown) { return []; }
export async function requireFoundersGateAccess(_userKey?: string): Promise<FoundersGateAccess> { throw new FoundersAccessError(); }
export async function requireTeamAccess(_userKey?: string, _teamKey?: string): Promise<{ membership: { key: string } }> { throw new FoundersAccessError(); }
export async function requireScopeAccess(..._args: unknown[]) { throw new FoundersAccessError(); }
export type FoundersGateAccess = { allowed: false };
