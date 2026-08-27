import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { NODE_NAMES, NODE_REGISTRY, registerNode } from './registry';
import { organizationSchema } from './organizations.node';
import { userOrganizationSchema } from './user-organization.node';
import { userSchema } from './users.node';
import { channelSchema } from './channels.node';
import { channelParticipantSchema } from './channel-participants.node';
import { threadSchema } from './threads.node';
import { messageSchema } from './messages.node';
import { messageReactionSchema } from './message-reactions.node';
import { messageMentionSchema } from './message-mentions.node';
import { pollSchema } from './polls.node';
import { pollOptionSchema } from './poll-options.node';
import { pollVoteSchema } from './poll-votes.node';
import { folderSchema } from './folders.node';
import { documentSchema } from './documents.node';
import { documentVersionSchema } from './document-versions.node';
import { documentShareSchema } from './document-shares.node';
import { imageSchema } from './images.node';
import { collectionSchema } from './collections.node';
import { shareSchema } from './shares.node';
import { placeSchema } from './places.node';

describe('node registry schema contracts', () => {
  test('registry serves organizations and user links, never the retired team/platform nodes', () => {
    expect(NODE_NAMES).not.toContain('actions');
    expect(NODE_NAMES).toContain('providers');
    expect(NODE_NAMES).toContain('models');
    expect(NODE_NAMES).toContain('modelActions');
    expect(NODE_NAMES).toContain('modelProviders');
    expect(NODE_NAMES).not.toContain('agents');
    expect(NODE_NAMES).not.toContain('agentSkills');
    expect(NODE_NAMES).not.toContain('scopeAgents');
    expect(NODE_NAMES).not.toContain('agentMembers');
    expect(NODE_NAMES).not.toContain('skills');
    expect(NODE_NAMES).toEqual(expect.arrayContaining([
      'channels',
      'channelParticipants',
      'threads',
      'messages',
      'messageReactions',
      'messageMentions',
      'polls',
      'pollOptions',
      'pollVotes',
      'folders',
      'documents',
      'documentVersions',
      'images',
      'collections',
      'collectionImages',
      'collectionMembers',
      'tags',
      'tagAssignments',
      'places',
    ]));
    expect(NODE_NAMES).not.toContain('agentTools');
    expect(NODE_NAMES).not.toContain('tools');
    expect(NODE_NAMES).not.toContain('toolActions');
    expect(NODE_NAMES).toContain('users');
    expect(NODE_NAMES).toContain('organizations');
    expect(NODE_NAMES).toContain('userOrganizations');
    expect(NODE_NAMES).not.toContain('organizationMembers');
    expect(NODE_NAMES).not.toContain('platforms');
    expect(NODE_NAMES).not.toContain('teams');
    expect(NODE_NAMES).not.toContain('teamMembers');
    expect(NODE_NAMES).not.toContain('teamMemberInvites');
    expect(NODE_NAMES).not.toContain('members');
    expect(NODE_NAMES).not.toContain('superAdmins');
    expect(NODE_NAMES).not.toContain('templates');
  });

  test('new and changed node schemas carry embedding fields', () => {
    expect(userSchema.shape).toHaveProperty('embedding');
    expect(organizationSchema.shape).toHaveProperty('embedding');
    expect(userOrganizationSchema.shape).toHaveProperty('embedding');
    for (const schema of [
      channelSchema,
      channelParticipantSchema,
      threadSchema,
      messageSchema,
      messageReactionSchema,
      messageMentionSchema,
      pollSchema,
      pollOptionSchema,
      pollVoteSchema,
      folderSchema,
    ]) {
      const object = schema instanceof z.ZodEffects ? schema.innerType() : schema;
      expect(object.shape).toHaveProperty('key');
      expect(object.shape).toHaveProperty('scopeKey');
      expect(object.shape).toHaveProperty('createdAt');
      expect(object.shape).toHaveProperty('updatedAt');
      expect(object.shape).toHaveProperty('embedding');
    }
    expect(documentSchema.shape).not.toHaveProperty('html');
    expect(documentSchema.shape).not.toHaveProperty('json');
    expect(documentSchema.shape).toHaveProperty('content');
    expect(documentSchema.shape).toHaveProperty('scopeKey');
    expect(documentSchema.shape).toHaveProperty('folderKey');
    expect(documentSchema.shape).toHaveProperty('storageKey');
    expect(documentSchema.shape).toHaveProperty('sizeBytes');
    expect(folderSchema.shape).not.toHaveProperty('audioBook');
    expect(documentSchema.shape).not.toHaveProperty('audioChapter');
    expect(documentVersionSchema.shape).toHaveProperty('key');
    expect(documentVersionSchema.shape).toHaveProperty('scopeKey');
    expect(documentVersionSchema.shape).toHaveProperty('createdAt');
    expect(documentVersionSchema.shape).toHaveProperty('embedding');
    expect(documentVersionSchema.shape).not.toHaveProperty('updatedAt');
    expect(imageSchema.shape).toHaveProperty('embedding');
    expect(collectionSchema.shape).toHaveProperty('embedding');
    expect(placeSchema.shape).toHaveProperty('embedding');
    expect(NODE_NAMES).not.toContain('trips');
    expect(NODE_NAMES).not.toContain('tripGuides');
    expect(NODE_NAMES).not.toContain('placeReports');
    expect(NODE_NAMES).not.toContain('tripPlaces');
    expect(NODE_NAMES).not.toContain('tripAttachments');
    expect(NODE_NAMES).not.toContain('placeVisits');
    for (const historical of ['books', 'bookContexts', 'bookThemes', 'bookSources', 'bookParts', 'bookChapters', 'chapterContexts', 'bookProgress']) expect(NODE_NAMES).toContain(historical);
    for (const privateDomain of ['emailInboxes', 'emailThreads', 'emailMessages', 'emailDrafts', 'emailTones', 'emailReplyContext', 'emailWritingProfiles', 'emailAttachments', 'tripGuides', 'placeReferences', 'placeHeroMedia']) expect(NODE_NAMES).not.toContain(privateDomain);
    expect(NODE_NAMES).not.toContain('shares');
    expect(NODE_NAMES).not.toContain('collectionInvites');
    expect(NODE_NAMES).not.toContain('documentShares');
    expect(documentShareSchema.shape).toHaveProperty('key');
    expect(documentShareSchema.shape).not.toHaveProperty('embedding');
    expect(shareSchema.shape).toHaveProperty('sourceType');
    expect(shareSchema.shape).toHaveProperty('sourceKey');
    expect(shareSchema.shape).not.toHaveProperty('embedding');
    for (const schema of [imageSchema, collectionSchema, folderSchema, documentSchema, documentVersionSchema, documentShareSchema, shareSchema]) expect(schema.safeParse({}).success).toBe(false);
  });

  test('requires exactly one channel participant identity', () => {
    const participant = {
      key: 'cmrnlzf640000qc7k4p5zem5w', scopeKey: 'cmrnlzf640001qc7k4p5zem5w', channelKey: 'cmrnlzf640002qc7k4p5zem5w',
      joinedAt: '2026-07-22T00:00:00.000Z', createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
    };
    expect(() => channelParticipantSchema.parse(participant)).toThrow();
    expect(() => channelParticipantSchema.parse({ ...participant, userOrganizationKey: 'cmrnlzf640003qc7k4p5zem5w', orchestratorKey: 'cmrnlzf640004qc7k4p5zem5w' })).toThrow();
    expect(channelParticipantSchema.parse({ ...participant, userOrganizationKey: 'cmrnlzf640003qc7k4p5zem5w' }).userOrganizationKey).toBeDefined();
  });

  test('registers new nodes for generic consumers', () => {
    const name = 'traverseTestNode';
    registerNode(name, { listPage: async () => ({ items: [], nextCursor: null }), async *getAllChunked() {}, async upsertByKey() { return {}; } });
    expect(NODE_REGISTRY[name]).toBeDefined();
    expect(NODE_NAMES).toContain(name);
  });
});
