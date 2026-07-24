import { describe, expect, test } from 'bun:test';
import { CHORUS_COLLECTIONS } from './schema';
import { CHORUS_INDEXES, ensureChorusCollections } from './indexes';

describe('Chorus collection indexes', () => {
  test('creates missing collections and ensures every declared persistent index', async () => {
    const created: string[] = [];
    const ensured: Array<{ collection: string; index: Record<string, unknown> }> = [];
    const existing = new Set(['channels', 'messages']);
    const database = {
      collection(name: string) {
        return {
          async exists() { return existing.has(name); },
          async create() { created.push(name); existing.add(name); },
          async ensureIndex(index: Record<string, unknown>) { ensured.push({ collection: name, index }); },
        };
      },
    };

    await ensureChorusCollections(database as unknown as Parameters<typeof ensureChorusCollections>[0]);

    expect(created).toEqual(CHORUS_COLLECTIONS.filter((name) => !['channels', 'messages'].includes(name)));
    expect(ensured).toEqual(CHORUS_COLLECTIONS.flatMap((collection) =>
      CHORUS_INDEXES[collection].map((index) => ({ collection, index: { type: 'persistent', ...index } })),
    ));
  });

  test('keeps required uniqueness and sparse participant identity indexes', () => {
    expect(CHORUS_INDEXES.channelParticipants.slice(0, 2)).toEqual([
      { fields: ['channelKey', 'userKey'], unique: true, sparse: true },
      { fields: ['channelKey', 'orchestratorKey'], unique: true, sparse: true },
    ]);
    expect(CHORUS_INDEXES.pollVotes[0]).toEqual({ fields: ['pollKey', 'optionKey', 'participantKey'], unique: true });
  });
});
