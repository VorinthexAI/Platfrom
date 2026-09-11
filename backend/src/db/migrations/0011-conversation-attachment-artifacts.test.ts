import { expect, test } from 'bun:test';
import { migrateConversationAttachmentArtifacts } from './0011-conversation-attachment-artifacts';

test('creates the single durable attachment manifest/outbox collection and recovery indexes', async () => {
  const indexes: unknown[] = []; let created = false;
  const collection = { exists: async () => false, create: async () => { created = true; }, ensureIndex: async (index: unknown) => { indexes.push(index); } };
  await migrateConversationAttachmentArtifacts({ collection: (name: string) => { expect(name).toBe('conversationAttachmentArtifacts'); return collection; } } as never);
  expect(created).toBe(true);
  expect(indexes).toContainEqual({ type: 'persistent', fields: ['status', 'availableAt'] });
  expect(indexes).toContainEqual({ type: 'persistent', fields: ['leaseExpiresAt'], sparse: true });
  expect(indexes).toContainEqual({ type: 'persistent', fields: ['expiresAt'] });
  expect(indexes).toContainEqual({ type: 'persistent', fields: ['stagedStorageKey'], unique: true });
});
