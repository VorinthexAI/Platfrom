import { z } from 'zod';
import { db } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';

export const USER_SEARCHES_COLLECTION = 'userSearches';

export const userSearchSchema = z.object({
  key: z.string().cuid(),
  userKey: z.string().cuid(),
  query: z.string().trim().min(1).max(12_000),
  normalizedQuery: z.string().trim().min(1).max(12_000),
  usageCount: z.number().int().positive(),
  searchedAt: z.string().datetime(),
}).strict();

export type UserSearch = z.infer<typeof userSearchSchema>;
const userKeySchema = z.string().cuid();
const normalizedQuerySchema = z.string().trim().min(1).max(12_000);

export interface UserSearchRepository {
  record(input: UserSearch): Promise<UserSearch>;
  list(userKey: string, limit: number): Promise<UserSearch[]>;
  remove(userKey: string, normalizedQuery: string): Promise<boolean>;
}

type SearchDatabase = Pick<typeof db, 'query'>;

export function createUserSearchRepository(database: SearchDatabase = db): UserSearchRepository {
  return {
    async record(input) {
      const value = userSearchSchema.parse(input);
      const cursor = await database.query(`
        UPSERT { userKey: @userKey, normalizedQuery: @normalizedQuery }
          INSERT @value
          UPDATE { query: @query, searchedAt: @searchedAt, usageCount: OLD.usageCount + 1 }
          IN @@collection
          RETURN NEW
      `, { '@collection': USER_SEARCHES_COLLECTION, userKey: value.userKey, normalizedQuery: value.normalizedQuery, query: value.query, searchedAt: value.searchedAt, value: toArangoDoc(value) });
      const recorded = userSearchSchema.parse(withArangoKey(await cursor.next() as Record<string, unknown>));
      await database.query(`
        LET retained = (FOR search IN @@collection FILTER search.userKey == @userKey SORT search.searchedAt DESC LIMIT 100 RETURN search._key)
        FOR search IN @@collection
          FILTER search.userKey == @userKey && search._key NOT IN retained
          REMOVE search IN @@collection
      `, { '@collection': USER_SEARCHES_COLLECTION, userKey: value.userKey });
      return recorded;
    },
    async list(userKey, limit) {
      userKey = userKeySchema.parse(userKey);
      limit = z.number().int().min(1).max(100).parse(limit);
      const cursor = await database.query(`
        FOR search IN @@collection
          FILTER search.userKey == @userKey
          SORT search.searchedAt DESC
          LIMIT @limit
          RETURN search
      `, { '@collection': USER_SEARCHES_COLLECTION, userKey, limit });
      return z.array(userSearchSchema).parse((await cursor.all()).map((row) => withArangoKey(row as Record<string, unknown>)));
    },
    async remove(userKey, normalizedQuery) {
      userKey = userKeySchema.parse(userKey);
      normalizedQuery = normalizedQuerySchema.parse(normalizedQuery);
      const cursor = await database.query(`
        FOR search IN @@collection
          FILTER search.userKey == @userKey && search.normalizedQuery == @normalizedQuery
          REMOVE search IN @@collection
          RETURN true
      `, { '@collection': USER_SEARCHES_COLLECTION, userKey, normalizedQuery });
      return Boolean(await cursor.next());
    },
  };
}

let defaultRepository: UserSearchRepository | undefined;
export function getDefaultUserSearchRepository() {
  return defaultRepository ??= createUserSearchRepository();
}
