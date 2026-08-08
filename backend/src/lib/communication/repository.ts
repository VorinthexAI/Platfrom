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
import { messageMentionSchema, type MessageMention } from '@/lib/db/message-mentions.node';
import { userMentionSchema } from '@/lib/db/user-mentions.node';
import { userReactionSchema } from '@/lib/db/user-reactions.node';
import { isArangoUniqueConstraintError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { CANONICAL_ORCHESTRATOR_NAMES } from '@/lib/orchestrators/roster';
import { embeddingMetadata, embedText } from '@/lib/embeddings';

export interface MentionCandidate {
  participantKey: string;
  type: 'user' | 'orchestrator' | 'everyone';
  key: string;
  name: string;
  role?: string;
  skill?: string;
  mentionCount: number;
}

export interface GeneralChannelAccess {
  channel: Channel;
  humanParticipant: ChannelParticipant;
  viewerUserKey: string;
  mentions: MentionCandidate[];
}

export interface ReactionAggregate { reaction: string; count: number; viewerReacted: boolean }
export interface UserReactionUsage { reaction: string; count: number }
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
  editedAt?: string;
  createdAt: string;
  updatedAt: string;
  author: { participantKey: string; type: 'user' | 'orchestrator'; key: string; name: string };
  reactions: ReactionAggregate[];
  replies: { count: number };
  poll: PollProjection | null;
  canEdit: boolean;
  canDelete: boolean;
}
export interface ThreadProjection { key: string; channelKey: string; title: string; rootMessageKey: string; rootContent: string; status: Thread['status']; replyCount: number; updatedAt: string }

export class CommunicationConflictError extends Error {}

export interface CommunicationRepository {
  ensureGeneralChannel(organizationKey: string, membershipKey: string): Promise<GeneralChannelAccess | null>;
  getGeneralChannelAccess(organizationKey: string, membershipKey: string, channelKey: string): Promise<GeneralChannelAccess | null>;
  listMessages(channelKey: string, viewerParticipantKey: string, limit: number): Promise<MessageProjection[]>;
  listMessageReplies(channelKey: string, parentMessageKey: string, viewerParticipantKey: string, limit: number): Promise<MessageProjection[]>;
  deleteMessage(channelKey: string, messageKey: string, membershipKey: string, now: string): Promise<boolean>;
  editMessage(channelKey: string, messageKey: string, membershipKey: string, content: string, now: string): Promise<Message | null>;
  listThreadMessages(channelKey: string, threadKey: string, rootMessageKey: string, viewerParticipantKey: string, limit: number): Promise<MessageProjection[]>;
  listThreads(channelKey: string): Promise<ThreadProjection[]>;
  listHistory(channelKey: string, threadKey: string | undefined, excludeMessageKey: string | undefined, limit: number): Promise<Array<{ role: 'user' | 'assistant'; content: string }>>;
  getMessage(messageKey: string): Promise<Message | null>;
  getThreadByRootMessage(rootMessageKey: string): Promise<Thread | null>;
  insertMessage(message: Message): Promise<Message>;
  upsertMessage(message: Message): Promise<Message>;
  insertMentions(mentions: MessageMention[]): Promise<void>;
  recordUserMentions(userKey: string, sourceIds: string[], now: string): Promise<void>;
  recordUserReaction(userKey: string, reactionSlug: string, now: string): Promise<void>;
  listUserReactions(userKey: string, limit: number): Promise<UserReactionUsage[]>;
  mutateReaction(input: { mode: 'add' | 'remove' | 'toggle'; channelKey: string; messageKey: string; participantKey: string; reaction: string; now: string }): Promise<{ active: boolean; changed: boolean } | null>;
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

function parseAccess(raw: Record<string, any>): GeneralChannelAccess {
  return {
    channel: parse(channelSchema, raw.channel),
    humanParticipant: parse(channelParticipantSchema, raw.humanParticipant),
    viewerUserKey: raw.viewerUserKey,
    mentions: raw.mentions,
  };
}

function normalizeMessageProjection(message: MessageProjection): MessageProjection {
  const { threadKey, replyToMessageKey, editedAt, ...projection } = message;
  return {
    ...projection,
    ...(threadKey ? { threadKey } : {}),
    ...(replyToMessageKey ? { replyToMessageKey } : {}),
    ...(editedAt ? { editedAt } : {}),
  };
}

export function buildUserMentionDocuments(userKey: string, sourceIds: string[], now: string) {
  return [...new Set(sourceIds)].map((sourceId) => toArangoDoc(userMentionSchema.parse({
    key: newId(),
    userKey,
    sourceId,
    count: 1,
    createdAt: now,
    updatedAt: now,
  })));
}

async function projectPoll(pollKey: string, channelKey: string, viewerParticipantKey: string): Promise<PollProjection | null> {
  return first<PollProjection>(`
    FOR poll IN polls FILTER poll._key == @pollKey && poll.channelKey == @channelKey
      LET message = DOCUMENT(messages, poll.messageKey)
      FILTER message != null && message.deletedAt == null && message.channelKey == @channelKey
      RETURN { key: poll._key, question: poll.question, allowMultiple: poll.allowMultiple, status: poll.status, closedAt: poll.closedAt,
        options: (FOR option IN pollOptions FILTER option.pollKey == poll._key SORT option.position ASC
          LET votes = (FOR vote IN pollVotes FILTER vote.optionKey == option._key RETURN vote)
          RETURN { key: option._key, text: option.text, position: option.position, voteCount: LENGTH(votes), viewerVoted: LENGTH(FOR vote IN votes FILTER vote.participantKey == @viewerParticipantKey LIMIT 1 RETURN 1) > 0 }) }
  `, { pollKey, channelKey, viewerParticipantKey });
}

async function updateMessageIndex(message: Message, patch: Record<string, unknown>): Promise<void> {
  await db.query(`
    FOR current IN messages
      FILTER current._key == @messageKey && current.deletedAt == null && current.updatedAt == @updatedAt && current.content == @content
      UPDATE current WITH @patch IN messages
  `, { messageKey: message.key, updatedAt: message.updatedAt, content: message.content, patch });
}

async function indexMessage(message: Message): Promise<void> {
  try {
    const embedding = await embedText({ text: message.content });
    if (!embedding.length) {
      await updateMessageIndex(message, { embeddingState: 'failed' });
      return;
    }
    await updateMessageIndex(message, {
      embedding,
      embeddingState: 'ready',
      embeddedAt: new Date().toISOString(),
      ...embeddingMetadata(),
    });
  } catch (error) {
    console.error('message embedding failed', { messageKey: message.key, error });
    await updateMessageIndex(message, { embeddingState: 'failed' }).catch(() => {});
  }
}

export const arangoCommunicationRepository: CommunicationRepository = {
  async ensureGeneralChannel(organizationKey, membershipKey) {
    return withTransaction({
      read: ['userOrganizations', 'orchestrators', 'scopes', 'users'],
      write: ['channels', 'channelParticipants'],
    }, async (trx) => {
      const accessCursor = await trx.query<Record<string, any>>(`
        LET membership = DOCUMENT(userOrganizations, @membershipKey)
        LET scope = FIRST(FOR item IN scopes FILTER item.organizationKey == @organizationKey && item.slug == "hq" && item.deletedAt == null LIMIT 1 RETURN item)
        LET allowed = membership != null && membership.organizationId == @organizationKey && membership.status == "active" && scope != null
        FILTER allowed
        RETURN { scopeKey: scope._key, position: scope.position }
      `, { organizationKey, membershipKey });
      const allowed = await accessCursor.next();
      if (!allowed) return null;
      const now = new Date().toISOString();
      const channelDocument = toArangoDoc(channelSchema.parse({ key: newId(), organizationKey, scopeKey: allowed.scopeKey, name: 'general', description: 'Organization-wide conversation', position: 0, createdAt: now, updatedAt: now }));
      const channelCursor = await trx.query<Record<string, unknown>>(`
        UPSERT { organizationKey: @organizationKey, kind: "group", name: "general" }
          INSERT @document UPDATE { scopeKey: @scopeKey, archivedAt: null, updatedAt: @now } IN channels OPTIONS { keepNull: false } RETURN NEW
      `, { organizationKey, scopeKey: allowed.scopeKey, document: channelDocument, now });
      const channelRaw = (await channelCursor.next())!;
      const channel = parse(channelSchema, channelRaw);
      const participant = async (identity: Record<string, string>, document: ChannelParticipant) => {
        const cursor = await trx.query<Record<string, unknown>>('UPSERT @identity INSERT @document UPDATE { scopeKey: @scopeKey, updatedAt: @now } IN channelParticipants RETURN NEW', { identity, document: toArangoDoc(document), scopeKey: allowed.scopeKey, now });
        return parse(channelParticipantSchema, (await cursor.next())!);
      };
      const human = await participant({ channelKey: channel.key, userOrganizationKey: membershipKey }, channelParticipantSchema.parse({ key: newId(), scopeKey: allowed.scopeKey, channelKey: channel.key, userOrganizationKey: membershipKey, joinedAt: now, createdAt: now, updatedAt: now }));
       const viewer = await trx.query<{ userKey: string }>('LET membership = DOCUMENT(userOrganizations, @membershipKey) RETURN { userKey: membership.userId }', { membershipKey });
       const viewerUserKey = (await viewer.next())!.userKey;
       const candidates = await trx.query<Record<string, any>>(`
        LET people = (FOR memberLink IN userOrganizations FILTER memberLink.organizationId == @organizationKey && memberLink.status == "active" && memberLink.userId != @viewerUserKey COLLECT userKey = memberLink.userId INTO memberships = memberLink SORT userKey ASC LET member = FIRST(memberships) LET user = DOCUMENT(users, userKey) FILTER user != null LET participant = FIRST(FOR item IN channelParticipants FILTER item.channelKey == @channelKey && item.userOrganizationKey == member._key LIMIT 1 RETURN item) RETURN { membershipKey: member._key, participantKey: participant == null ? null : participant._key, type: "user", key: user._key, name: TRIM(NOT_NULL(user.name, user.alias, user.email, "Member")), mentionCount: 0 })
        LET agents = (FOR orchestrator IN orchestrators FILTER orchestrator.name IN @orchestratorNames LET canonicalPosition = POSITION(@orchestratorNames, orchestrator.name, true) SORT canonicalPosition ASC, orchestrator._key ASC RETURN { participantKey: FIRST(FOR participant IN channelParticipants FILTER participant.channelKey == @channelKey && participant.orchestratorKey == orchestrator._key LIMIT 1 RETURN participant._key), type: "orchestrator", key: orchestrator._key, name: TRIM(orchestrator.name), role: orchestrator.role, skill: orchestrator.skill, mentionCount: 0 })
        RETURN { people, agents }
      `, { organizationKey, channelKey: channel.key, orchestratorNames: CANONICAL_ORCHESTRATOR_NAMES, viewerUserKey });
      const identities = await candidates.next() ?? { people: [], agents: [] };
      for (const person of identities.people) {
        if (person.participantKey) continue;
        const created = await participant({ channelKey: channel.key, userOrganizationKey: person.membershipKey }, channelParticipantSchema.parse({ key: newId(), scopeKey: allowed.scopeKey, channelKey: channel.key, userOrganizationKey: person.membershipKey, joinedAt: now, createdAt: now, updatedAt: now }));
        person.participantKey = created.key;
      }
      for (const agent of identities.agents) {
        if (agent.participantKey) continue;
        const created = await participant({ channelKey: channel.key, orchestratorKey: agent.key }, channelParticipantSchema.parse({ key: newId(), scopeKey: allowed.scopeKey, channelKey: channel.key, orchestratorKey: agent.key, joinedAt: now, createdAt: now, updatedAt: now }));
        agent.participantKey = created.key;
      }
      return { channel, humanParticipant: human, viewerUserKey, mentions: [{ participantKey: 'everyone', type: 'everyone', key: 'everyone', name: 'everyone', mentionCount: 0 }, ...identities.people.map(({ membershipKey: _membershipKey, ...person }: Record<string, any>) => person), ...identities.agents] };
    });
  },

  async getGeneralChannelAccess(organizationKey, membershipKey, channelKey) {
    const raw = await first<Record<string, any>>(`
      LET channel = DOCUMENT(channels, @channelKey)
      LET membership = DOCUMENT(userOrganizations, @membershipKey)
      LET human = FIRST(FOR participant IN channelParticipants FILTER participant.channelKey == @channelKey && participant.userOrganizationKey == @membershipKey LIMIT 1 RETURN participant)
      LET allowed = channel != null && channel.kind == "group" && channel.name == "general" && channel.organizationKey == @organizationKey && channel.archivedAt == null && membership != null && membership.organizationId == @organizationKey && membership.status == "active"
      FILTER allowed && human != null
      LET viewerUserKey = membership.userId
      LET people = (FOR memberLink IN userOrganizations FILTER memberLink.organizationId == @organizationKey && memberLink.status == "active" && memberLink.userId != viewerUserKey COLLECT userKey = memberLink.userId INTO memberships = memberLink SORT userKey ASC LET member = FIRST(memberships) LET user = DOCUMENT(users, userKey) FILTER user != null LET participant = FIRST(FOR item IN channelParticipants FILTER item.channelKey == @channelKey && item.userOrganizationKey == member._key LIMIT 1 RETURN item) FILTER participant != null LET usage = FIRST(FOR item IN userMentions FILTER item.userKey == viewerUserKey && item.sourceId == user._key LIMIT 1 RETURN item.count) RETURN { participantKey: participant._key, type: "user", key: user._key, name: TRIM(NOT_NULL(user.name, user.alias, user.email, "Member")), mentionCount: NOT_NULL(usage, 0) })
      LET agents = (FOR orchestrator IN orchestrators FILTER orchestrator.name IN @orchestratorNames LET participant = FIRST(FOR item IN channelParticipants FILTER item.channelKey == @channelKey && item.orchestratorKey == orchestrator._key LIMIT 1 RETURN item) FILTER participant != null LET usage = FIRST(FOR item IN userMentions FILTER item.userKey == viewerUserKey && item.sourceId == orchestrator._key LIMIT 1 RETURN item.count) LET canonicalPosition = POSITION(@orchestratorNames, orchestrator.name, true) SORT canonicalPosition ASC, orchestrator._key ASC RETURN { participantKey: participant._key, type: "orchestrator", key: orchestrator._key, name: TRIM(orchestrator.name), role: orchestrator.role, skill: orchestrator.skill, mentionCount: NOT_NULL(usage, 0) })
      LET everyoneUsage = FIRST(FOR item IN userMentions FILTER item.userKey == viewerUserKey && item.sourceId == "everyone" LIMIT 1 RETURN item.count)
      RETURN { channel, humanParticipant: human, viewerUserKey, mentions: APPEND([{ participantKey: "everyone", type: "everyone", key: "everyone", name: "everyone", mentionCount: NOT_NULL(everyoneUsage, 0) }], APPEND(people, agents)) }
    `, { organizationKey, membershipKey, channelKey, orchestratorNames: CANONICAL_ORCHESTRATOR_NAMES });
    return raw ? parseAccess(raw) : null;
  },

  async listMessages(channelKey, viewerParticipantKey, limit) {
    const cursor = await db.query<MessageProjection>(`
      FOR message IN messages FILTER message.channelKey == @channelKey && message.deletedAt == null && message.threadKey == null && message.replyToMessageKey == null
        SORT message.createdAt DESC, message._key DESC LIMIT @limit
        LET participant = DOCUMENT(channelParticipants, message.authorParticipantKey)
        LET membership = participant.userOrganizationKey == null ? null : DOCUMENT(userOrganizations, participant.userOrganizationKey)
        LET user = membership == null ? null : DOCUMENT(users, membership.userId)
        LET orchestrator = participant.orchestratorKey == null ? null : DOCUMENT(orchestrators, participant.orchestratorKey)
        LET viewer = DOCUMENT(channelParticipants, @viewerParticipantKey)
        LET viewerMembership = viewer.userOrganizationKey == null ? null : DOCUMENT(userOrganizations, viewer.userOrganizationKey)
        LET legacyReplyGroup = FIRST(FOR item IN threads FILTER item.rootMessageKey == message._key LIMIT 1 RETURN item)
        LET legacyReplies = legacyReplyGroup == null ? [] : (FOR reply IN messages FILTER reply.threadKey == legacyReplyGroup._key && reply.deletedAt == null RETURN 1)
        LET directReplies = (FOR reply IN messages FILTER reply.replyToMessageKey == message._key && reply.deletedAt == null RETURN 1)
        LET poll = FIRST(FOR item IN polls FILTER item.messageKey == message._key LIMIT 1 RETURN item)
        RETURN { key: message._key, channelKey: message.channelKey, threadKey: message.threadKey, replyToMessageKey: message.replyToMessageKey, content: message.content, editedAt: message.editedAt, createdAt: message.createdAt, updatedAt: message.updatedAt,
          author: { participantKey: participant._key, type: participant.userOrganizationKey == null ? "orchestrator" : "user", key: participant.userOrganizationKey == null ? orchestrator._key : user._key, name: participant.userOrganizationKey == null ? orchestrator.name : NOT_NULL(user.name, user.alias, user.email, "Member") },
          reactions: (FOR reaction IN messageReactions FILTER reaction.messageKey == message._key COLLECT value = reaction.reaction INTO rows = reaction RETURN { reaction: value, count: LENGTH(rows), viewerReacted: @viewerParticipantKey IN rows[*].participantKey }),
          replies: { count: legacyReplyGroup == null ? LENGTH(directReplies) : LENGTH(legacyReplies) },
          poll: poll == null ? null : { key: poll._key, question: poll.question, allowMultiple: poll.allowMultiple, status: poll.status, closedAt: poll.closedAt, options: (FOR option IN pollOptions FILTER option.pollKey == poll._key SORT option.position ASC LET votes = (FOR vote IN pollVotes FILTER vote.optionKey == option._key RETURN vote) RETURN { key: option._key, text: option.text, position: option.position, voteCount: LENGTH(votes), viewerVoted: LENGTH(FOR vote IN votes FILTER vote.participantKey == @viewerParticipantKey LIMIT 1 RETURN 1) > 0 }) },
          canEdit: participant._key == @viewerParticipantKey,
          canDelete: participant._key == @viewerParticipantKey || viewerMembership.orgRole == "owner" || viewerMembership.orgRole == "admin" }
    `, { channelKey, viewerParticipantKey, limit });
    return (await cursor.all()).reverse().map(normalizeMessageProjection);
  },

  async listMessageReplies(channelKey, parentMessageKey, viewerParticipantKey, limit) {
    const cursor = await db.query<MessageProjection>(`
      FOR message IN messages
        FILTER message.channelKey == @channelKey && message.deletedAt == null
        FILTER message._key == @parentMessageKey || message.replyToMessageKey == @parentMessageKey
        SORT message.createdAt ASC, message._key ASC LIMIT @limit
        LET participant = DOCUMENT(channelParticipants, message.authorParticipantKey)
        LET membership = participant.userOrganizationKey == null ? null : DOCUMENT(userOrganizations, participant.userOrganizationKey)
        LET user = membership == null ? null : DOCUMENT(users, membership.userId)
        LET orchestrator = participant.orchestratorKey == null ? null : DOCUMENT(orchestrators, participant.orchestratorKey)
        LET viewer = DOCUMENT(channelParticipants, @viewerParticipantKey)
        LET viewerMembership = viewer.userOrganizationKey == null ? null : DOCUMENT(userOrganizations, viewer.userOrganizationKey)
        LET directReplies = (FOR reply IN messages FILTER reply.replyToMessageKey == message._key && reply.deletedAt == null RETURN 1)
        LET poll = FIRST(FOR item IN polls FILTER item.messageKey == message._key LIMIT 1 RETURN item)
        RETURN { key: message._key, channelKey: message.channelKey, threadKey: message.threadKey, replyToMessageKey: message.replyToMessageKey, content: message.content, editedAt: message.editedAt, createdAt: message.createdAt, updatedAt: message.updatedAt,
          author: { participantKey: participant._key, type: participant.userOrganizationKey == null ? "orchestrator" : "user", key: participant.userOrganizationKey == null ? orchestrator._key : user._key, name: participant.userOrganizationKey == null ? orchestrator.name : NOT_NULL(user.name, user.alias, user.email, "Member") },
          reactions: (FOR reaction IN messageReactions FILTER reaction.messageKey == message._key COLLECT value = reaction.reaction INTO rows = reaction RETURN { reaction: value, count: LENGTH(rows), viewerReacted: @viewerParticipantKey IN rows[*].participantKey }),
          replies: { count: LENGTH(directReplies) },
          poll: poll == null ? null : { key: poll._key, question: poll.question, allowMultiple: poll.allowMultiple, status: poll.status, closedAt: poll.closedAt, options: (FOR option IN pollOptions FILTER option.pollKey == poll._key SORT option.position ASC LET votes = (FOR vote IN pollVotes FILTER vote.optionKey == option._key RETURN vote) RETURN { key: option._key, text: option.text, position: option.position, voteCount: LENGTH(votes), viewerVoted: LENGTH(FOR vote IN votes FILTER vote.participantKey == @viewerParticipantKey LIMIT 1 RETURN 1) > 0 }) },
          canEdit: participant._key == @viewerParticipantKey,
          canDelete: participant._key == @viewerParticipantKey || viewerMembership.orgRole == "owner" || viewerMembership.orgRole == "admin" }
    `, { channelKey, parentMessageKey, viewerParticipantKey, limit });
    return (await cursor.all()).map(normalizeMessageProjection);
  },

  async deleteMessage(channelKey, messageKey, membershipKey, now) {
    return withTransaction({ read: ['userOrganizations', 'channelParticipants', 'threads'], write: ['messages'] }, async (trx) => {
      const targetCursor = await trx.query<{ key: string; legacyThreadKey: string | null }>(`
        LET message = DOCUMENT(messages, @messageKey)
        LET membership = DOCUMENT(userOrganizations, @membershipKey)
        LET author = message == null ? null : DOCUMENT(channelParticipants, message.authorParticipantKey)
        FILTER message != null && message.channelKey == @channelKey && message.deletedAt == null && membership != null
        FILTER author.userOrganizationKey == @membershipKey || membership.orgRole == "owner" || membership.orgRole == "admin"
        LET legacyThreadKey = FIRST(FOR item IN threads FILTER item.rootMessageKey == message._key LIMIT 1 RETURN item._key)
        UPDATE message WITH { deletedAt: @now, updatedAt: @now } IN messages
        RETURN { key: NEW._key, legacyThreadKey }
      `, { channelKey, messageKey, membershipKey, now });
      const target = await targetCursor.next();
      if (!target) return false;

      let parentKeys = [target.key];
      while (parentKeys.length) {
        const childCursor = await trx.query<{ key: string }>(`
          FOR message IN messages
            FILTER message.channelKey == @channelKey && message.deletedAt == null && message.replyToMessageKey IN @parentKeys
            UPDATE message WITH { deletedAt: @now, updatedAt: @now } IN messages
            RETURN { key: NEW._key }
        `, { channelKey, parentKeys, now });
        parentKeys = (await childCursor.all()).map(({ key }) => key);
      }
      if (target.legacyThreadKey) {
        await trx.query('FOR message IN messages FILTER message.channelKey == @channelKey && message.threadKey == @threadKey && message.deletedAt == null UPDATE message WITH { deletedAt: @now, updatedAt: @now } IN messages', { channelKey, threadKey: target.legacyThreadKey, now });
      }
      return true;
    });
  },
  async editMessage(channelKey, messageKey, membershipKey, content, now) {
    const raw = await first<Record<string, unknown>>(`
      LET message = DOCUMENT(messages, @messageKey)
      LET author = message == null ? null : DOCUMENT(channelParticipants, message.authorParticipantKey)
      FILTER message != null && message.channelKey == @channelKey && message.deletedAt == null
      FILTER author.userOrganizationKey == @membershipKey
      UPDATE message WITH { content: @content, editedAt: @now, updatedAt: @now, embedding: [], embeddingState: "pending", embeddingDimensions: null, embeddedAt: null, embeddingModel: null, embeddingProvider: null } IN messages OPTIONS { keepNull: false }
      RETURN NEW
    `, { channelKey, messageKey, membershipKey, content, now });
    if (!raw) return null;
    const message = parse(messageSchema, raw);
    void indexMessage(message);
    return message;
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
        LET viewer = DOCUMENT(channelParticipants, @viewerParticipantKey)
        LET viewerMembership = viewer.userOrganizationKey == null ? null : DOCUMENT(userOrganizations, viewer.userOrganizationKey)
        LET legacyReplyGroup = message._key == @rootMessageKey ? DOCUMENT(threads, @threadKey) : null
        LET legacyReplies = legacyReplyGroup == null ? [] : (FOR reply IN messages FILTER reply.threadKey == legacyReplyGroup._key && reply.deletedAt == null RETURN 1)
        LET directReplies = (FOR reply IN messages FILTER reply.replyToMessageKey == message._key && reply.deletedAt == null RETURN 1)
        LET poll = FIRST(FOR item IN polls FILTER item.messageKey == message._key LIMIT 1 RETURN item)
        RETURN { key: message._key, channelKey: message.channelKey, threadKey: message.threadKey, replyToMessageKey: message.replyToMessageKey, content: message.content, editedAt: message.editedAt, createdAt: message.createdAt, updatedAt: message.updatedAt,
          author: { participantKey: participant._key, type: participant.userOrganizationKey == null ? "orchestrator" : "user", key: participant.userOrganizationKey == null ? orchestrator._key : user._key, name: participant.userOrganizationKey == null ? orchestrator.name : NOT_NULL(user.name, user.alias, user.email, "Member") },
          reactions: (FOR reaction IN messageReactions FILTER reaction.messageKey == message._key COLLECT value = reaction.reaction INTO rows = reaction RETURN { reaction: value, count: LENGTH(rows), viewerReacted: @viewerParticipantKey IN rows[*].participantKey }),
          replies: { count: legacyReplyGroup == null ? LENGTH(directReplies) : LENGTH(legacyReplies) },
          poll: poll == null ? null : { key: poll._key, question: poll.question, allowMultiple: poll.allowMultiple, status: poll.status, closedAt: poll.closedAt, options: (FOR option IN pollOptions FILTER option.pollKey == poll._key SORT option.position ASC LET votes = (FOR vote IN pollVotes FILTER vote.optionKey == option._key RETURN vote) RETURN { key: option._key, text: option.text, position: option.position, voteCount: LENGTH(votes), viewerVoted: LENGTH(FOR vote IN votes FILTER vote.participantKey == @viewerParticipantKey LIMIT 1 RETURN 1) > 0 }) },
          canEdit: participant._key == @viewerParticipantKey,
          canDelete: participant._key == @viewerParticipantKey || viewerMembership.orgRole == "owner" || viewerMembership.orgRole == "admin" }
    `, { channelKey, threadKey, rootMessageKey, viewerParticipantKey, limit });
    return (await cursor.all()).reverse().map(normalizeMessageProjection);
  },
  async listThreads(channelKey) {
    const cursor = await db.query<ThreadProjection>(`
      FOR thread IN threads FILTER thread.channelKey == @channelKey && thread.status != "archived"
        LET root = DOCUMENT(messages, thread.rootMessageKey)
        LET replyCount = LENGTH(FOR message IN messages FILTER message.threadKey == thread._key && message.deletedAt == null RETURN 1)
        SORT thread.updatedAt DESC, thread._key DESC
        RETURN { key: thread._key, channelKey: thread.channelKey, title: thread.title, rootMessageKey: thread.rootMessageKey, rootContent: root.content, status: thread.status, replyCount, updatedAt: thread.updatedAt }
    `, { channelKey });
    return cursor.all();
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
  async getThreadByRootMessage(rootMessageKey) {
    const raw = await first<Record<string, unknown>>('FOR item IN threads FILTER item.rootMessageKey == @rootMessageKey LIMIT 1 RETURN item', { rootMessageKey });
    return raw ? parse(threadSchema, raw) : null;
  },

  async insertMessage(message) {
    const collection = db.collection('messages');
    const pending = messageSchema.parse({ ...message, embedding: [], embeddingState: 'pending' });
    const result = await collection.save(toArangoDoc(pending), { returnNew: true });
    const stored = parse(messageSchema, result.new as Record<string, unknown>);
    void indexMessage(stored);
    return stored;
  },
  async upsertMessage(message) {
    const pending = messageSchema.parse({ ...message, embedding: [], embeddingState: 'pending' });
    let raw: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 5 && !raw; attempt += 1) {
      try { raw = await first<Record<string, unknown>>('UPSERT { _key: @key } INSERT @message UPDATE {} IN messages RETURN NEW', { key: pending.key, message: toArangoDoc(pending) }); }
      catch (error) {
        const conflict = error && typeof error === 'object' && (('errorNum' in error && error.errorNum === 1200) || ('code' in error && error.code === 409));
        if (!conflict || attempt === 4) throw error;
        await Bun.sleep(5 * (attempt + 1));
      }
    }
    if (!raw) throw new Error('Message upsert did not return a document.');
    const stored = parse(messageSchema, raw);
    void indexMessage(stored);
    return stored;
  },
  async insertMentions(mentions) {
    if (!mentions.length) return;
    await db.query('FOR mention IN @mentions UPSERT { messageKey: mention.messageKey, participantKey: mention.participantKey } INSERT mention UPDATE { updatedAt: mention.updatedAt } IN messageMentions', { mentions: mentions.map((mention) => toArangoDoc(messageMentionSchema.parse(mention))) });
  },
  async recordUserMentions(userKey, sourceIds, now) {
    if (!sourceIds.length) return;
    const documents = buildUserMentionDocuments(userKey, sourceIds, now);
    await db.query('FOR document IN @documents UPSERT { userKey: document.userKey, sourceId: document.sourceId } INSERT document UPDATE { count: OLD.count + 1, updatedAt: @now } IN userMentions', { documents, now });
  },
  async recordUserReaction(userKey, reactionSlug, now) {
    await db.query('UPSERT { userKey: @userKey, reactionSlug: @reactionSlug } INSERT @document UPDATE { count: OLD.count + 1, updatedAt: @now } IN userReactions', { userKey, reactionSlug, now, document: toArangoDoc(userReactionSchema.parse({ key: newId(), userKey, reactionSlug, count: 1, createdAt: now, updatedAt: now })) });
  },
  async listUserReactions(userKey, limit) {
    const cursor = await db.query<UserReactionUsage>('FOR usage IN userReactions FILTER usage.userKey == @userKey SORT usage.count DESC, usage.updatedAt DESC, usage.reactionSlug ASC LIMIT @limit RETURN { reaction: usage.reactionSlug, count: usage.count }', { userKey, limit });
    return cursor.all();
  },

  async mutateReaction(input) {
    return withTransaction({ read: ['messages', 'channelParticipants'], write: ['messageReactions'] }, async (trx) => {
      const cursor = await trx.query<{ scopeKey: string; existingKey: string | null }>(`
        LET message = DOCUMENT(messages, @messageKey)
        LET participant = DOCUMENT(channelParticipants, @participantKey)
        FILTER message != null && message.deletedAt == null && participant != null && message.channelKey == @channelKey && participant.channelKey == @channelKey
        LET existing = FIRST(FOR reaction IN messageReactions FILTER reaction.messageKey == @messageKey && reaction.participantKey == @participantKey && reaction.reaction == @reaction LIMIT 1 RETURN reaction)
        RETURN { scopeKey: message.scopeKey, existingKey: existing == null ? null : existing._key }
      `, { channelKey: input.channelKey, messageKey: input.messageKey, participantKey: input.participantKey, reaction: input.reaction });
      const validated = await cursor.next();
      if (!validated) return null;
      const remove = input.mode === 'remove' || (input.mode === 'toggle' && validated.existingKey !== null);
      const changed = (remove && validated.existingKey !== null) || (!remove && validated.existingKey === null);
      if (remove && validated.existingKey) await trx.query('REMOVE @key IN messageReactions', { key: validated.existingKey });
      if (!remove && !validated.existingKey) await trx.query('INSERT @document INTO messageReactions', { document: toArangoDoc(messageReactionSchema.parse({ key: newId(), scopeKey: validated.scopeKey, channelKey: input.channelKey, messageKey: input.messageKey, participantKey: input.participantKey, reaction: input.reaction, createdAt: input.now, updatedAt: input.now })) });
      return { active: !remove, changed };
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
    const outcome = await withTransaction({ read: ['messages', 'pollOptions'], write: ['polls', 'pollVotes'] }, async (trx) => {
      const targetCursor = await trx.query<{ pollStatus: string; optionExists: boolean }>('LET poll = DOCUMENT(polls, @pollKey) LET message = poll == null ? null : DOCUMENT(messages, poll.messageKey) LET option = DOCUMENT(pollOptions, @optionKey) FILTER poll != null && message != null && message.deletedAt == null && poll.channelKey == @channelKey && message.channelKey == @channelKey RETURN { pollStatus: poll.status, optionExists: option != null && option.pollKey == poll._key }', vote);
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
    const raw = await first<Record<string, unknown>>('FOR poll IN polls FILTER poll._key == @pollKey && poll.channelKey == @channelKey && poll.creatorParticipantKey == @participantKey LET message = DOCUMENT(messages, poll.messageKey) FILTER message != null && message.deletedAt == null && message.channelKey == @channelKey UPDATE poll WITH { status: "closed", closedAt: @now, updatedAt: @now } IN polls RETURN NEW', { pollKey, channelKey, participantKey, now });
    return raw ? projectPoll(pollKey, channelKey, participantKey) : null;
  },
};

export { slugify };
