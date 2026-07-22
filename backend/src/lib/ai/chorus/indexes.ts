import { db } from '@/lib/db/client';
import { CHORUS_COLLECTIONS, type ChorusCollection } from './schema';

type SetupDatabase = Pick<typeof db, 'collection'>;
type Index = { fields: string[]; unique?: boolean; sparse?: boolean };

const indexes: Record<ChorusCollection, Index[]> = {
  channels: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'deletedAt'] }, { fields: ['scopeKey', 'name'] }, { fields: ['type'] }, { fields: ['deletedAt'] }],
  channelParticipants: [{ fields: ['channelKey', 'userKey'], unique: true, sparse: true }, { fields: ['channelKey', 'orchestratorKey'], unique: true, sparse: true }, { fields: ['channelKey'] }, { fields: ['scopeKey'] }, { fields: ['userKey'] }, { fields: ['orchestratorKey'] }, { fields: ['channelKey', 'deletedAt'] }],
  channelLinks: [{ fields: ['channelKey', 'targetCollection', 'targetKey', 'relation'], unique: true }, { fields: ['channelKey'] }, { fields: ['targetCollection', 'targetKey'] }, { fields: ['scopeKey'] }, { fields: ['relation'] }, { fields: ['deletedAt'] }],
  // Arango persistent indexes cannot express "one active root". The
  // repository enforces that invariant in the channel creation transaction.
  threads: [{ fields: ['channelKey'] }, { fields: ['channelKey', 'isRoot'] }, { fields: ['scopeKey'] }, { fields: ['resolvedAt'] }, { fields: ['deletedAt'] }],
  messages: [{ fields: ['threadKey'] }, { fields: ['channelKey'] }, { fields: ['authorParticipantKey'] }, { fields: ['scopeKey'] }, { fields: ['createdAt'] }, { fields: ['deletedAt'] }, { fields: ['threadKey', 'createdAt'] }],
  messageMentions: [{ fields: ['messageKey', 'targetCollection', 'targetKey'], unique: true }, { fields: ['messageKey'] }, { fields: ['targetCollection', 'targetKey'] }, { fields: ['scopeKey'] }, { fields: ['deletedAt'] }],
  messageReactions: [{ fields: ['messageKey', 'participantKey', 'emoji'], unique: true }, { fields: ['messageKey'] }, { fields: ['participantKey'] }, { fields: ['messageKey', 'participantKey'] }, { fields: ['deletedAt'] }],
  messageAttachments: [{ fields: ['messageKey', 'targetCollection', 'targetKey'], unique: true }, { fields: ['messageKey'] }, { fields: ['targetCollection', 'targetKey'] }, { fields: ['scopeKey'] }, { fields: ['deletedAt'] }],
  messageEdits: [{ fields: ['messageKey', 'editSequence'], unique: true }, { fields: ['messageKey'] }, { fields: ['editedByParticipantKey'] }, { fields: ['createdAt'] }, { fields: ['deletedAt'] }],
  channelPins: [{ fields: ['channelKey', 'threadKey', 'targetCollection', 'targetKey'], unique: true }, { fields: ['channelKey'] }, { fields: ['threadKey'] }, { fields: ['targetCollection', 'targetKey'] }, { fields: ['pinnedByParticipantKey'] }, { fields: ['deletedAt'] }],
  polls: [{ fields: ['threadKey'] }, { fields: ['channelKey'] }, { fields: ['createdByParticipantKey'] }, { fields: ['closesAt'] }, { fields: ['closedAt'] }, { fields: ['deletedAt'] }],
  pollOptions: [{ fields: ['pollKey', 'order'], unique: true }, { fields: ['pollKey'] }, { fields: ['deletedAt'] }],
  pollVotes: [{ fields: ['pollKey', 'optionKey', 'participantKey'], unique: true }, { fields: ['pollKey'] }, { fields: ['optionKey'] }, { fields: ['participantKey'] }, { fields: ['pollKey', 'participantKey'] }, { fields: ['deletedAt'] }],
};

export async function ensureChorusCollections(database: SetupDatabase = db): Promise<void> {
  for (const name of CHORUS_COLLECTIONS) {
    const collection = database.collection(name);
    if (!(await collection.exists())) await collection.create();
    for (const index of indexes[name]) await collection.ensureIndex({ type: 'persistent', ...index });
  }
}

export { indexes as CHORUS_INDEXES };
