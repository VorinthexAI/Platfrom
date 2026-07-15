import { db } from '@/lib/db/client';
import { isArangoNotFoundError, isArangoUniqueConstraintError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { userOrganizationSchema } from '@/lib/db/user-organization.node';
import { userSchema } from '@/lib/db/users.node';
import { newId } from '@/lib/ids';
import { AiError } from '@/lib/ai/shared/result';
import {
  SCOPE_MEMBERS_COLLECTION,
  SCOPES_COLLECTION,
  scopeMemberRoleSchema,
  scopeMemberSchema,
  scopeSchema,
  type ScopeMember,
  type ScopeMemberRole,
} from './schema';
import { ScopeNotFoundError, type ScopesDatabase } from './types';

export type ScopeMemberView = {
  role: ScopeMemberRole;
  user: {
    key: string;
    name: string;
    avatar?: string;
    email?: string;
  };
};

export interface ScopeMemberRepository {
  addMember(scopeKey: string, userOrganizationKey: string, role: ScopeMemberRole): Promise<ScopeMember>;
  removeMember(scopeKey: string, userOrganizationKey: string): Promise<void>;
  listMembers(scopeKey: string): Promise<readonly ScopeMember[]>;
  listMemberViews(scopeKey: string): Promise<readonly ScopeMemberView[]>;
}

export class ScopeMembershipNotFoundError extends AiError {
  constructor(userOrganizationKey: string) {
    super('scope_membership_not_found', `User organization membership not found: ${userOrganizationKey}`);
  }
}

export class ScopeMemberOrganizationMismatchError extends AiError {
  constructor(scopeKey: string, userOrganizationKey: string) {
    super(
      'scope_member_organization_mismatch',
      `Membership ${userOrganizationKey} does not belong to the organization owning scope ${scopeKey}`,
    );
  }
}

export class DuplicateScopeMemberError extends AiError {
  constructor(scopeKey: string, userOrganizationKey: string) {
    super('duplicate_scope_member', `Membership ${userOrganizationKey} is already in scope ${scopeKey}`);
  }
}

export class ScopeMemberNotFoundError extends AiError {
  constructor(scopeKey: string, userOrganizationKey: string) {
    super('scope_member_not_found', `Membership ${userOrganizationKey} is not in scope ${scopeKey}`);
  }
}

export function createScopeMemberRepository(database: ScopesDatabase = db): ScopeMemberRepository {
  return {
    async addMember(scopeKey, userOrganizationKey, role) {
      const member = scopeMemberSchema.parse({
        key: newId(),
        scopeKey,
        userOrganizationKey,
        role: scopeMemberRoleSchema.parse(role),
      });

      let scope;
      try {
        const scopeDoc = await database.collection(SCOPES_COLLECTION).document(scopeKey);
        scope = scopeSchema.parse(withArangoKey(scopeDoc as Record<string, unknown>));
      } catch (error) {
        if (isArangoNotFoundError(error)) throw new ScopeNotFoundError(scopeKey);
        throw error;
      }

      let membership;
      try {
        const membershipDoc = await database.collection('userOrganizations').document(userOrganizationKey);
        membership = userOrganizationSchema.parse(withArangoKey(membershipDoc as Record<string, unknown>));
      } catch (error) {
        if (isArangoNotFoundError(error)) throw new ScopeMembershipNotFoundError(userOrganizationKey);
        throw error;
      }

      if (scope.organizationKey !== membership.organizationId) {
        throw new ScopeMemberOrganizationMismatchError(scopeKey, userOrganizationKey);
      }

      try {
        const result = await database.collection(SCOPE_MEMBERS_COLLECTION).save(toArangoDoc(member), { returnNew: true });
        const saved = (result as { new?: Record<string, unknown> }).new;
        return saved ? scopeMemberSchema.parse(withArangoKey(saved)) : member;
      } catch (error) {
        if (isArangoUniqueConstraintError(error)) throw new DuplicateScopeMemberError(scopeKey, userOrganizationKey);
        throw error;
      }
    },

    async removeMember(scopeKey, userOrganizationKey) {
      const cursor = await database.query(
        `
          FOR member IN scopeMembers
            FILTER member.scopeKey == @scopeKey
              && member.userOrganizationKey == @userOrganizationKey
            LIMIT 1
            RETURN member
        `,
        { scopeKey, userOrganizationKey },
      );
      const raw = await cursor.next();
      if (!raw) throw new ScopeMemberNotFoundError(scopeKey, userOrganizationKey);
      const member = scopeMemberSchema.parse(withArangoKey(raw as Record<string, unknown>));
      await database.collection(SCOPE_MEMBERS_COLLECTION).remove(member.key);
    },

    async listMembers(scopeKey) {
      const validScopeKey = scopeMemberSchema.shape.scopeKey.parse(scopeKey);
      const cursor = await database.query(
        `
          FOR member IN scopeMembers
            FILTER member.scopeKey == @scopeKey
            SORT member.role ASC, member._key ASC
            RETURN member
        `,
        { scopeKey: validScopeKey },
      );
      const docs = await cursor.all();
      return (docs as Record<string, unknown>[]).map((doc) => scopeMemberSchema.parse(withArangoKey(doc)));
    },

    async listMemberViews(scopeKey) {
      const validScopeKey = scopeMemberSchema.shape.scopeKey.parse(scopeKey);
      const cursor = await database.query(
        `
          FOR member IN scopeMembers
            FILTER member.scopeKey == @scopeKey
            FOR membership IN userOrganizations
              FILTER membership._key == member.userOrganizationKey
              FOR user IN users
                FILTER user._key == membership.userId
                SORT user.name ASC, user._key ASC
                RETURN { member, user }
        `,
        { scopeKey: validScopeKey },
      );
      const rows = await cursor.all();
      return (rows as Array<{ member: Record<string, unknown>; user: Record<string, unknown> }>).map((row) => {
        const member = scopeMemberSchema.parse(withArangoKey(row.member));
        const user = userSchema.parse(withArangoKey(row.user));
        return {
          role: member.role,
          user: {
            key: user.key,
            name: user.name ?? user.alias ?? user.email,
            ...(user.profileUrl ? { avatar: user.profileUrl } : {}),
            ...(user.email ? { email: user.email } : {}),
          },
        } satisfies ScopeMemberView;
      });
    },
  };
}

let cachedDefaultRepository: ScopeMemberRepository | null = null;

export function getDefaultScopeMemberRepository(): ScopeMemberRepository {
  cachedDefaultRepository ??= createScopeMemberRepository();
  return cachedDefaultRepository;
}
