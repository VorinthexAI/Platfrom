import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { channelParticipantSchema, channelSchema, chorusEmbeddingFields, messageSchema, validateMessage, type ChorusLookup } from './index';

const now = '2026-07-22T00:00:00.000Z';

describe('Chorus referential validation', () => {
  test('uses the prescribed semantic embedding fields', () => {
    expect(chorusEmbeddingFields).toEqual({
      channels: ['name', 'description'],
      channelParticipants: [],
      threads: ['title'],
      messages: ['content'],
      messageMentions: [],
      messageReactions: ['reaction'],
    });
  });

  test('rejects a message authored by a participant from another channel', async () => {
    const scopeKey = newId();
    const channel = channelSchema.parse({ key: newId(), scopeKey, name: 'engineering', position: 0, createdAt: now, updatedAt: now });
    const participant = channelParticipantSchema.parse({ key: newId(), scopeKey, channelKey: newId(), userOrganizationKey: newId(), joinedAt: now, createdAt: now, updatedAt: now });
    const message = messageSchema.parse({ key: newId(), scopeKey, channelKey: channel.key, authorParticipantKey: participant.key, content: 'Hello', createdAt: now, updatedAt: now });
    const lookup: ChorusLookup = {
      hasScope: async () => true,
      getChannel: async () => channel,
      getParticipant: async () => participant,
      getMessage: async () => null,
      getThread: async () => null,
      hasActiveScopeMember: async () => true,
      hasOrchestratorScopeAccess: async () => true,
    };
    await expect(validateMessage(message, lookup)).rejects.toThrow('Message author must participate in its channel');
  });
});
