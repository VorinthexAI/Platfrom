import { describe, expect, test } from 'bun:test';

describe('Arango communication repository structure', () => {
  test('never combines same-collection mutation forms in one transaction query', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    const queries = [...source.matchAll(/trx\.query(?:<[^;]+?>)?\(\s*(`[^`]*`|'[^']*')/gs)].map((match) => match[1]!);
    expect(queries.length).toBeGreaterThan(10);
    for (const query of queries) {
      for (const collection of ['channels', 'channelParticipants', 'messageReactions', 'pollVotes']) {
        const mutations = ['INSERT', 'UPDATE', 'REMOVE', 'UPSERT'].filter((operation) => {
          if (!query.includes(operation)) return false;
          return new RegExp(`(?:INTO|IN)\\s+${collection}\\b`).test(query);
        });
        if (mutations.includes('UPSERT')) {
          expect(mutations.filter((operation) => operation !== 'INSERT' && operation !== 'UPDATE')).toEqual(['UPSERT']);
        } else {
          expect(mutations.length).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(source).not.toMatch(/REMOVE old IN pollVotes[\s\S]{0,400}UPSERT/);
    expect(source).not.toMatch(/REMOVE existing IN messageReactions[\s\S]{0,400}INSERT .*messageReactions/);
  });

  test('declares read and write collections for direct channels, reactions, and votes', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    expect(source).toContain("read: ['userOrganizations', 'orchestrators', 'scopes', 'scopeMembers']");
    expect(source).toContain("write: ['channels', 'channelParticipants']");
    expect(source).toContain("{ read: ['messages', 'channelParticipants'], write: ['messageReactions'] }");
    expect(source).toContain("{ read: ['pollOptions'], write: ['polls', 'pollVotes'] }");
  });

  test('projects a stable founder display name', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    expect(source.match(/NOT_NULL\(user\.name, user\.alias, user\.email, "Member"\)/g)).toHaveLength(2);
  });

  test('persists a new reaction in the validated message scope', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    expect(source).toContain('RETURN { scopeKey: message.scopeKey, existingKey:');
    expect(source).toContain('scopeKey: validated.scopeKey');
    expect(source).not.toContain('scopeKey: newId()');
  });
});
