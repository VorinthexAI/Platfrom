import { z } from 'zod';
import { db, withTransaction } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';

export const USER_GENERATIONS_COLLECTION = 'userGenerations';
export const userGenerationTypeSchema = z.enum(['image']);
export const userGenerationSchema = z.object({
  key: z.string().cuid(),
  userKey: z.string().cuid(),
  type: userGenerationTypeSchema,
  prompt: z.string().trim().min(1).max(8_000),
  normalizedPrompt: z.string().trim().min(1).max(8_000),
  usageCount: z.number().int().positive(),
  generatedAt: z.string().datetime(),
}).strict();
export type UserGeneration = z.infer<typeof userGenerationSchema>;

export interface UserGenerationRepository {
  record(input: UserGeneration): Promise<UserGeneration>;
  list(userKey: string, type: z.infer<typeof userGenerationTypeSchema>, limit: number): Promise<UserGeneration[]>;
  remove(userKey: string, type: z.infer<typeof userGenerationTypeSchema>, normalizedPrompt: string): Promise<boolean>;
}

type Database = Pick<typeof db, 'query'>;
type Transaction = <T>(operation: (database: Database) => Promise<T>) => Promise<T>;

export function createUserGenerationRepository(database: Database = db, runTransaction: Transaction = database === db ? (operation) => withTransaction([USER_GENERATIONS_COLLECTION], operation) : (operation) => operation(database)): UserGenerationRepository {
  return {
    async record(input) {
      const value = userGenerationSchema.parse(input);
      return runTransaction(async (executor) => {
        const cursor = await executor.query(`
          UPSERT { userKey: @userKey, type: @type, normalizedPrompt: @normalizedPrompt }
            INSERT @value
            UPDATE { prompt: @prompt, generatedAt: @generatedAt, usageCount: OLD.usageCount + 1 }
            IN @@collection
            RETURN NEW
        `, { '@collection': USER_GENERATIONS_COLLECTION, userKey: value.userKey, type: value.type, normalizedPrompt: value.normalizedPrompt, prompt: value.prompt, generatedAt: value.generatedAt, value: toArangoDoc(value) });
        const recorded = userGenerationSchema.parse(withArangoKey(await cursor.next() as Record<string, unknown>));
        await executor.query(`
          LET retained = (FOR generation IN @@collection FILTER generation.userKey == @userKey && generation.type == @type SORT generation.generatedAt DESC, generation._key DESC LIMIT 50 RETURN generation._key)
          FOR generation IN @@collection
            FILTER generation.userKey == @userKey && generation.type == @type && generation._key NOT IN retained
            REMOVE generation IN @@collection
        `, { '@collection': USER_GENERATIONS_COLLECTION, userKey: value.userKey, type: value.type });
        return recorded;
      });
    },
    async list(userKey, type, limit) {
      userKey = z.string().cuid().parse(userKey);
      type = userGenerationTypeSchema.parse(type);
      limit = z.number().int().min(1).max(50).parse(limit);
      const cursor = await database.query('FOR generation IN @@collection FILTER generation.userKey == @userKey && generation.type == @type SORT generation.generatedAt DESC, generation._key DESC LIMIT @limit RETURN generation', { '@collection': USER_GENERATIONS_COLLECTION, userKey, type, limit });
      return z.array(userGenerationSchema).parse((await cursor.all()).map((row) => withArangoKey(row as Record<string, unknown>)));
    },
    async remove(userKey, type, normalizedPrompt) {
      userKey = z.string().cuid().parse(userKey);
      type = userGenerationTypeSchema.parse(type);
      normalizedPrompt = z.string().trim().min(1).max(8_000).parse(normalizedPrompt);
      const cursor = await database.query('FOR generation IN @@collection FILTER generation.userKey == @userKey && generation.type == @type && generation.normalizedPrompt == @normalizedPrompt REMOVE generation IN @@collection RETURN true', { '@collection': USER_GENERATIONS_COLLECTION, userKey, type, normalizedPrompt });
      return Boolean(await cursor.next());
    },
  };
}

let defaultRepository: UserGenerationRepository | undefined;
export function getDefaultUserGenerationRepository() { return defaultRepository ??= createUserGenerationRepository(); }
