import { expect, test } from 'bun:test';
import { graphMigrations } from '.';
import { removeUniqueSparkEventIndex } from './0002-spark-event-index';

test('removes only the unique Spark event index and registers the migration in order', async () => {
  const dropped: string[] = [];
  const database = {
    collection: () => ({
      indexes: async () => [
        { id: 'primary', fields: ['_key'], unique: true },
        { id: 'event-unique', fields: ['eventKey'], unique: true },
        { id: 'history', fields: ['userKey', 'createdAt'], unique: false },
      ],
      dropIndex: async (id: string) => { dropped.push(id); },
    }),
  };

  await removeUniqueSparkEventIndex(database as never);

  expect(dropped).toEqual(['event-unique']);
  expect(graphMigrations.map(({ id }) => id)).toEqual(['0001-legacy-schema', '0002-spark-event-index', '0003-funding-requirement-index', '0004-event-device', '0005-canonical-managed-archive-folders', '0006-initial-audiobook', '0007-managed-audiobook-live-cover', '0008-private-email-ownership', '0009-user-inbox', '0010-conversation-message-recall-index', '0011-conversation-attachment-artifacts', '0012-retire-navigation-visits']);
});
