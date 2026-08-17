import { newId } from '@/lib/ids';
import { getDefaultUserSearchRepository, type UserSearchRepository } from './repository';

export function normalizeUserSearchQuery(query: string) {
  return query.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export interface UserSearchService {
  record(userKey: string, query: string): Promise<{ query: string; normalizedQuery: string; searchedAt: string; usageCount: number }>;
  list(userKey: string, limit?: number): Promise<Array<{ query: string; normalizedQuery: string; searchedAt: string; usageCount: number }>>;
  remove(userKey: string, query: string): Promise<{ normalizedQuery: string; deleted: boolean }>;
}

export function createUserSearchService(options: { repository?: UserSearchRepository; id?: () => string; now?: () => string } = {}): UserSearchService {
  const repository = options.repository ?? getDefaultUserSearchRepository();
  const id = options.id ?? newId;
  const now = options.now ?? (() => new Date().toISOString());
  return {
    async record(userKey, query) {
      const normalizedQuery = normalizeUserSearchQuery(query);
      const { key: _key, userKey: _userKey, ...search } = await repository.record({ key: id(), userKey, query: query.trim(), normalizedQuery, usageCount: 1, searchedAt: now() });
      return search;
    },
    async list(userKey, limit = 20) {
      return (await repository.list(userKey, limit)).map(({ key: _key, userKey: _userKey, ...search }) => search);
    },
    async remove(userKey, query) {
      const normalizedQuery = normalizeUserSearchQuery(query);
      return { normalizedQuery, deleted: await repository.remove(userKey, normalizedQuery) };
    },
  };
}

let defaultService: UserSearchService | undefined;
export function getDefaultUserSearchService() {
  return defaultService ??= createUserSearchService();
}
