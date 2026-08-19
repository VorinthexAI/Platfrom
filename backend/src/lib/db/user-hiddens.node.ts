import { z } from 'zod';

export const USER_HIDDENS_COLLECTION = 'userHiddens';
export const userHiddenSourceSchema = z.enum(['collection', 'document', 'image', 'folder']);
export const userHiddenSchema = z.object({
  key: z.string().cuid(),
  userKey: z.string().cuid(),
  source: userHiddenSourceSchema,
  sourceKey: z.string().cuid(),
  createdAt: z.string().datetime(),
}).strict();

export type UserHidden = z.infer<typeof userHiddenSchema>;
export type UserHiddenSource = z.infer<typeof userHiddenSourceSchema>;
