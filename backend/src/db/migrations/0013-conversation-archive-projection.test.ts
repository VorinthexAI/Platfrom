import { expect, test } from 'bun:test';
import { migrateConversationArchiveProjection } from './0013-conversation-archive-projection';

test('creates durable conversation Archive state and private-owner lookup indexes', async () => {
  const indexes = new Map<string, unknown[]>();
  let created = false;
  const collections = new Map(['conversationArchiveStates', 'folders', 'documents'].map((name) => [name, {
    exists: async () => false,
    create: async () => { if (name === 'conversationArchiveStates') created = true; },
    ensureIndex: async (index: unknown) => { const values = indexes.get(name) ?? []; values.push(index); indexes.set(name, values); },
  }]));

  await migrateConversationArchiveProjection({ collection: (name: string) => collections.get(name)! } as never);

  expect(created).toBe(true);
  expect(indexes.get('conversationArchiveStates')).toContainEqual({ type: 'persistent', fields: ['conversationKey'], unique: true });
  expect(indexes.get('folders')).toContainEqual({ type: 'persistent', fields: ['scopeKey', 'privateOwnerUserKey', 'parentFolderKey'], sparse: true });
  expect(indexes.get('documents')).toContainEqual({ type: 'persistent', fields: ['scopeKey', 'privateOwnerUserKey', 'folderKey'], sparse: true });
});
