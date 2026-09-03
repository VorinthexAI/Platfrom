import { z } from 'zod';
import { withTransaction } from '@/lib/db/client';

const replacementSchema = z.object({
  key: z.string().min(1),
  name: z.string().nullable(),
  profileStorageKey: z.string().min(1),
  updatedAt: z.string().datetime(),
  previousStorageKey: z.string().min(1).nullable(),
}).strict();

export type ProfileReplacement = z.infer<typeof replacementSchema>;

export async function replaceUserProfileStorageKey(userKey: string, profileStorageKey: string, updatedAt: string): Promise<ProfileReplacement | null> {
  const result = await withTransaction(['users', 'storageDeletionJobs'], async (transaction) => {
    const cursor = await transaction.query(`
      FOR user IN users
        FILTER user._key == @userKey
        LIMIT 1
        LET previousStorageKey = IS_STRING(user.profileStorageKey) ? user.profileStorageKey : null
        UPDATE user WITH { profileStorageKey: @profileStorageKey, updatedAt: @updatedAt } IN users
        RETURN {
          key: NEW._key,
          name: NEW.name,
          profileStorageKey: NEW.profileStorageKey,
          updatedAt: NEW.updatedAt,
          previousStorageKey
        }
    `, { userKey, profileStorageKey, updatedAt });
    const replacement = await cursor.next();
    if (!replacement) return null;
    const parsed = replacementSchema.parse(replacement);
    if (parsed.previousStorageKey && parsed.previousStorageKey !== parsed.profileStorageKey) {
      await transaction.query(
        'UPSERT { storageKey: @storageKey } INSERT { storageKey: @storageKey, createdAt: @updatedAt } UPDATE {} IN storageDeletionJobs',
        { storageKey: parsed.previousStorageKey, updatedAt },
      );
    }
    return parsed;
  });
  return result;
}
