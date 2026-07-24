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
import { projectSchema } from './projects.node';
import { milestoneSchema } from './milestones.node';
import { taskSchema } from './tasks.node';
import { documentVersionSchema } from './document-versions.node';
import { documentShareSchema } from './document-shares.node';

describe('node registry schema contracts', () => {
  test('registry serves organizations and user links, never the retired team/platform nodes', () => {
    expect(NODE_NAMES).toContain('actions');
    expect(NODE_NAMES).toContain('providers');
    expect(NODE_NAMES).toContain('models');
    expect(NODE_NAMES).toContain('modelActions');
    expect(NODE_NAMES).toContain('modelProviders');
    expect(NODE_NAMES).toContain('agents');
    expect(NODE_NAMES).toContain('agentSkills');
    expect(NODE_NAMES).toContain('scopeAgents');
    expect(NODE_NAMES).toContain('agentMembers');
    expect(NODE_NAMES).toContain('skills');
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
      'documentShares',
      'projects',
      'milestones',
      'tasks',
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
      documentVersionSchema,
      documentShareSchema,
    ]) {
      const object = schema instanceof z.ZodEffects ? schema.innerType() : schema;
      expect(object.shape).toHaveProperty('key');
      expect(object.shape).toHaveProperty('scopeKey');
      expect(object.shape).toHaveProperty('createdAt');
      expect(object.shape).toHaveProperty('updatedAt');
      expect(object.shape).toHaveProperty('embedding');
    }
    expect(documentSchema.shape).toHaveProperty('html');
    expect(documentSchema.shape).toHaveProperty('json');
    expect(documentSchema.shape).toHaveProperty('content');
    expect(documentSchema.shape).toHaveProperty('scopeKey');
    expect(documentSchema.shape).toHaveProperty('folderKey');
    expect(documentSchema.shape).toHaveProperty('storageKey');
    expect(documentSchema.shape).toHaveProperty('sizeBytes');
    for (const schema of [projectSchema, milestoneSchema, taskSchema]) {
      expect(schema.shape).toHaveProperty('key');
      expect(schema.shape).toHaveProperty('scopeKey');
      expect(schema.shape).toHaveProperty('embedding');
      expect(schema.shape).toHaveProperty('deletedAt');
      expect(schema.shape).toHaveProperty('createdAt');
      expect(schema.shape).toHaveProperty('updatedAt');
    }
    for (const schema of [folderSchema, documentSchema, documentVersionSchema, documentShareSchema]) {
      expect(schema.shape).toHaveProperty('deletedAt');
      expect(schema.shape.deletedAt.parse(undefined)).toBeNull();
    }
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
