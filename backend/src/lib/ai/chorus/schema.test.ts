import { describe, expect, test } from 'bun:test';
import {
  CHORUS_COLLECTIONS,
  baseNodeSchema,
  channelEmbeddingInput,
  channelLinkTargetCollectionSchema,
  channelParticipantSchema,
  channelSchema,
  chorusSchemas,
  embeddingSchema,
  emptyEmbeddingSchema,
  isoDateTimeSchema,
  keySchema,
  messageAttachmentTargetCollectionSchema,
  messageEmbeddingInput,
  messageMentionTargetCollectionSchema,
  pollEmbeddingInput,
  pollOptionEmbeddingInput,
  semanticCollections,
  semanticEmbeddingSchema,
  threadEmbeddingInput,
  type ChorusCollection,
} from './schema';

const timestamp = '2026-01-02T03:04:05.000Z';
const base = { key: 'node-1', embedding: [] as number[], createdAt: timestamp, updatedAt: timestamp };

const fixtures: Record<ChorusCollection, Record<string, unknown>> = {
  channels: { ...base, embedding: [0.1], scopeKey: 'scope-1', name: 'general', type: 'public' },
  channelParticipants: { ...base, scopeKey: 'scope-1', channelKey: 'channel-1', userKey: 'user-1', role: 'member' },
  channelLinks: { ...base, scopeKey: 'scope-1', channelKey: 'channel-1', targetCollection: 'projects', targetKey: 'project-1', relation: 'primary' },
  threads: { ...base, embedding: [0.1], scopeKey: 'scope-1', channelKey: 'channel-1', title: 'A thread' },
  messages: { ...base, embedding: [0.1], scopeKey: 'scope-1', channelKey: 'channel-1', threadKey: 'thread-1', authorParticipantKey: 'participant-1', content: 'Hello' },
  messageMentions: { ...base, scopeKey: 'scope-1', messageKey: 'message-1', targetCollection: 'projects', targetKey: 'project-1' },
  messageReactions: { ...base, scopeKey: 'scope-1', messageKey: 'message-1', participantKey: 'participant-1', emoji: 'thumbs-up' },
  messageAttachments: { ...base, scopeKey: 'scope-1', messageKey: 'message-1', targetCollection: 'documents', targetKey: 'document-1' },
  messageEdits: { ...base, scopeKey: 'scope-1', messageKey: 'message-1', previousContent: 'Before', editedByParticipantKey: 'participant-1', editSequence: 1 },
  channelPins: { ...base, scopeKey: 'scope-1', channelKey: 'channel-1', targetCollection: 'messages', targetKey: 'message-1', pinnedByParticipantKey: 'participant-1' },
  polls: { ...base, embedding: [0.1], scopeKey: 'scope-1', channelKey: 'channel-1', threadKey: 'thread-1', createdByParticipantKey: 'participant-1', question: 'Choose one', multipleChoice: false },
  pollOptions: { ...base, embedding: [0.1], scopeKey: 'scope-1', pollKey: 'poll-1', text: 'Option one', order: 0 },
  pollVotes: { ...base, scopeKey: 'scope-1', pollKey: 'poll-1', optionKey: 'option-1', participantKey: 'participant-1' },
};

describe('Chorus schema primitives', () => {
  test('validates keys, timestamps, and embedding shapes', () => {
    expect(keySchema.safeParse(' key ').success).toBe(true);
    expect(keySchema.safeParse('   ').success).toBe(false);
    expect(keySchema.safeParse('x'.repeat(256)).success).toBe(false);
    expect(isoDateTimeSchema.safeParse(timestamp).success).toBe(true);
    expect(isoDateTimeSchema.safeParse('2026-01-02').success).toBe(false);
    expect(embeddingSchema.safeParse([0, -1.5]).success).toBe(true);
    expect(embeddingSchema.safeParse([Infinity]).success).toBe(false);
    expect(embeddingSchema.safeParse(new Array(8193).fill(0)).success).toBe(false);
    expect(semanticEmbeddingSchema.safeParse([]).success).toBe(false);
    expect(emptyEmbeddingSchema.safeParse([]).success).toBe(true);
    expect(emptyEmbeddingSchema.safeParse([0]).success).toBe(false);
  });

  test('requires all base node fields', () => {
    expect(baseNodeSchema.safeParse(base).success).toBe(true);
    for (const field of ['key', 'embedding', 'createdAt', 'updatedAt']) {
      const input = { ...base };
      delete input[field as keyof typeof input];
      expect(baseNodeSchema.safeParse(input).success).toBe(false);
    }
  });
});

describe('Chorus collection schemas', () => {
  test('accepts complete documents and requires base fields for every collection', () => {
    expect(Object.keys(chorusSchemas)).toEqual([...CHORUS_COLLECTIONS]);
    for (const collection of CHORUS_COLLECTIONS) {
      const schema = chorusSchemas[collection];
      const fixture = fixtures[collection];
      expect(schema.safeParse(fixture).success, collection).toBe(true);
      for (const field of ['key', 'embedding', 'createdAt', 'updatedAt']) {
        const input = { ...fixture };
        delete input[field];
        expect(schema.safeParse(input).success, `${collection} requires ${field}`).toBe(false);
      }
    }
  });

  test('enforces participant identity and non-semantic embedding rules', () => {
    const participant = fixtures.channelParticipants;
    expect(channelParticipantSchema.safeParse({ ...participant, orchestratorKey: 'orchestrator-1' }).success).toBe(false);
    expect(channelParticipantSchema.safeParse({ ...participant, userKey: undefined }).success).toBe(false);
    expect(channelParticipantSchema.safeParse({ ...participant, userKey: undefined, orchestratorKey: 'orchestrator-1' }).success).toBe(true);

    for (const collection of CHORUS_COLLECTIONS.filter((name) => !semanticCollections.has(name) && name !== 'threads')) {
      expect(chorusSchemas[collection].safeParse({ ...fixtures[collection], embedding: [0.1] }).success, `${collection} forbids embeddings`).toBe(false);
    }
    expect(chorusSchemas.threads.safeParse({ ...fixtures.threads, title: undefined, embedding: [0.1] }).success).toBe(false);
    expect(chorusSchemas.threads.safeParse({ ...fixtures.threads, title: 'A thread', embedding: [] }).success).toBe(false);
  });

  test('restricts polymorphic targets to their allowlists', () => {
    const allowlists = [
      [channelLinkTargetCollectionSchema, ['projects', 'milestones', 'tasks', 'folders', 'documents', 'events', 'meetings']],
      [messageMentionTargetCollectionSchema, ['channelParticipants', 'projects', 'milestones', 'tasks', 'folders', 'documents', 'channels', 'threads']],
      [messageAttachmentTargetCollectionSchema, ['documents', 'folders']],
    ] as const;
    for (const [schema, values] of allowlists) {
      expect([...schema.options]).toEqual([...values]);
      expect(schema.safeParse('users').success).toBe(false);
    }
    expect(chorusSchemas.channelPins.safeParse({ ...fixtures.channelPins, targetCollection: 'events' }).success).toBe(false);
    expect(chorusSchemas.channelPins.safeParse({ ...fixtures.channelPins, targetCollection: 'tasks' }).success).toBe(true);
  });
});

describe('Chorus embedding inputs', () => {
  test('builds stable text from semantic content', () => {
    expect(channelEmbeddingInput({ name: ' General ', description: ' Team chat ' })).toBe('General \n\n Team chat');
    expect(channelEmbeddingInput({ name: 'General' })).toBe('General');
    expect(threadEmbeddingInput({ title: ' Thread title ' })).toBe('Thread title');
    expect(threadEmbeddingInput({})).toBe('');
    expect(messageEmbeddingInput({ content: 'Message body' })).toBe('Message body');
    expect(pollEmbeddingInput({ question: 'Which?' })).toBe('Which?');
    expect(pollOptionEmbeddingInput({ text: 'First option' })).toBe('First option');
  });
});
