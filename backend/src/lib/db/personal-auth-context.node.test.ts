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
});
