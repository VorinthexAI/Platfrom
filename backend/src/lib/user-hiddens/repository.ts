import { db } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { userHiddenSchema, type UserHidden, type UserHiddenSource } from '@/lib/db/user-hiddens.node';

export interface UserHiddenActor {
  userKey: string;
  organizationKey: string;
  membershipKey: string;
}

export interface UserHiddenRepository {
  list(userKey: string): Promise<UserHidden[]>;
  hide(record: UserHidden): Promise<UserHidden>;
  reveal(userKey: string, source: UserHiddenSource, sourceKey: string): Promise<UserHidden | null>;
  canAccess(actor: UserHiddenActor, source: UserHiddenSource, sourceKey: string): Promise<boolean>;
}

export interface UserHiddenDatabase {
  query(query: string, bindVars?: Record<string, unknown>): Promise<{ all(): Promise<unknown[]> }>;
}

function parse(value: unknown) {
  return userHiddenSchema.parse(withArangoKey(value as Record<string, unknown>));
}

export function createUserHiddenRepository(database: UserHiddenDatabase = db): UserHiddenRepository {
  return {
    async list(userKey) {
      const rows = await (await database.query('FOR hidden IN userHiddens FILTER hidden.userKey == @userKey SORT hidden.createdAt ASC, hidden._key ASC RETURN hidden', { userKey })).all();
      return rows.map(parse);
    },
    async hide(record) {
      const rows = await (await database.query('UPSERT { userKey: @userKey, source: @source, sourceKey: @sourceKey } INSERT @record UPDATE {} IN userHiddens RETURN NEW', {
        userKey: record.userKey, source: record.source, sourceKey: record.sourceKey, record: toArangoDoc(userHiddenSchema.parse(record)),
      })).all();
      return parse(rows[0]);
    },
    async reveal(userKey, source, sourceKey) {
      const rows = await (await database.query('FOR hidden IN userHiddens FILTER hidden.userKey == @userKey && hidden.source == @source && hidden.sourceKey == @sourceKey REMOVE hidden IN userHiddens RETURN OLD', { userKey, source, sourceKey })).all();
      return rows[0] ? parse(rows[0]) : null;
    },
    async canAccess(actor, source, sourceKey) {
      const targetCollection = source === 'folder' ? 'folders' : source === 'document' ? 'documents' : source === 'collection' ? 'collections' : 'images';
      const mediaFilter = source === 'collection'
        ? 'FILTER privileged || LENGTH(FOR member IN collectionMembers FILTER member.scopeKey == target.scopeKey && member.collectionKey == target._key && member.memberKey == @membershipKey LIMIT 1 RETURN 1) > 0'
        : source === 'image'
          ? 'LET relationCount = LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == target.scopeKey && relation.imageKey == target._key RETURN 1) FILTER privileged || (target.createdByKey == @membershipKey && relationCount == 0) || LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == target.scopeKey && relation.imageKey == target._key LET collection = DOCUMENT(collections, relation.collectionKey) FILTER collection != null && collection.deletedAt == null FOR member IN collectionMembers FILTER member.scopeKey == target.scopeKey && member.collectionKey == relation.collectionKey && member.memberKey == @membershipKey LIMIT 1 RETURN 1) > 0'
          : 'FILTER privileged || scoped';
      const rows = await (await database.query(`
        LET membership = DOCUMENT(userOrganizations, @membershipKey)
        LET target = DOCUMENT(${targetCollection}, @sourceKey)
        FILTER membership != null && membership.userId == @userKey && membership.organizationId == @organizationKey && membership.status == "active"
        FILTER target != null && target.deletedAt == null && (!HAS(target, "_internalDeletion") || target._internalDeletion == null)
        LET scope = DOCUMENT(scopes, target.scopeKey)
        FILTER scope != null && scope.organizationKey == @organizationKey && scope.deletedAt == null
        LET privileged = membership.orgRole IN ["owner", "admin"]
        LET scoped = LENGTH(FOR member IN scopeMembers FILTER member.scopeKey == target.scopeKey && member.userOrganizationKey == @membershipKey && member.status == "active" LIMIT 1 RETURN 1) > 0
        ${mediaFilter}
        RETURN true
      `, { ...actor, sourceKey })).all();
      return rows[0] === true;
    },
  };
}
