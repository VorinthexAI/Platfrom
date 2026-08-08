import { z } from 'zod';
import { createNodeHelpers } from './base';

export const EMAIL_ACCOUNTS_COLLECTION = 'emailAccounts';
export const emailAccountSchema = z.object({
  key: z.string().cuid(), scopeKey: z.string().cuid(), provider: z.literal('gmail'), providerAccountId: z.string().trim().min(1), email: z.string().email(),
  syncEnabled: z.boolean(), historyId: z.string().trim().min(1).optional(), lastSyncedAt: z.string().datetime().optional(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type EmailAccount = z.infer<typeof emailAccountSchema>;
export const emailAccountsEmbeddingFields = [] as const;
const helpers = createNodeHelpers(EMAIL_ACCOUNTS_COLLECTION, emailAccountSchema, emailAccountsEmbeddingFields, { requireEmbedding: false });
export const insertEmailAccount = helpers.insert;
export const getEmailAccountById = helpers.getById;
export const updateEmailAccount = helpers.updateById;
export const deleteEmailAccount = helpers.deleteById;
export const upsertEmailAccountByKey = helpers.upsertByKey;
export const getAllEmailAccountsChunked = helpers.getAllChunked;
export const listEmailAccountsPage = helpers.listPage;
