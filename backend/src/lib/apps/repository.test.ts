import { describe, expect, test } from 'bun:test';
import { CANONICAL_APPS } from './registry';
import { createProductScopeRepository, requireProductScopes } from './repository';

function rows() {
  return CANONICAL_APPS.map((app, index) => ({
    _key: `cm00000000000000000000${String(index).padStart(2, '0')}`,
    teamKey: 'root',
    slug: app.slug,
    name: app.name,
    summary: app.description,
    description: app.detailedDescription,
    position: index + 1,
    level: 1,
    embedding: [],
  }));
}

describe('product scope repository', () => {
  test('selects only the seven designated scopes from the sole root team', async () => {
    let query = '';
    let bindVars: Record<string, unknown> = {};
    const repository = createProductScopeRepository({ query: async (value: string, vars: Record<string, unknown>) => {
      query = value;
      bindVars = vars;
      return { all: async () => rows() } as never;
    } } as never);
    const scopes = await requireProductScopes(repository);
    expect(scopes.size).toBe(7);
    expect(query).toContain('team.is_root == true');
    expect(query).toContain('LENGTH(rootTeams) == 1');
    expect(bindVars.slugs).toEqual(CANONICAL_APPS.map(({ slug }) => slug));
  });

  test('fails closed when the persisted catalog is incomplete', async () => {
    const repository = createProductScopeRepository({ query: async () => ({ all: async () => rows().slice(1) }) } as never);
    await expect(requireProductScopes(repository)).rejects.toThrow('missing: vorinthex-ai');
  });
});
