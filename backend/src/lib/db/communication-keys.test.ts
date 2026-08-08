import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { channelSchema } from './channels.node';
import { channelParticipantSchema } from './channel-participants.node';
import { messageMentionSchema } from './message-mentions.node';
import { messageReactionSchema } from './message-reactions.node';
import { messageSchema } from './messages.node';
import { pollOptionSchema } from './poll-options.node';
import { pollVoteSchema } from './poll-votes.node';
import { pollSchema } from './polls.node';
import { threadSchema } from './threads.node';
import { userReactionSchema } from './user-reactions.node';

const now = '2026-08-01T00:00:00.000Z';
const channelKey = 'channel_general';
const scopeKey = newId();
const messageKey = newId();
const participantKey = newId();
const pollKey = newId();

describe('Communication communication keys', () => {
  test('accepts persisted opaque channel keys across every related document', () => {
    expect(channelSchema.parse({ key: channelKey, organizationKey: 'organization_root', scopeKey, name: 'general', position: 0, createdAt: now, updatedAt: now }).key).toBe(channelKey);
    expect(channelParticipantSchema.parse({ key: participantKey, scopeKey, channelKey, userOrganizationKey: 'membership_root', joinedAt: now, createdAt: now, updatedAt: now }).channelKey).toBe(channelKey);
    expect(messageSchema.parse({ key: messageKey, scopeKey, channelKey, authorParticipantKey: participantKey, content: 'Hello', createdAt: now, updatedAt: now }).channelKey).toBe(channelKey);
    expect(messageMentionSchema.parse({ key: newId(), scopeKey, channelKey, messageKey, participantKey, createdAt: now, updatedAt: now }).channelKey).toBe(channelKey);
    expect(messageReactionSchema.parse({ key: newId(), scopeKey, channelKey, messageKey, participantKey, reaction: 'ack', createdAt: now, updatedAt: now }).channelKey).toBe(channelKey);
    expect(threadSchema.parse({ key: newId(), scopeKey, channelKey, title: 'Discussion', rootMessageKey: messageKey, createdAt: now, updatedAt: now }).channelKey).toBe(channelKey);
    expect(pollSchema.parse({ key: pollKey, scopeKey, channelKey, messageKey, creatorParticipantKey: participantKey, question: 'Proceed?', status: 'open', createdAt: now, updatedAt: now }).channelKey).toBe(channelKey);
    expect(pollOptionSchema.parse({ key: newId(), scopeKey, channelKey, pollKey, text: 'Yes', position: 0, createdAt: now, updatedAt: now }).channelKey).toBe(channelKey);
    expect(pollVoteSchema.parse({ key: newId(), scopeKey, channelKey, pollKey, optionKey: newId(), participantKey, createdAt: now, updatedAt: now }).channelKey).toBe(channelKey);
  });

  test('accepts persisted opaque user keys for reaction usage', () => {
    const userKey = 'user_founder';
    expect(userReactionSchema.parse({ key: newId(), userKey, reactionSlug: 'ack', count: 1, createdAt: now, updatedAt: now }).userKey).toBe(userKey);
  });
});
