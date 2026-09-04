import { describe, expect, test } from 'bun:test';
import { migrateScopeTags } from './arango-migrate';

describe('scope tag migration', () => {
  test('deletes ownerless tag assignments before legacy tags', async () => {
    const queries: string[] = [];
    const database = { collection: () => ({ async exists() { return true; } }), async query(query: string) { queries.push(query); return { async next() {}, async all() { return []; } }; } };
    await migrateScopeTags(database as never);
    expect(queries).toHaveLength(1); expect(queries[0]).toContain('assignment.tagKey IN legacyTagKeys'); expect(queries[0]).toContain('REMOVE assignment'); expect(queries[0]).toContain('REMOVE tag');
    expect(queries.join('\n')).not.toContain('UPDATE tag WITH { userKey');
  });
  test('declares the private normalized-name unique index and retains assignment indexes', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    expect(source).toContain("{ fields: ['scopeKey', 'userKey', 'normalizedName'], unique: true }");
    expect(source).toContain("{ fields: ['scopeKey', 'tagKey', 'sourceType', 'sourceKey'], unique: true }");
    expect(source).toContain("{ fields: ['scopeKey', 'sourceType', 'sourceKey'] }");
    expect(source).toContain("{ fields: ['scopeKey', 'tagKey'] }");
  });
});
