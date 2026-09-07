import { describe, expect, test } from 'bun:test';

const provisioningSource = await Bun.file(new URL('./personal-auth-context.node.ts', import.meta.url)).text();

describe('personal context provisioning', () => {
  test('initializes canonical mail tones for new and existing personal contexts', () => {
    expect(provisioningSource).toContain('async function ensurePersonalMailDefaults(scopeKey: string)');
    expect(provisioningSource).toContain('createEmailRepository(db).initializeTones(scopeKey)');
    expect(provisioningSource).not.toContain('ensureMailFolders');
    expect(provisioningSource.match(/ensurePersonalMailDefaults\(/g)).toHaveLength(3);
  });

  test('does not create synthetic Archive or Gallery containers', () => {
    expect(provisioningSource).not.toContain('My Documents');
    expect(provisioningSource).not.toContain('My Images');
    expect(provisioningSource).not.toContain("'collections', 'collectionMembers', 'folders'");
  });

  test('stores the personal Main scope as the user current scope in the provisioning transaction', () => {
    expect(provisioningSource).toContain("['users', 'teams', 'userTeams', 'scopes', 'scopeMembers']");
    expect(provisioningSource).toContain('UPDATE ${user.key} WITH { currentScopeKey: scope._key');
  });

  test('resolves an active selected scope and repairs invalid selections to personal Main', () => {
    expect(provisioningSource.indexOf('reconcileTeamScopeMemberships(selected.teamKey')).toBeLessThan(provisioningSource.indexOf('LET selectedScope = IS_STRING(user.currentScopeKey)'));
    expect(provisioningSource).toContain('LET selectedScope = IS_STRING(user.currentScopeKey) ? DOCUMENT(scopes, user.currentScopeKey) : null');
    expect(provisioningSource).toContain('selectedTeam.isActive == true && selectedMembership != null && selectedScopeMembership != null');
    expect(provisioningSource).toContain('LET scope = selectedIsAuthorized ? selectedScope : mainScope');
    expect(provisioningSource).toContain('LET repair = user.currentScopeKey != scope._key');
    expect(provisioningSource).toContain('currentScopeKey: scope._key');
  });
});
