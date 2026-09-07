import { aql } from 'arangojs';
import { newId } from '@/lib/ids';
import { withTransaction } from './client';
import { teamSchema, type Team } from './teams.node';
import { userTeamSchema, type UserTeam } from './user-team.node';
import { scopeMemberSchema, scopeSchema, type Scope, type ScopeMember } from '@/lib/ai/scopes/schema';
import { reconcileTeamScopeMemberships } from '@/lib/ai/scopes/membership-invariant';

export interface PersonalAuthContext {
  team: Team;
  membership: UserTeam;
  scope: Scope;
  scopeMembership: ScopeMember;
}

async function ensurePersonalMailDefaults(scopeKey: string) {
  const { db } = await import('./client');
  const { createEmailRepository } = await import('@/lib/email-inbox/repository');
  await createEmailRepository(db).initializeTones(scopeKey);
}

function personalTeamName(name: string | null, email: string) {
  const fallback = email.split('@')[0]?.trim() || 'Personal';
  const verifiedName = name?.trim() || fallback;
  return `${verifiedName}'s Team`;
}

/** Creates the complete personal workspace atomically after identity verification. */
export async function provisionPersonalAuthContext(
  user: { key: string; name: string | null; email: string; currentScopeKey?: string; guestBootstrapSecretHash?: string | null },
  options: { mainScopeKey?: string } = {},
): Promise<PersonalAuthContext> {
  const existing = await getPersonalAuthContext(user.key);
  if (existing) {
    if (!user.currentScopeKey) {
      const { db } = await import('./client');
      await db.query(aql`UPDATE ${user.key} WITH { currentScopeKey: ${existing.scope.key} } IN users`);
    }
    await ensurePersonalMailDefaults(existing.scope.key);
    return existing;
  }
  const now = new Date().toISOString();
  const teamKey = newId();
  const teamMembershipKey = newId();
  const scopeKey = options.mainScopeKey ?? newId();
  const scopeTeamMembershipKey = newId();
  const result = await withTransaction(
    ['users', 'teams', 'userTeams', 'scopes', 'scopeMembers'],
    async (transaction) => {
      const cursor = await transaction.query(aql`
        UPSERT { personalOwnerUserId: ${user.key} }
          INSERT {
            _key: ${teamKey}, personalOwnerUserId: ${user.key},
            name: ${personalTeamName(user.name, user.email)},
            is_root: false, slug: ${`personal-${user.key}`}, description: null,
            isActive: true, mfa_enabled: false, metadata: {}, createdAt: ${now}, updatedAt: ${now}, embedding: []
          }
          UPDATE {} IN teams
        LET team = NEW
        UPSERT { teamKey: team._key, userId: ${user.key} }
          INSERT {
            _key: ${teamMembershipKey}, teamKey: team._key, userId: ${user.key},
            teamRole: "owner", teamTitle: "Owner", orchestratorKey: null, status: "active", environmentSeeded: false, joinedAt: ${now},
            isMfaEnabled: false, totpSecret: null, lastTotpTimeStep: null, teamMfaVersion: 0,
            teamMfaRecoveryPending: false, createdAt: ${now}, updatedAt: ${now}, embedding: []
          }
          UPDATE { teamRole: "owner", status: "active", updatedAt: ${now} } IN userTeams
        LET membership = NEW
        UPSERT { teamKey: team._key, slug: "main" }
          INSERT {
            _key: ${scopeKey}, teamKey: team._key, slug: "main", name: "Main",
            summary: "Main personal workspace", description: "Main personal workspace", position: 1,
            level: 1, embedding: []
          }
          UPDATE {} IN scopes
        LET scope = NEW
        UPSERT { scopeKey: scope._key, userTeamKey: membership._key }
          INSERT {
            _key: ${scopeTeamMembershipKey}, scopeKey: scope._key, userTeamKey: membership._key,
            role: "owner", status: "active", source: "explicit"
          }
          UPDATE { role: "owner", status: "active" } IN scopeMembers
        LET scopeMembership = NEW
        UPDATE ${user.key} WITH { currentScopeKey: scope._key, updatedAt: ${now} } IN users
        RETURN { team, membership, scope, scopeMembership }
      `);
      return cursor.next();
    },
  );
  if (!result) throw new Error('personal auth context provisioning failed');
  const context = {
    team: teamSchema.parse({ ...result.team, key: result.team._key }),
    membership: userTeamSchema.parse({ ...result.membership, key: result.membership._key }),
    scope: scopeSchema.parse({ ...result.scope, key: result.scope._key }),
    scopeMembership: scopeMemberSchema.parse({ ...result.scopeMembership, key: result.scopeMembership._key }),
  };
  await ensurePersonalMailDefaults(context.scope.key);
  return context;
}

export async function getPersonalAuthContext(userId: string): Promise<PersonalAuthContext | null> {
  const { db } = await import('./client');
  const selectedCursor = await db.query<{ teamKey: string; teamMembershipKey: string; scopeKey: string }>(aql`
    LET user = DOCUMENT(users, ${userId})
    LET scope = user == null || !IS_STRING(user.currentScopeKey) ? null : DOCUMENT(scopes, user.currentScopeKey)
    LET team = scope == null ? null : DOCUMENT(teams, scope.teamKey)
    LET membership = team == null ? null : FIRST(FOR item IN userTeams FILTER item.teamKey == team._key && item.userId == ${userId} && item.status == "active" LIMIT 1 RETURN item)
    FILTER scope != null && team != null && team.isActive == true && membership != null
    RETURN { teamKey: team._key, teamMembershipKey: membership._key, scopeKey: scope._key }
  `);
  const selected = await selectedCursor.next();
  if (selected) await reconcileTeamScopeMemberships(selected.teamKey, { scopeKeys: [selected.scopeKey], userTeamKeys: [selected.teamMembershipKey] }, db);
  const cursor = await db.query(aql`
    LET user = DOCUMENT(users, ${userId})
    FOR personalTeam IN teams
      FILTER user != null && personalTeam.personalOwnerUserId == ${userId} && personalTeam.isActive == true
      LET personalMembership = FIRST(FOR item IN userTeams FILTER item.teamKey == personalTeam._key && item.userId == ${userId} && item.status == "active" RETURN item)
      LET mainScope = FIRST(FOR item IN scopes FILTER item.teamKey == personalTeam._key && item.slug == "main" RETURN item)
      LET mainScopeMembership = FIRST(FOR item IN scopeMembers FILTER item.scopeKey == mainScope._key && item.userTeamKey == personalMembership._key && item.status == "active" RETURN item)
      FILTER personalMembership != null && mainScope != null && mainScopeMembership != null
      LET selectedScope = IS_STRING(user.currentScopeKey) ? DOCUMENT(scopes, user.currentScopeKey) : null
      LET selectedTeam = selectedScope == null ? null : DOCUMENT(teams, selectedScope.teamKey)
      LET selectedMembership = selectedTeam == null ? null : FIRST(FOR item IN userTeams FILTER item.teamKey == selectedTeam._key && item.userId == ${userId} && item.status == "active" RETURN item)
      LET selectedScopeMembership = selectedMembership == null ? null : FIRST(FOR item IN scopeMembers FILTER item.scopeKey == selectedScope._key && item.userTeamKey == selectedMembership._key && item.status == "active" RETURN item)
      LET selectedIsAuthorized = selectedTeam != null && selectedTeam.isActive == true && selectedMembership != null && selectedScopeMembership != null
      LET team = selectedIsAuthorized ? selectedTeam : personalTeam
      LET membership = selectedIsAuthorized ? selectedMembership : personalMembership
      LET scope = selectedIsAuthorized ? selectedScope : mainScope
      LET scopeMembership = selectedIsAuthorized ? selectedScopeMembership : mainScopeMembership
      LET repair = user.currentScopeKey != scope._key
      LIMIT 1
      UPDATE user WITH (repair ? { currentScopeKey: scope._key, updatedAt: ${new Date().toISOString()} } : {}) IN users
      RETURN { team, membership, scope, scopeMembership }
  `);
  const result = await cursor.next();
  if (!result) return null;
  return {
    team: teamSchema.parse({ ...result.team, key: result.team._key }),
    membership: userTeamSchema.parse({ ...result.membership, key: result.membership._key }),
    scope: scopeSchema.parse({ ...result.scope, key: result.scope._key }),
    scopeMembership: scopeMemberSchema.parse({ ...result.scopeMembership, key: result.scopeMembership._key }),
  };
}

/** Selects the verified user's personal Main scope before issuing base auth. */
export async function selectPersonalAuthContext(userId: string): Promise<PersonalAuthContext | null> {
  const { db } = await import('./client');
  const cursor = await db.query<{ scopeKey: string }>(aql`
    LET team = FIRST(FOR item IN teams FILTER item.personalOwnerUserId == ${userId} && item.isActive == true LIMIT 1 RETURN item)
    LET membership = team == null ? null : FIRST(FOR item IN userTeams FILTER item.teamKey == team._key && item.userId == ${userId} && item.status == "active" LIMIT 1 RETURN item)
    LET scope = team == null ? null : FIRST(FOR item IN scopes FILTER item.teamKey == team._key && item.slug == "main" LIMIT 1 RETURN item)
    LET scopeMembership = membership == null || scope == null ? null : FIRST(FOR item IN scopeMembers FILTER item.scopeKey == scope._key && item.userTeamKey == membership._key && item.status == "active" LIMIT 1 RETURN item)
    FILTER scopeMembership != null
    UPDATE ${userId} WITH { currentScopeKey: scope._key, updatedAt: ${new Date().toISOString()} } IN users
    RETURN { scopeKey: scope._key }
  `);
  if (!await cursor.next()) return null;
  return getPersonalAuthContext(userId);
}
