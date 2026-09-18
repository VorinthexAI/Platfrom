import { z } from 'zod';
import { hasActiveRootTeamMembership } from '@/lib/db/user-team.node';
import { createWorkspacePickerRepository, type WorkspacePickerRepository, type WorkspacePickerScope } from './repository';

export const workspacePickerUpdateInputSchema = z.object({
  scopeKeys: z.array(z.string().cuid()).min(1).max(6),
}).strict();

export class WorkspacePickerError extends Error {
  constructor(readonly code: 'INVALID' | 'NOT_FOUND', message: string) {
    super(message);
    this.name = 'WorkspacePickerError';
  }
}

export type WorkspacePickerApp = {
  scopeKey: string;
  slug: string;
  name: string;
};

export type WorkspacePickerState = {
  apps: WorkspacePickerApp[];
  selectedScopeKeys: string[] | null;
};

export interface WorkspacePickerService {
  read(userKey: string): Promise<WorkspacePickerState>;
  update(userKey: string, scopeKeys: readonly string[]): Promise<WorkspacePickerState>;
}

function project(scope: WorkspacePickerScope): WorkspacePickerApp {
  return { scopeKey: scope.key, slug: scope.slug, name: scope.name };
}

function entitledScopes(scopes: readonly WorkspacePickerScope[], rootTeamMember: boolean) {
  return scopes.filter((scope) => scope.visibility === 'public' || (scope.slug === 'hq' && rootTeamMember));
}

function selectedFromStored(entitled: readonly WorkspacePickerApp[], storedKeys: readonly string[]) {
  const allowed = new Set(entitled.map(({ scopeKey }) => scopeKey));
  const unique = [...new Set(storedKeys.filter((key) => allowed.has(key)))];
  const order = new Map(entitled.map((app, index) => [app.scopeKey, index]));
  return unique.sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
}

export function createWorkspacePickerService(
  repository: WorkspacePickerRepository = createWorkspacePickerRepository(),
  hasRootMembership: (userKey: string) => Promise<boolean> = hasActiveRootTeamMembership,
): WorkspacePickerService {
  const snapshot = async (userKey: string): Promise<WorkspacePickerState> => {
    const rootTeamMember = await hasRootMembership(userKey);
    const entitled = entitledScopes(await repository.listRootPickerScopes(), rootTeamMember).map(project);
    const stored = await repository.listUserScopeKeys(userKey);
    if (stored.length === 0) return { apps: entitled, selectedScopeKeys: null };
    const selectedScopeKeys = selectedFromStored(entitled, stored);
    return { apps: entitled, selectedScopeKeys: selectedScopeKeys.length ? selectedScopeKeys : null };
  };
  return {
    read: snapshot,
    async update(userKey, rawScopeKeys) {
      const input = workspacePickerUpdateInputSchema.parse({ scopeKeys: rawScopeKeys });
      const rootTeamMember = await hasRootMembership(userKey);
      const entitled = entitledScopes(await repository.listRootPickerScopes(), rootTeamMember).map(project);
      if (entitled.length === 0) throw new WorkspacePickerError('NOT_FOUND', 'Workspace apps are unavailable.');
      const selectedScopeKeys = selectedFromStored(entitled, input.scopeKeys);
      if (selectedScopeKeys.length !== [...new Set(input.scopeKeys)].length) {
        throw new WorkspacePickerError('INVALID', 'Workspace apps must be entitled picker scopes.');
      }
      await repository.replaceUserScopeKeys(userKey, selectedScopeKeys);
      return { apps: entitled, selectedScopeKeys };
    },
  };
}

export const workspacePickerService = createWorkspacePickerService();
