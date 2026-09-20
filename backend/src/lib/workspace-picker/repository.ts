import { db, withTransaction } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { USER_WORKSPACE_APPS_COLLECTION, userWorkspaceAppSchema, type UserWorkspaceApp } from '@/lib/db/user-workspace-apps.node';
import { scopeVisibilitySchema, type ScopeVisibility } from '@/lib/ai/scopes/schema';
import { WORKSPACE_PICKER_SLUGS } from './slugs';

export type WorkspacePickerScope = {
  key: string;
  slug: (typeof WORKSPACE_PICKER_SLUGS)[number];
  name: string;
  visibility: ScopeVisibility;
};

export interface WorkspacePickerRepository {
  listRootPickerScopes(): Promise<WorkspacePickerScope[]>;
  listUserScopeKeys(userKey: string): Promise<string[]>;
  replaceUserScopeKeys(userKey: string, scopeKeys: readonly string[]): Promise<string[]>;
}

export interface WorkspacePickerDatabase {
  query(query: string, bindVars?: Record<string, unknown>): Promise<{ all(): Promise<unknown[]> }>;
}

type TransactionRunner = <T>(collections: string[], operation: (transaction: WorkspacePickerDatabase) => Promise<T>) => Promise<T>;

function parseLink(value: unknown): UserWorkspaceApp {
  return userWorkspaceAppSchema.parse(withArangoKey(value as Record<string, unknown>));
}

export function createWorkspacePickerRepository(
  database: WorkspacePickerDatabase = db,
  runTransaction: TransactionRunner = (collections, operation) => withTransaction(collections, operation as never),
  now = () => new Date().toISOString(),
): WorkspacePickerRepository {
  return {
    async listRootPickerScopes() {
      const rows = await (await database.query(`
        LET roots = (FOR team IN teams FILTER team.is_root == true && team.isActive == true RETURN team._key)
        FILTER LENGTH(roots) == 1
        FOR scope IN scopes
          FILTER scope.teamKey == roots[0] && scope.slug IN @slugs
          RETURN { key: scope._key, slug: scope.slug, name: scope.name, visibility: HAS(scope, "visibility") ? scope.visibility : "public" }
      `, { slugs: WORKSPACE_PICKER_SLUGS })).all() as Array<{ key: string; slug: string; name: string; visibility: string }>;
      const bySlug = new Map(rows.map((row) => [row.slug, row]));
      return WORKSPACE_PICKER_SLUGS.flatMap((slug) => {
        const row = bySlug.get(slug);
        const visibility = scopeVisibilitySchema.safeParse(row?.visibility);
        if (!row || !visibility.success) return [];
        return [{ key: row.key, slug, name: row.name, visibility: visibility.data }];
      });
    },
    async listUserScopeKeys(userKey) {
      const rows = await (await database.query(`
        FOR item IN ${USER_WORKSPACE_APPS_COLLECTION}
          FILTER item.userKey == @userKey
          SORT item.position ASC, item._key ASC
          RETURN item
      `, { userKey })).all();
      return rows.map((row) => parseLink(row).scopeKey);
    },
    async replaceUserScopeKeys(userKey, scopeKeys) {
      const createdAt = now();
      return runTransaction([USER_WORKSPACE_APPS_COLLECTION], async (transaction) => {
        await transaction.query(`FOR item IN ${USER_WORKSPACE_APPS_COLLECTION} FILTER item.userKey == @userKey REMOVE item IN ${USER_WORKSPACE_APPS_COLLECTION}`, { userKey });
        const saved: string[] = [];
        for (const [index, scopeKey] of scopeKeys.entries()) {
          const record = userWorkspaceAppSchema.parse({
            key: newId(),
            userKey,
            scopeKey,
            position: index + 1,
            createdAt,
          });
          const rows = await (await transaction.query(`INSERT @record IN ${USER_WORKSPACE_APPS_COLLECTION} RETURN NEW`, { record: toArangoDoc(record) })).all();
          saved.push(parseLink(rows[0]).scopeKey);
        }
        return saved;
      });
    },
  };
}
