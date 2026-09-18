import { z } from 'zod';

export const USER_WORKSPACE_APPS_COLLECTION = 'userWorkspaceApps';

export const userWorkspaceAppSchema = z.object({
  key: z.string().cuid(),
  userKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  position: z.number().int().positive(),
  createdAt: z.string().datetime(),
}).strict();

export type UserWorkspaceApp = z.infer<typeof userWorkspaceAppSchema>;
