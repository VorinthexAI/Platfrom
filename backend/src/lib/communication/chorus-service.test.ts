import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { channelSchema } from '@/lib/db/channels.node';
import { channelParticipantSchema } from '@/lib/db/channel-participants.node';
import type { Message } from '@/lib/db/messages.node';
import { userMentionSchema } from '@/lib/db/user-mentions.node';
import { ChorusService } from './chorus-service';
import type { CommunicationRepository, GeneralChannelAccess } from './repository';

const now = '2026-07-24T12:00:00.000Z';
const organizationKey = 'root-org';
const membershipKey = newId();
const scopeKey = newId();
const actor = { organizationKey, membershipKey };

function fixture() {
  const channel = channelSchema.parse({ key: newId(), organizationKey, scopeKey, name: 'general', description: 'Organization-wide conversation', position: 0, createdAt: now, updatedAt: now });
  const human = channelParticipantSchema.parse({ key: newId(), scopeKey, channelKey: channel.key, userOrganizationKey: membershipKey, joinedAt: now, createdAt: now, updatedAt: now });
  const atlas = channelParticipantSchema.parse({ key: newId(), scopeKey, channelKey: channel.key, orchestratorKey: newId(), joinedAt: now, createdAt: now, updatedAt: now });
  const metis = channelParticipantSchema.parse({ key: newId(), scopeKey, channelKey: channel.key, orchestratorKey: newId(), joinedAt: now, createdAt: now, updatedAt: now });
  const access: GeneralChannelAccess = { channel, humanParticipant: human, viewerUserKey: newId(), mentions: [
    { participantKey: 'everyone', type: 'everyone', key: 'everyone', name: 'everyone', mentionCount: 0 },
    { participantKey: human.key, type: 'user', key: newId(), name: 'Founder', mentionCount: 0 },
    { participantKey: atlas.key, type: 'orchestrator', key: atlas.orchestratorKey!, name: 'Atlas', role: 'CEO', skill: 'Lead.', mentionCount: 0 },
    { participantKey: metis.key, type: 'orchestrator', key: metis.orchestratorKey!, name: 'Metis', role: 'CIO', skill: 'Analyze.', mentionCount: 0 },
  ] };
  const messages: Message[] = [];
  const mentions: unknown[] = [];
  const usage: string[][] = [];
  const events: Array<{ scopeId: string; slug: string; data?: Record<string, unknown> | null }> = [];
  const reactionUsage = [{ reaction: '🔥', count: 4 }, { reaction: '✅', count: 2 }];
  const repository = {
    ensureGeneralChannel: async () => access,
    getGeneralChannelAccess: async (_organization: string, member: string, key: string) => member === membershipKey && key === channel.key ? access : null,
    listMessages: async () => [], listMessageReplies: async () => [], listThreadMessages: async () => [], listHistory: async () => [],
    getMessage: async (key: string) => messages.find((message) => message.key === key) ?? null,
    insertMessage: async (message: Message) => { messages.push(message); return message; },
    insertMentions: async (items: unknown[]) => { mentions.push(...items); },
    recordUserMentions: async (userKey: string, sourceIds: string[]) => {
      for (const sourceId of sourceIds) userMentionSchema.parse({ key: newId(), userKey, sourceId, count: 1, createdAt: now, updatedAt: now });
      usage.push(sourceIds);
    },
    recordUserReaction: async () => {},
    listUserReactions: async () => reactionUsage,
    deleteMessage: async () => true,
    editMessage: async (_channelKey: string, key: string, _membershipKey: string, content: string, editedAt: string) => {
      const message = messages.find((item) => item.key === key);
      if (!message) return null;
      Object.assign(message, { content, editedAt, updatedAt: editedAt });
      return message;
    },
    mutateReaction: async () => ({ active: true, changed: true }), createThread: async () => { throw new Error('unused'); }, getThread: async () => null, getThreadByRootMessage: async () => null,
    resolveThread: async () => null, archiveThread: async () => null, createPoll: async () => { throw new Error('unused'); }, getPollProjection: async () => null,
    votePoll: async () => ({ outcome: 'not_found' as const }), closePoll: async () => null,
  } as unknown as CommunicationRepository;
  return { service: new ChorusService(repository, () => now, async (event) => { events.push(event); }), repository, channel, access, messages, mentions, usage, reactionUsage, events };
}

describe('Chorus service', () => {
  test('provisions one shared general channel for an organization member', async () => {
    const f = fixture();
    const access = await f.service.generalChannel(actor);
    expect(access.channel).toMatchObject({ organizationKey, kind: 'group', name: 'general' });
    expect(access.mentions.map((mention) => mention.name)).toEqual(['everyone', 'Founder', 'Atlas', 'Metis']);
  });

  test('persists matching mentions and dispatches each mentioned orchestrator', async () => {
    const f = fixture();
    const result = await f.service.persistUserMessage(actor, f.channel.key, '@Atlas please review this');
    expect(f.mentions).toHaveLength(1);
    expect(f.usage).toEqual([[result.orchestrators[0]!.key]]);
    expect(result.orchestrators.map((orchestrator) => orchestrator.name)).toEqual(['Atlas']);
    await f.service.persistOrchestratorMessage(result.access, result.orchestrators[0]!, 'Reviewed.', undefined, result.message.key);
    expect(f.messages.map((message) => message.content)).toEqual(['@Atlas please review this', 'Reviewed.']);
  });

  test('does not persist an orchestrator response after its triggering message is removed', async () => {
    const f = fixture();
    const result = await f.service.persistUserMessage(actor, f.channel.key, '@Atlas review this');
    f.messages.splice(0);

    await expect(f.service.persistOrchestratorMessage(result.access, result.orchestrators[0]!, 'Reviewed.', undefined, undefined, result.message.key)).rejects.toMatchObject({ code: 'not_found' });
    expect(f.messages).toEqual([]);
  });

  test('persists recursive parent links and publishes organization message invalidations', async () => {
    const f = fixture();
    const root = await f.service.persistUserMessage(actor, f.channel.key, 'Root');
    const reply = await f.service.persistUserMessage(actor, f.channel.key, 'Reply', undefined, root.message.key);
    const nested = await f.service.persistUserMessage(actor, f.channel.key, 'Nested', undefined, reply.message.key);
    await f.service.deleteMessage(actor, f.channel.key, nested.message.key);

    expect(reply.message).toMatchObject({ replyToMessageKey: root.message.key });
    expect(nested.message).toMatchObject({ replyToMessageKey: reply.message.key });
    expect(f.events.map(({ slug }) => slug)).toEqual(['chorus.message.create', 'chorus.message.create', 'chorus.message.create', 'chorus.message.remove']);
    expect(f.events[0]).toMatchObject({ scopeId: scopeKey, data: { nodeType: 'messages', nodeKey: root.message.key } });
  });

  test('deletes a parent message with its replies through the repository cascade', async () => {
    const f = fixture();
    const root = await f.service.persistUserMessage(actor, f.channel.key, 'Root');
    await f.service.persistUserMessage(actor, f.channel.key, 'Reply', undefined, root.message.key);

    await f.service.deleteMessage(actor, f.channel.key, root.message.key);
    expect(f.events.map(({ slug }) => slug)).toEqual(['chorus.message.create', 'chorus.message.create', 'chorus.message.remove']);
  });

  test('edits an authored message and publishes an update invalidation', async () => {
    const f = fixture();
    const created = await f.service.persistUserMessage(actor, f.channel.key, 'Before');

    const edited = await f.service.editMessage(actor, f.channel.key, created.message.key, 'After');

    expect(edited).toMatchObject({ content: 'After', editedAt: now, updatedAt: now });
    expect(f.events.map(({ slug }) => slug)).toEqual(['chorus.message.create', 'chorus.message.update']);
  });

  test('rejects delete and edit mutations denied by repository authorization', async () => {
    const f = fixture();
    const created = await f.service.persistUserMessage(actor, f.channel.key, 'Protected');
    f.repository.deleteMessage = async () => false;
    f.repository.editMessage = async () => null;

    await expect(f.service.deleteMessage(actor, f.channel.key, created.message.key)).rejects.toMatchObject({ code: 'forbidden', message: 'message deletion denied' });
    await expect(f.service.editMessage(actor, f.channel.key, created.message.key, 'Forged')).rejects.toMatchObject({ code: 'forbidden', message: 'only the message author may edit this message' });
    expect(f.events.map(({ slug }) => slug)).toEqual(['chorus.message.create']);
  });

  test('matches orchestrator mentions without regard to case', async () => {
    const f = fixture();
    const result = await f.service.persistUserMessage(actor, f.channel.key, '@atlas hello');

    expect(result.orchestrators.map(({ name }) => name)).toEqual(['Atlas']);
  });

  test('persists a mention for a legacy opaque orchestrator participant', async () => {
    const f = fixture();
    f.access.mentions[2]!.participantKey = 'participant_themis';

    const result = await f.service.persistUserMessage(actor, f.channel.key, '@Atlas please review this');

    expect(f.mentions).toHaveLength(1);
    expect(result.orchestrators).toHaveLength(1);
  });

  test('completes the response flow for legacy opaque user and orchestrator identities', async () => {
    const f = fixture();
    f.access.viewerUserKey = 'user_founder';
    f.access.mentions[2]!.key = 'orchestrator_atlas';

    const result = await f.service.persistUserMessage(actor, f.channel.key, '@Atlas hello');
    await f.service.persistOrchestratorMessage(result.access, result.orchestrators[0]!, 'Hello from Atlas.', undefined, result.message.key);

    expect(f.usage).toEqual([['orchestrator_atlas']]);
    expect(f.messages.map(({ content }) => content)).toEqual(['@Atlas hello', 'Hello from Atlas.']);
  });

  test('expands @everyone to organization members without dispatching orchestrators', async () => {
    const f = fixture();
    const result = await f.service.persistUserMessage(actor, f.channel.key, '@everyone standup');
    expect(f.mentions).toHaveLength(1);
    expect(f.usage[0]).toEqual(['everyone', f.access.mentions[1]!.key]);
    expect(result.orchestrators).toEqual([]);
  });

  test('dispatches every explicitly mentioned orchestrator once and keeps everyone human-only', async () => {
    const f = fixture();
    const result = await f.service.persistUserMessage(actor, f.channel.key, '@everyone @metis and @Atlas and @METIS respond');
    expect(result.orchestrators.map(({ name }) => name)).toEqual(['Atlas', 'Metis']);
    expect(f.mentions).toHaveLength(3);
    expect(f.usage[0]).toEqual(['everyone', f.access.mentions[1]!.key, f.access.mentions[2]!.key, f.access.mentions[3]!.key]);
  });

  test('keeps hidden duplicate-label members in @everyone delivery', async () => {
    const f = fixture();
    f.access.mentions.push({ participantKey: newId(), type: 'user', key: newId(), name: 'Founder', mentionCount: 0 });
    await f.service.persistUserMessage(actor, f.channel.key, '@everyone standup');
    expect(f.mentions).toHaveLength(2);
  });

  test('lists the current user frequently used reactions', async () => {
    const f = fixture();
    expect(await f.service.frequentReactions(actor)).toEqual(f.reactionUsage);
  });

  test('keeps a successful reaction when secondary usage tracking fails', async () => {
    const f = fixture();
    const message = await f.service.persistUserMessage(actor, f.channel.key, 'React here');
    f.repository.recordUserReaction = async () => { throw new Error('usage unavailable'); };

    expect(await f.service.react(actor, f.channel.key, message.message.key, 'ack', 'add')).toEqual({ active: true });
  });
});
