import { db, withTransaction } from '@/lib/db/client';
import { newId } from '@/lib/ids';
import { channelSchema, type Channel } from '@/lib/db/channels.node';
import { channelParticipantSchema, type ChannelParticipant } from '@/lib/db/channel-participants.node';
import { messageSchema, type Message } from '@/lib/db/messages.node';
import { threadSchema, type Thread } from '@/lib/db/threads.node';
import { messageReactionSchema, type MessageReaction } from '@/lib/db/message-reactions.node';
import { pollSchema, type Poll } from '@/lib/db/polls.node';
import { pollOptionSchema, type PollOption } from '@/lib/db/poll-options.node';
import { pollVoteSchema, type PollVote } from '@/lib/db/poll-votes.node';
import { isArangoUniqueConstraintError, toArangoDoc, withArangoKey } from '@/lib/db/base';

export interface DirectOrchestratorCandidate {
  orchestrator: { key: string; name: string; role: string; skill: string };
  scopeKey: string;
  canChat: boolean;
  channel: Channel | null;
}

export interface DirectChannelAccess {
  channel: Channel;
  humanParticipant: ChannelParticipant;
  orchestratorParticipant: ChannelParticipant;
  orchestrator: { key: string; name: string; role: string; skill: string };
}

export interface ReactionAggregate { reaction: string; count: number; viewerReacted: boolean }
export interface PollProjection {
  key: string;
  question: string;
  allowMultiple: boolean;
  status: 'open' | 'closed';
  closedAt?: string | null;
  options: Array<{ key: string; text: string; position: number; voteCount: number; viewerVoted: boolean }>;
}
export interface MessageProjection {
  key: string;
  channelKey: string;
  threadKey?: string;
  replyToMessageKey?: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: { participantKey: string; type: 'user' | 'orchestrator'; key: string; name: string };
  reactions: ReactionAggregate[];
  thread: { key: string; status: Thread['status']; replyCount: number; lastReplyAt: string | null } | null;
  poll: PollProjection | null;
}

export class CommunicationConflictError extends Error {}

export interface CommunicationRepository {
  listDirectCandidates(organizationKey: string, membershipKey: string): Promise<DirectOrchestratorCandidate[]>;
  ensureDirectChannel(organizationKey: string, membershipKey: string, orchestratorKey: string): Promise<DirectChannelAccess | null>;
  getDirectChannelAccess(organizationKey: string, membershipKey: string, channelKey: string): Promise<DirectChannelAccess | null>;
  listMessages(channelKey: string, viewerParticipantKey: string, limit: number): Promise<MessageProjection[]>;
  listThreadMessages(channelKey: string, threadKey: string, rootMessageKey: string, viewerParticipantKey: string, limit: number): Promise<MessageProjection[]>;
  listHistory(channelKey: string, threadKey: string | undefined, excludeMessageKey: string | undefined, limit: number): Promise<Array<{ role: 'user' | 'assistant'; content: string }>>;
  getMessage(messageKey: string): Promise<Message | null>;
  insertMessage(message: Message): Promise<Message>;
  mutateReaction(input: { mode: 'add' | 'remove' | 'toggle'; channelKey: string; messageKey: string; participantKey: string; reaction: string; now: string }): Promise<{ active: boolean } | null>;
  createThread(thread: Thread): Promise<Thread>;
  getThread(threadKey: string): Promise<Thread | null>;
  resolveThread(threadKey: string, channelKey: string, now: string): Promise<Thread | null>;
  archiveThread(threadKey: string, channelKey: string, now: string): Promise<Thread | null>;
  createPoll(poll: Poll, options: PollOption[]): Promise<PollProjection>;
  getPollProjection(pollKey: string, channelKey: string, viewerParticipantKey: string): Promise<PollProjection | null>;
  votePoll(input: { vote: PollVote; allowMultiple: boolean }): Promise<{ outcome: 'ok'; poll: PollProjection } | { outcome: 'not_found' } | { outcome: 'conflict' }>;
  closePoll(pollKey: string, channelKey: string, participantKey: string, now: string): Promise<PollProjection | null>;
}

const parse = <T>(schema: { parse(value: unknown): T }, value: Record<string, unknown>) => schema.parse(withArangoKey(value));
const slugify = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

async function first<T>(query: string, bindVars: Record<string, unknown>): Promise<T | null> {
  const cursor = await db.query<T>(query, bindVars);
  return await cursor.next() ?? null;
}

function parseAccess(raw: Record<string, any>): DirectChannelAccess {
  return {
    channel: parse(channelSchema, raw.channel),
    humanParticipant: parse(channelParticipantSchema, raw.humanParticipant),
    orchestratorParticipant: parse(channelParticipantSchema, raw.orchestratorParticipant),
    orchestrator: raw.orchestrator,
  };
}

async function projectPoll(pollKey: string, channelKey: string, viewerParticipantKey: string): Promise<PollProjection | null> {
  return first<PollProjection>(`
    FOR poll IN polls FILTER poll._key == @pollKey && poll.channelKey == @channelKey
      RETURN { key: poll._key, question: poll.question, allowMultiple: poll.allowMultiple, status: poll.status, closedAt: poll.closedAt,
        options: (FOR option IN pollOptions FILTER option.pollKey == poll._key SORT option.position ASC
          LET votes = (FOR vote IN pollVotes FILTER vote.optionKey == option._key RETURN vote)
          RETURN { key: option._key, text: option.text, position: option.position, voteCount: LENGTH(votes), viewerVoted: LENGTH(FOR vote IN votes FILTER vote.participantKey == @viewerParticipantKey LIMIT 1 RETURN 1) > 0 }) }
  `, { pollKey, channelKey, viewerParticipantKey });
}

export const arangoCommunicationRepository: CommunicationRepository = {
  async listDirectCandidates(organizationKey, membershipKey) {
    const cursor = await db.query<Record<string, any>>(`
      FOR orchestrator IN orchestrators
        LET slug = LOWER(REGEX_REPLACE(orchestrator.name, "[^a-zA-Z0-9]+", "-", true))
        FOR scope IN scopes FILTER scope.organizationKey == @organizationKey && scope.slug == slug && scope.deletedAt == null
          LET allowed = LENGTH(FOR member IN scopeMembers FILTER member.scopeKey == scope._key && member.userOrganizationKey == @membershipKey && member.status == "active" LIMIT 1 RETURN 1) > 0
          LET channel = FIRST(FOR item IN channels FILTER item.kind == "direct" && item.directUserOrganizationKey == @membershipKey && item.directOrchestratorKey == orchestrator._key && item.scopeKey == scope._key && item.archivedAt == null LIMIT 1 RETURN item)
          SORT orchestrator.name ASC
          RETURN { orchestrator: KEEP(orchestrator, "_key", "name", "role", "skill"), scopeKey: scope._key, allowed, channel }
    `, { organizationKey, membershipKey });
    return (await cursor.all()).map((row) => ({
      orchestrator: { key: row.orchestrator._key, name: row.orchestrator.name, role: row.orchestrator.role, skill: row.orchestrator.skill },
      scopeKey: row.scopeKey,
      canChat: row.allowed,
      channel: row.allowed && row.channel ? parse(channelSchema, row.channel) : null,
    }));
  },

  async ensureDirectChannel(organizationKey, membershipKey, orchestratorKey) {
    return withTransaction({
      read: ['userOrganizations', 'orchestrators', 'scopes', 'scopeMembers'],
      write: ['channels', 'channelParticipants'],
    }, async (trx) => {
      const accessCursor = await trx.query<Record<string, any>>(`
        LET membership = DOCUMENT(userOrganizations, @membershipKey)
        LET orchestrator = DOCUMENT(orchestrators, @orchestratorKey)
        LET slug = orchestrator == null ? null : LOWER(REGEX_REPLACE(orchestrator.name, "[^a-zA-Z0-9]+", "-", true))
        LET scope = FIRST(FOR item IN scopes FILTER item.organizationKey == @organizationKey && item.slug == slug && item.deletedAt == null LIMIT 1 RETURN item)
        LET allowed = membership != null && membership.organizationId == @organizationKey && membership.status == "active" && scope != null && LENGTH(FOR member IN scopeMembers FILTER member.scopeKey == scope._key && member.userOrganizationKey == @membershipKey && member.status == "active" LIMIT 1 RETURN 1) > 0
        FILTER allowed
        RETURN { scopeKey: scope._key, name: orchestrator.name, orchestrator: { key: orchestrator._key, name: orchestrator.name, role: orchestrator.role, skill: orchestrator.skill } }
      `, { organizationKey, membershipKey, orchestratorKey });
      const allowed = await accessCursor.next();
      if (!allowed) return null;
      const now = new Date().toISOString();
      const channelDocument = toArangoDoc(channelSchema.parse({ key: newId(), scopeKey: allowed.scopeKey, kind: 'direct', directUserOrganizationKey: membershipKey, directOrchestratorKey: orchestratorKey, name: allowed.name, position: 0, createdAt: now, updatedAt: now }));
      const channelCursor = await trx.query<Record<string, unknown>>(`
        UPSERT { kind: "direct", directUserOrganizationKey: @membershipKey, directOrchestratorKey: @orchestratorKey, scopeKey: @scopeKey }
          INSERT @document UPDATE { archivedAt: null, updatedAt: @now } IN channels OPTIONS { keepNull: false } RETURN NEW
      `, { membershipKey, orchestratorKey, scopeKey: allowed.scopeKey, document: channelDocument, now });
      const channelRaw = (await channelCursor.next())!;
      const channel = parse(channelSchema, channelRaw);
      const participant = async (identity: Record<string, string>, document: ChannelParticipant) => {
        const cursor = await trx.query<Record<string, unknown>>('UPSERT @identity INSERT @document UPDATE { scopeKey: @scopeKey, updatedAt: @now } IN channelParticipants RETURN NEW', { identity, document: toArangoDoc(document), scopeKey: allowed.scopeKey, now });
        return parse(channelParticipantSchema, (await cursor.next())!);
      };
      const human = await participant({ channelKey: channel.key, userOrganizationKey: membershipKey }, channelParticipantSchema.parse({ key: newId(), scopeKey: allowed.scopeKey, channelKey: channel.key, userOrganizationKey: membershipKey, joinedAt: now, createdAt: now, updatedAt: now }));
      const agent = await participant({ channelKey: channel.key, orchestratorKey }, channelParticipantSchema.parse({ key: newId(), scopeKey: allowed.scopeKey, channelKey: channel.key, orchestratorKey, joinedAt: now, createdAt: now, updatedAt: now }));
      await trx.query('FOR participant IN channelParticipants FILTER participant.channelKey == @channelKey && participant._key NOT IN @participantKeys REMOVE participant IN channelParticipants', { channelKey: channel.key, participantKeys: [human.key, agent.key] });
      return { channel, humanParticipant: human, orchestratorParticipant: agent, orchestrator: allowed.orchestrator };
    });
  },

  async getDirectChannelAccess(organizationKey, membershipKey, channelKey) {
    const raw = await first<Record<string, any>>(`
      LET channel = DOCUMENT(channels, @channelKey)
      LET membership = DOCUMENT(userOrganizations, @membershipKey)
      LET scope = channel == null ? null : DOCUMENT(scopes, channel.scopeKey)
      LET orchestrator = channel == null ? null : DOCUMENT(orchestrators, channel.directOrchestratorKey)
      LET human = FIRST(FOR participant IN channelParticipants FILTER participant.channelKey == @channelKey && participant.userOrganizationKey == @membershipKey LIMIT 1 RETURN participant)
      LET agent = FIRST(FOR participant IN channelParticipants FILTER participant.channelKey == @channelKey && participant.orchestratorKey == channel.directOrchestratorKey LIMIT 1 RETURN participant)
      LET allowed = channel != null && channel.kind == "direct" && channel.archivedAt == null && channel.directUserOrganizationKey == @membershipKey && membership != null && membership.organizationId == @organizationKey && membership.status == "active" && scope != null && scope.organizationKey == @organizationKey && LENGTH(FOR member IN scopeMembers FILTER member.scopeKey == scope._key && member.userOrganizationKey == @membershipKey && member.status == "active" LIMIT 1 RETURN 1) > 0
      FILTER allowed && human != null && agent != null && orchestrator != null
      RETURN { channel, humanParticipant: human, orchestratorParticipant: agent, orchestrator: { key: orchestrator._key, name: orchestrator.name, role: orchestrator.role, skill: orchestrator.skill } }
    `, { organizationKey, membershipKey, channelKey });
    return raw ? parseAccess(raw) : null;
  },

  async listMessages(channelKey, viewerParticipantKey, limit) {
    const cursor = await db.query<MessageProjection>(`
      FOR message IN messages FILTER message.channelKey == @channelKey && message.deletedAt == null && message.threadKey == null
        SORT message.createdAt DESC, message._key DESC LIMIT @limit
        LET participant = DOCUMENT(channelParticipants, message.authorParticipantKey)
        LET membership = participant.userOrganizationKey == null ? null : DOCUMENT(userOrganizations, participant.userOrganizationKey)
        LET user = membership == null ? null : DOCUMENT(users, membership.userId)
        LET orchestrator = participant.orchestratorKey == null ? null : DOCUMENT(orchestrators, participant.orchestratorKey)
        LET thread = FIRST(FOR item IN threads FILTER item.rootMessageKey == message._key LIMIT 1 RETURN item)
        LET replies = thread == null ? [] : (FOR reply IN messages FILTER reply.threadKey == thread._key SORT reply.createdAt DESC RETURN reply.createdAt)
        LET poll = FIRST(FOR item IN polls FILTER item.messageKey == message._key LIMIT 1 RETURN item)
        RETURN { key: message._key, channelKey: message.channelKey, threadKey: message.threadKey, replyToMessageKey: message.replyToMessageKey, content: message.content, createdAt: message.createdAt, updatedAt: message.updatedAt,
          author: { participantKey: participant._key, type: participant.userOrganizationKey == null ? "orchestrator" : "user", key: participant.userOrganizationKey == null ? orchestrator._key : user._key, name: participant.userOrganizationKey == null ? orchestrator.name : NOT_NULL(user.name, user.alias, user.email, "Member") },
          reactions: (FOR reaction IN messageReactions FILTER reaction.messageKey == message._key COLLECT value = reaction.reaction INTO rows RETURN { reaction: value, count: LENGTH(rows), viewerReacted: LENGTH(FOR row IN rows FILTER row.reaction.participantKey == @viewerParticipantKey LIMIT 1 RETURN 1) > 0 }),
          thread: thread == null ? null : { key: thread._key, status: thread.status, replyCount: LENGTH(replies), lastReplyAt: FIRST(replies) },
          poll: poll == null ? null : { key: poll._key, question: poll.question, allowMultiple: poll.allowMultiple, status: poll.status, closedAt: poll.closedAt, options: (FOR option IN pollOptions FILTER option.pollKey == poll._key SORT option.position ASC LET votes = (FOR vote IN pollVotes FILTER vote.optionKey == option._key RETURN vote) RETURN { key: option._key, text: option.text, position: option.position, voteCount: LENGTH(votes), viewerVoted: LENGTH(FOR vote IN votes FILTER vote.participantKey == @viewerParticipantKey LIMIT 1 RETURN 1) > 0 }) } }
    `, { channelKey, viewerParticipantKey, limit });
    return (await cursor.all()).reverse();
  },

  async listThreadMessages(channelKey, threadKey, rootMessageKey, viewerParticipantKey, limit) {
    const cursor = await db.query<MessageProjection>(`
      FOR message IN messages
        FILTER message.channelKey == @channelKey && message.deletedAt == null
        FILTER message._key == @rootMessageKey || message.threadKey == @threadKey
        SORT message.createdAt DESC, message._key DESC LIMIT @limit
        LET participant = DOCUMENT(channelParticipants, message.authorParticipantKey)
        LET membership = participant.userOrganizationKey == null ? null : DOCUMENT(userOrganizations, participant.userOrganizationKey)
        LET user = membership == null ? null : DOCUMENT(users, membership.userId)
        LET orchestrator = participant.orchestratorKey == null ? null : DOCUMENT(orchestrators, participant.orchestratorKey)
        RETURN { key: message._key, channelKey: message.channelKey, threadKey: message.threadKey, replyToMessageKey: message.replyToMessageKey, content: message.content, createdAt: message.createdAt, updatedAt: message.updatedAt,
          author: { participantKey: participant._key, type: participant.userOrganizationKey == null ? "orchestrator" : "user", key: participant.userOrganizationKey == null ? orchestrator._key : user._key, name: participant.userOrganizationKey == null ? orchestrator.name : NOT_NULL(user.name, user.alias, user.email, "Member") }, reactions: [], thread: null, poll: null }
    `, { channelKey, threadKey, rootMessageKey, viewerParticipantKey, limit });
    return (await cursor.all()).reverse();
  },

  async listHistory(channelKey, threadKey, excludeMessageKey, limit) {
    const cursor = await db.query<{ role: 'user' | 'assistant'; content: string }>(`
      LET rootMessageKey = @threadKey == null ? null : FIRST(FOR thread IN threads FILTER thread._key == @threadKey && thread.channelKey == @channelKey RETURN thread.rootMessageKey)
      FOR message IN messages FILTER message.channelKey == @channelKey && message.deletedAt == null && message._key != @excludeMessageKey
        FILTER @threadKey == null ? message.threadKey == null : (message.threadKey == @threadKey || message._key == rootMessageKey)
        SORT message.createdAt DESC, message._key DESC LIMIT @limit
        LET participant = DOCUMENT(channelParticipants, message.authorParticipantKey)
        RETURN { role: participant.orchestratorKey == null ? "user" : "assistant", content: message.content }
    `, { channelKey, threadKey: threadKey ?? null, excludeMessageKey: excludeMessageKey ?? null, limit });
    return (await cursor.all()).reverse();
  },

  async getMessage(messageKey) {
    const raw = await first<Record<string, unknown>>('FOR message IN messages FILTER message._key == @messageKey && message.deletedAt == null LIMIT 1 RETURN message', { messageKey });
    return raw ? parse(messageSchema, raw) : null;
  },

  async insertMessage(message) {
    const result = await db.collection('messages').save(toArangoDoc(message), { returnNew: true });
    return parse(messageSchema, result.new as Record<string, unknown>);
  },

  async mutateReaction(input) {
    return withTransaction({ read: ['messages', 'channelParticipants'], write: ['messageReactions'] }, async (trx) => {
      const cursor = await trx.query<{ scopeKey: string; existingKey: string | null }>(`
        LET message = DOCUMENT(messages, @messageKey)
        LET participant = DOCUMENT(channelParticipants, @participantKey)
        FILTER message != null && message.deletedAt == null && participant != null && message.channelKey == @channelKey && participant.channelKey == @channelKey
        LET existing = FIRST(FOR reaction IN messageReactions FILTER reaction.messageKey == @messageKey && reaction.participantKey == @participantKey && reaction.reaction == @reaction LIMIT 1 RETURN reaction)
        RETURN { scopeKey: message.scopeKey, existingKey: existing == null ? null : existing._key }
      `, input);
      const validated = await cursor.next();
      if (!validated) return null;
      const remove = input.mode === 'remove' || (input.mode === 'toggle' && validated.existingKey !== null);
      if (remove && validated.existingKey) await trx.query('REMOVE @key IN messageReactions', { key: validated.existingKey });
      if (!remove && !validated.existingKey) await trx.query('INSERT @document INTO messageReactions', { document: toArangoDoc(messageReactionSchema.parse({ key: newId(), scopeKey: validated.scopeKey, channelKey: input.channelKey, messageKey: input.messageKey, participantKey: input.participantKey, reaction: input.reaction, createdAt: input.now, updatedAt: input.now })) });
      return { active: !remove };
    });
  },

  async createThread(thread) {
    try {
      const result = await db.collection('threads').save(toArangoDoc(thread), { returnNew: true });
      return parse(threadSchema, result.new as Record<string, unknown>);
    } catch (error) {
      if (isArangoUniqueConstraintError(error)) throw new CommunicationConflictError('thread already exists');
      throw error;
    }
  },
  async getThread(threadKey) {
    const raw = await first<Record<string, unknown>>('FOR thread IN threads FILTER thread._key == @threadKey LIMIT 1 RETURN thread', { threadKey });
    return raw ? parse(threadSchema, raw) : null;
  },
  async resolveThread(threadKey, channelKey, now) {
    const raw = await first<Record<string, unknown>>('FOR thread IN threads FILTER thread._key == @threadKey && thread.channelKey == @channelKey UPDATE thread WITH { status: "resolved", updatedAt: @now } IN threads RETURN NEW', { threadKey, channelKey, now });
    return raw ? parse(threadSchema, raw) : null;
  },
  async archiveThread(threadKey, channelKey, now) {
    const raw = await first<Record<string, unknown>>('FOR thread IN threads FILTER thread._key == @threadKey && thread.channelKey == @channelKey UPDATE thread WITH { status: "archived", updatedAt: @now } IN threads RETURN NEW', { threadKey, channelKey, now });
    return raw ? parse(threadSchema, raw) : null;
  },

  async createPoll(poll, options) {
    try {
      await withTransaction(['polls', 'pollOptions'], async (trx) => {
        await trx.query('INSERT @poll INTO polls', { poll: toArangoDoc(poll) });
        await trx.query('FOR option IN @options INSERT option INTO pollOptions', { options: options.map((option) => toArangoDoc(option)) });
      });
    } catch (error) {
      if (isArangoUniqueConstraintError(error)) throw new CommunicationConflictError('poll already exists');
      throw error;
    }
    return (await projectPoll(poll.key, poll.channelKey, poll.creatorParticipantKey))!;
  },
  getPollProjection: projectPoll,
  async votePoll({ vote, allowMultiple }) {
    const outcome = await withTransaction({ read: ['pollOptions'], write: ['polls', 'pollVotes'] }, async (trx) => {
      const targetCursor = await trx.query<{ pollStatus: string; optionExists: boolean }>('LET poll = DOCUMENT(polls, @pollKey) LET option = DOCUMENT(pollOptions, @optionKey) FILTER poll != null && poll.channelKey == @channelKey RETURN { pollStatus: poll.status, optionExists: option != null && option.pollKey == poll._key }', vote);
      const target = await targetCursor.next();
      if (!target || !target.optionExists) return 'not_found' as const;
      if (target.pollStatus !== 'open') return 'conflict' as const;
      const selectedCursor = await trx.query<{ key: string }>('FOR old IN pollVotes FILTER old.pollKey == @pollKey && old.participantKey == @participantKey && old.optionKey == @optionKey LIMIT 1 RETURN { key: old._key }', vote);
      const selected = await selectedCursor.next();
      if (allowMultiple && selected) {
        await trx.query('REMOVE @key IN pollVotes', { key: selected.key });
      } else {
        if (!allowMultiple) await trx.query('FOR old IN pollVotes FILTER old.pollKey == @pollKey && old.participantKey == @participantKey REMOVE old IN pollVotes', vote);
        if (!allowMultiple || !selected) await trx.query('INSERT @vote INTO pollVotes', { vote: toArangoDoc(vote) });
      }
      return 'ok' as const;
    });
    if (outcome !== 'ok') return { outcome };
    const poll = await projectPoll(vote.pollKey, vote.channelKey, vote.participantKey);
    return poll ? { outcome: 'ok', poll } : { outcome: 'not_found' };
  },
  async closePoll(pollKey, channelKey, participantKey, now) {
    const raw = await first<Record<string, unknown>>('FOR poll IN polls FILTER poll._key == @pollKey && poll.channelKey == @channelKey && poll.creatorParticipantKey == @participantKey UPDATE poll WITH { status: "closed", closedAt: @now, updatedAt: @now } IN polls RETURN NEW', { pollKey, channelKey, participantKey, now });
    return raw ? projectPoll(pollKey, channelKey, participantKey) : null;
  },
};

export { slugify };
