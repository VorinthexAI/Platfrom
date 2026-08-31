import { aql } from 'arangojs';
import { newId } from '@/lib/ids';
import { withTransaction } from './client';
import { organizationSchema, type Organization } from './organizations.node';
import { userOrganizationSchema, type UserOrganization } from './user-organization.node';
import { scopeMemberSchema, scopeSchema, type Scope, type ScopeMember } from '@/lib/ai/scopes/schema';

export interface PersonalAuthContext {
  organization: Organization;
  membership: UserOrganization;
  scope: Scope;
  scopeMembership: ScopeMember;
}

async function ensurePersonalMailDefaults(scopeKey: string) {
  const { db } = await import('./client');
  const { createEmailRepository } = await import('@/lib/email-inbox/repository');
  await createEmailRepository(db).initializeTones(scopeKey);
}

function personalOrganizationName(name: string | null, email: string) {
  const fallback = email.split('@')[0]?.trim() || 'Personal';
  const verifiedName = name?.trim() || fallback;
  return `${verifiedName}'s Organization`;
}

/** Creates the complete personal workspace atomically after identity verification. */
export async function provisionPersonalAuthContext(user: { key: string; name: string | null; email: string; guestBootstrapSecretHash?: string | null }): Promise<PersonalAuthContext> {
  const existing = await getPersonalAuthContext(user.key);
  if (existing) {
    await ensurePersonalMailDefaults(existing.scope.key);
    return existing;
  }
  const now = new Date().toISOString();
  const organizationKey = newId();
  const membershipKey = newId();
  const scopeKey = newId();
  const scopeMembershipKey = newId();
  const result = await withTransaction(
    ['organizations', 'userOrganizations', 'scopes', 'scopeMembers'],
    async (transaction) => {
      const cursor = await transaction.query(aql`
        UPSERT { personalOwnerUserId: ${user.key} }
          INSERT {
            _key: ${organizationKey}, personalOwnerUserId: ${user.key},
            name: ${personalOrganizationName(user.name, user.email)},
            is_root: false, slug: ${`personal-${user.key}`}, description: null,
            isActive: true, mfa_enabled: false, metadata: {}, createdAt: ${now}, updatedAt: ${now}, embedding: []
          }
          UPDATE {} IN organizations
        LET organization = NEW
        UPSERT { organizationId: organization._key, userId: ${user.key} }
          INSERT {
            _key: ${membershipKey}, organizationId: organization._key, userId: ${user.key},
            orgRole: "owner", orgTitle: "Owner", orchestratorKey: null, status: "active", joinedAt: ${now},
            isMfaEnabled: false, totpSecret: null, lastTotpTimeStep: null, mfaVersion: 0,
            mfaRecoveryPending: false, createdAt: ${now}, updatedAt: ${now}, embedding: []
          }
          UPDATE { orgRole: "owner", status: "active", updatedAt: ${now} } IN userOrganizations
        LET membership = NEW
        UPSERT { organizationKey: organization._key, slug: "main" }
          INSERT {
            _key: ${scopeKey}, organizationKey: organization._key, slug: "main", name: "Main",
            summary: "Main personal workspace", description: "Main personal workspace", position: 1,
            level: 1, embedding: []
          }
          UPDATE {} IN scopes
        LET scope = NEW
        UPSERT { scopeKey: scope._key, userOrganizationKey: membership._key }
          INSERT {
            _key: ${scopeMembershipKey}, scopeKey: scope._key, userOrganizationKey: membership._key,
            role: "owner", status: "active", source: "explicit"
          }
          UPDATE { role: "owner", status: "active" } IN scopeMembers
        LET scopeMembership = NEW
        RETURN { organization, membership, scope, scopeMembership }
      `);
      return cursor.next();
    },
  );
  if (!result) throw new Error('personal auth context provisioning failed');
  const context = {
    organization: organizationSchema.parse({ ...result.organization, key: result.organization._key }),
    membership: userOrganizationSchema.parse({ ...result.membership, key: result.membership._key }),
    scope: scopeSchema.parse({ ...result.scope, key: result.scope._key }),
    scopeMembership: scopeMemberSchema.parse({ ...result.scopeMembership, key: result.scopeMembership._key }),
  };
  await ensurePersonalMailDefaults(context.scope.key);
  return context;
}

export async function getPersonalAuthContext(userId: string): Promise<PersonalAuthContext | null> {
  const { db } = await import('./client');
  const cursor = await db.query(aql`
    FOR organization IN organizations
      FILTER organization.personalOwnerUserId == ${userId} && organization.isActive == true
      LET membership = FIRST(FOR item IN userOrganizations FILTER item.organizationId == organization._key && item.userId == ${userId} && item.status == "active" RETURN item)
      LET scope = FIRST(FOR item IN scopes FILTER item.organizationKey == organization._key && item.slug == "main" RETURN item)
      LET scopeMembership = FIRST(FOR item IN scopeMembers FILTER item.scopeKey == scope._key && item.userOrganizationKey == membership._key && item.status == "active" RETURN item)
      FILTER membership != null && scope != null && scopeMembership != null
      LIMIT 1
      RETURN { organization, membership, scope, scopeMembership }
  `);
  const result = await cursor.next();
  if (!result) return null;
  return {
    organization: organizationSchema.parse({ ...result.organization, key: result.organization._key }),
    membership: userOrganizationSchema.parse({ ...result.membership, key: result.membership._key }),
    scope: scopeSchema.parse({ ...result.scope, key: result.scope._key }),
    scopeMembership: scopeMemberSchema.parse({ ...result.scopeMembership, key: result.scopeMembership._key }),
  };
}
