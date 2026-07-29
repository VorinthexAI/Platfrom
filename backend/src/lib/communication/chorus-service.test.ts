import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { channelSchema } from '@/lib/db/channels.node';
import { channelParticipantSchema } from '@/lib/db/channel-participants.node';
import type { Message } from '@/lib/db/messages.node';
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
  const reactionUsage = [{ reaction: '🔥', count: 4 }, { reaction: '✅', count: 2 }];
  const repository = {
    ensureGeneralChannel: async () => access,
    getGeneralChannelAccess: async (_organization: string, member: string, key: string) => member === membershipKey && key === channel.key ? access : null,
    listMessages: async () => [], clearChannel: async () => 0, listThreadMessages: async () => [], listHistory: async () => [],
    getMessage: async (key: string) => messages.find((message) => message.key === key) ?? null,
    insertMessage: async (message: Message) => { messages.push(message); return message; },
    insertMentions: async (items: unknown[]) => { mentions.push(...items); },
    recordUserMentions: async (_userKey: string, sourceIds: string[]) => { usage.push(sourceIds); },
    listUserReactions: async () => reactionUsage,
    mutateReaction: async () => ({ active: true }), createThread: async () => { throw new Error('unused'); }, getThread: async () => null,
    resolveThread: async () => null, archiveThread: async () => null, createPoll: async () => { throw new Error('unused'); }, getPollProjection: async () => null,
    votePoll: async () => ({ outcome: 'not_found' as const }), closePoll: async () => null,
  } as unknown as CommunicationRepository;
  return { service: new ChorusService(repository, () => now), channel, access, messages, mentions, usage, reactionUsage };
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
});
