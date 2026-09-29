import { z } from 'zod';
export const workspacePickerUpdateInputSchema = z.object({ scopeKeys: z.array(z.string().cuid()).max(5) }).strict();
export type WorkspacePickerState = { apps: unknown[]; selectedScopeKeys: string[] | null };
export type WorkspacePickerService = {
  update: (userKey: string, scopeKeys: string[]) => Promise<{ ok: true }>;
  read: (userKey: string) => Promise<WorkspacePickerState>;
};
export const workspacePickerService: WorkspacePickerService = {
  async update() { return { ok: true }; },
  async read() { return { apps: [], selectedScopeKeys: null }; },
};
