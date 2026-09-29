import { aql } from 'arangojs';
import { newId } from '@/lib/ids';
import { withTransaction } from './client';
import { scopeSchema, type Scope } from '@/lib/ai/scopes/schema';

export interface PersonalAuthContext {
  scope: Scope;
}

export async function provisionPersonalAuthContext(
  user: { key: string; name: string | null; email: string; currentScopeKey?: string },
  options: { mainScopeKey?: string } = {},
): Promise<PersonalAuthContext> {
  const existing = await getPersonalAuthContext(user.key);
  if (existing) {
    if (!user.currentScopeKey) {
      const { db } = await import('./client');
      await db.query(aql`UPDATE ${user.key} WITH { currentScopeKey: ${existing.scope.key} } IN users`);
    }
    return existing;
  }
  const now = new Date().toISOString();
  const scopeKey = options.mainScopeKey ?? newId();
  const result = await withTransaction(
    ['users', 'scopes'],
    async (transaction) => {
      const cursor = await transaction.query(aql`
        UPSERT { userKey: ${user.key}, slug: "main" }
          INSERT {
            _key: ${scopeKey}, userKey: ${user.key}, slug: "main", name: "Main",
            summary: "Main workspace", description: "Main workspace", position: 1, embedding: []
          }
          UPDATE {} IN scopes
        LET scope = NEW
        UPDATE ${user.key} WITH { currentScopeKey: scope._key, updatedAt: ${now} } IN users
        RETURN { scope }
      `);
      return cursor.next();
    },
  );
  if (!result) throw new Error('personal auth context provisioning failed');
  return { scope: scopeSchema.parse({ ...result.scope, key: result.scope._key }) };
}

export async function getPersonalAuthContext(userId: string): Promise<PersonalAuthContext | null> {
  const { db } = await import('./client');
  const cursor = await db.query(aql`
    LET user = DOCUMENT(users, ${userId})
    FILTER user != null
    LET selected = IS_STRING(user.currentScopeKey) ? DOCUMENT(scopes, user.currentScopeKey) : null
    LET ownedSelected = selected != null && selected.userKey == ${userId} ? selected : null
    LET main = FIRST(FOR item IN scopes FILTER item.userKey == ${userId} && item.slug == "main" RETURN item)
    LET scope = ownedSelected != null ? ownedSelected : main
    FILTER scope != null
    LET repair = user.currentScopeKey != scope._key
    UPDATE user WITH (repair ? { currentScopeKey: scope._key, updatedAt: ${new Date().toISOString()} } : {}) IN users
    RETURN { scope }
  `);
  const result = await cursor.next();
  if (!result) return null;
  return { scope: scopeSchema.parse({ ...result.scope, key: result.scope._key }) };
}

export async function selectPersonalAuthContext(userId: string): Promise<PersonalAuthContext | null> {
  const { db } = await import('./client');
  const cursor = await db.query(aql`
    LET scope = FIRST(FOR item IN scopes FILTER item.userKey == ${userId} && item.slug == "main" LIMIT 1 RETURN item)
    FILTER scope != null
    UPDATE ${userId} WITH { currentScopeKey: scope._key, updatedAt: ${new Date().toISOString()} } IN users
    RETURN { scope }
  `);
  const result = await cursor.next();
  if (!result) return null;
  return { scope: scopeSchema.parse({ ...result.scope, key: result.scope._key }) };
}
