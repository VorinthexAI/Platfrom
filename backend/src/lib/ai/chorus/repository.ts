import { db, withTransaction } from '@/lib/db/client';
import { isArangoNotFoundError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { embedText } from '@/lib/bedrock-titan';
import { newId } from '@/lib/ids';
import {
  channelEmbeddingInput, channelParticipantSchema, channelSchema, chorusSchemas, messageAttachmentSchema, messageEmbeddingInput,
  messageEditSchema, messageMentionSchema, messageSchema, pollEmbeddingInput, pollOptionEmbeddingInput, pollOptionSchema, pollSchema,
  pollVoteSchema, threadSchema, type Channel, type ChorusCollection, type Message, type Poll, type PollOption, type PollVote, type Thread,
} from './schema';

export class ChorusError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = false) { super(message); }
}

export type BatchResult<T> = { inputIndex: number; key?: string; success: true; data: T } | { inputIndex: number; key?: string; success: false; error: { code: string; message: string; retryable: boolean } };
export type BatchResponse<T> = { results: BatchResult<T>[]; summary: { requested: number; succeeded: number; failed: number } };
export function batchResponse<T>(results: BatchResult<T>[]): BatchResponse<T> {
  const succeeded = results.filter((result) => result.success).length;
  return { results, summary: { requested: results.length, succeeded, failed: results.length - succeeded } };
}

type DatabaseLike = Pick<typeof db, 'collection' | 'query'>;
type Embed = (text: string) => Promise<number[]>;
type Clock = () => string;
const active = 'doc.deletedAt == null';

function errorResult<T>(inputIndex: number, key: string | undefined, error: unknown): BatchResult<T> {
  const chorusError = error instanceof ChorusError ? error : new ChorusError('CHORUS_INVALID_INPUT', error instanceof Error ? error.message : 'Unknown Chorus error');
  return { inputIndex, key, success: false, error: { code: chorusError.code, message: chorusError.message, retryable: chorusError.retryable } };
}

export interface ChorusRepository {
  createChannels(input: Array<{ key?: string; scopeKey: string; name: string; description?: string; type: 'public' | 'private'; ownerUserKey?: string; ownerOrchestratorKey?: string }>, atomic?: boolean): Promise<BatchResponse<{ channel: Channel; rootThread: Thread; ownerParticipantKey: string }>>;
  createMessages(input: Array<{ key?: string; channelKey: string; threadKey: string; authorParticipantKey: string; content: string; mentions?: Array<{ targetCollection: string; targetKey: string }>; attachments?: Array<{ targetCollection: string; targetKey: string; displayName?: string }> }>, atomic?: boolean): Promise<BatchResponse<Message>>;
  updateMessages(input: Array<{ messageKey: string; editedByParticipantKey: string; content: string }>, atomic?: boolean): Promise<BatchResponse<Message>>;
  createPolls(input: Array<{ key?: string; channelKey: string; threadKey: string; createdByParticipantKey: string; question: string; multipleChoice: boolean; closesAt?: string; options: Array<{ key?: string; text: string; order?: number }> }>, atomic?: boolean): Promise<BatchResponse<{ poll: Poll; options: PollOption[] }>>;
  castVotes(input: Array<{ key?: string; pollKey: string; optionKey: string; participantKey: string }>, atomic?: boolean): Promise<BatchResponse<PollVote>>;
  lifecycle(collection: ChorusCollection, keys: string[], operation: 'archive' | 'restore' | 'delete'): Promise<BatchResponse<{ key: string }>>;
  get<T extends ChorusCollection>(collection: T, key: string, includeDeleted?: boolean): Promise<unknown | null>;
}

export function createChorusRepository(database: DatabaseLike = db, generateEmbedding: Embed = (text) => embedText({ text }), now: Clock = () => new Date().toISOString()): ChorusRepository {
  async function get<T extends ChorusCollection>(collection: T, key: string, includeDeleted = false): Promise<any | null> {
    try {
      const raw = await database.collection(collection).document(key) as Record<string, unknown>;
      const parsed = chorusSchemas[collection].parse(withArangoKey(raw));
      return !includeDeleted && parsed.deletedAt ? null : parsed;
    } catch (error) {
      if (isArangoNotFoundError(error)) return null;
      throw error;
    }
  }

  async function requireActive<T extends ChorusCollection>(collection: T, key: string): Promise<any> {
    const node = await get(collection, key);
    if (!node) throw new ChorusError(`${collection.toUpperCase()}_NOT_FOUND`, `${collection} resource was not found`);
    return node;
  }

  async function runBatch<T, Input extends object>(items: Input[], atomic: boolean | undefined, work: (item: Input) => Promise<T>): Promise<BatchResponse<T>> {
    if (atomic) {
      // Aggregate creators use their own transactions. Preflight every item so no
      // persistence starts until validation and embedding preparation succeeds.
      const prepared = await Promise.all(items.map(work));
      return batchResponse(prepared.map((data, inputIndex) => ({ inputIndex, success: true as const, data })));
    }
    const results: BatchResult<T>[] = [];
    for (const [inputIndex, item] of items.entries()) {
      try { results.push({ inputIndex, key: (item as { key?: string }).key, success: true, data: await work(item) }); }
      catch (error) { results.push(errorResult(inputIndex, (item as { key?: string }).key, error)); }
    }
    return batchResponse(results);
  }

  return {
    async createChannels(items, atomic) {
      return runBatch(items, atomic, async (input) => {
        if (Number(input.ownerUserKey !== undefined) + Number(input.ownerOrchestratorKey !== undefined) !== 1) throw new ChorusError('PARTICIPANT_IDENTITY_INVALID', 'Exactly one owner identity must be provided.');
        const timestamp = now(); const channelKey = input.key ?? newId(); const rootKey = newId(); const participantKey = newId();
        const channelBase = { key: channelKey, scopeKey: input.scopeKey, name: input.name, description: input.description, type: input.type, createdAt: timestamp, updatedAt: timestamp, embedding: [] };
        const channel = channelSchema.parse({ ...channelBase, embedding: await generateEmbedding(channelEmbeddingInput(channelBase)) });
        const rootThread = threadSchema.parse({ key: rootKey, scopeKey: channel.scopeKey, channelKey, isRoot: true, createdAt: timestamp, updatedAt: timestamp, embedding: [] });
        const participant = channelParticipantSchema.parse({ key: participantKey, scopeKey: channel.scopeKey, channelKey, userKey: input.ownerUserKey, orchestratorKey: input.ownerOrchestratorKey, role: 'owner', createdAt: timestamp, updatedAt: timestamp, embedding: [] });
        await withTransaction(['channels', 'threads', 'channelParticipants'], async (trx) => {
          await trx.query('INSERT @channel INTO channels', { channel: toArangoDoc(channel) });
          await trx.query('INSERT @thread INTO threads', { thread: toArangoDoc(rootThread) });
          await trx.query('INSERT @participant INTO channelParticipants', { participant: toArangoDoc(participant) });
        });
        return { channel, rootThread, ownerParticipantKey: participant.key };
      });
    },

    async createMessages(items, atomic) {
      return runBatch(items, atomic, async (input) => {
        const [channel, thread, participant] = await Promise.all([requireActive('channels', input.channelKey), requireActive('threads', input.threadKey), requireActive('channelParticipants', input.authorParticipantKey)]);
        if (thread.channelKey !== channel.key) throw new ChorusError('THREAD_CHANNEL_MISMATCH', 'Thread does not belong to channel.');
        if (participant.channelKey !== channel.key) throw new ChorusError('MESSAGE_AUTHOR_INVALID', 'Author does not belong to channel.');
        const timestamp = now(); const key = input.key ?? newId();
        const base = { key, scopeKey: channel.scopeKey, channelKey: channel.key, threadKey: thread.key, authorParticipantKey: participant.key, content: input.content, createdAt: timestamp, updatedAt: timestamp, embedding: [] };
        const message = messageSchema.parse({ ...base, embedding: await generateEmbedding(messageEmbeddingInput(base)) });
        const mentions = (input.mentions ?? []).map((mention) => messageMentionSchema.parse({ key: newId(), scopeKey: message.scopeKey, messageKey: message.key, ...mention, createdAt: timestamp, updatedAt: timestamp, embedding: [] }));
        const attachments = (input.attachments ?? []).map((attachment) => messageAttachmentSchema.parse({ key: newId(), scopeKey: message.scopeKey, messageKey: message.key, ...attachment, createdAt: timestamp, updatedAt: timestamp, embedding: [] }));
        await withTransaction(['messages', 'messageMentions', 'messageAttachments'], async (trx) => {
          await trx.query('INSERT @message INTO messages', { message: toArangoDoc(message) });
          if (mentions.length) await trx.query('FOR doc IN @docs INSERT doc INTO messageMentions', { docs: mentions.map(toArangoDoc) });
          if (attachments.length) await trx.query('FOR doc IN @docs INSERT doc INTO messageAttachments', { docs: attachments.map(toArangoDoc) });
        });
        return message;
      });
    },

    async updateMessages(items, atomic) {
      return runBatch(items, atomic, async (input) => {
        const message = await requireActive('messages', input.messageKey);
        if (message.authorParticipantKey !== input.editedByParticipantKey) throw new ChorusError('MESSAGE_EDIT_FORBIDDEN', 'Only the message author may edit this message.');
        const editor = await requireActive('channelParticipants', input.editedByParticipantKey);
        if (editor.channelKey !== message.channelKey) throw new ChorusError('MESSAGE_EDIT_FORBIDDEN', 'Editor does not belong to the message channel.');
        const timestamp = now();
        const sequenceCursor = await database.query<{ sequence: number }>('FOR doc IN messageEdits FILTER doc.messageKey == @messageKey SORT doc.editSequence DESC LIMIT 1 RETURN { sequence: doc.editSequence }', { messageKey: message.key });
        const sequence = ((await sequenceCursor.next())?.sequence ?? 0) + 1;
        const edit = messageEditSchema.parse({ key: newId(), scopeKey: message.scopeKey, messageKey: message.key, previousContent: message.content, editedByParticipantKey: editor.key, editSequence: sequence, createdAt: timestamp, updatedAt: timestamp, embedding: [] });
        const content = input.content.trim();
        if (!content) throw new ChorusError('MESSAGE_EMPTY', 'Message content cannot be empty.');
        if (content.length > 100_000) throw new ChorusError('MESSAGE_TOO_LARGE', 'Message content exceeds 100,000 characters.');
        const embedding = await generateEmbedding(content);
        await withTransaction(['messages', 'messageEdits'], async (trx) => {
          await trx.query('INSERT @edit INTO messageEdits', { edit: toArangoDoc(edit) });
          await trx.query('UPDATE @key WITH { content: @content, embedding: @embedding, updatedAt: @updatedAt } IN messages', { key: message.key, content, embedding, updatedAt: timestamp });
        });
        return messageSchema.parse({ ...message, content, embedding, updatedAt: timestamp });
      });
    },

    async createPolls(items, atomic) {
      return runBatch(items, atomic, async (input) => {
        if (input.options.length < 2) throw new ChorusError('POLL_MINIMUM_OPTIONS', 'A poll requires at least two options.');
        const [channel, thread, creator] = await Promise.all([requireActive('channels', input.channelKey), requireActive('threads', input.threadKey), requireActive('channelParticipants', input.createdByParticipantKey)]);
        if (thread.channelKey !== channel.key) throw new ChorusError('THREAD_CHANNEL_MISMATCH', 'Thread does not belong to channel.');
        if (creator.channelKey !== channel.key) throw new ChorusError('PARTICIPANT_NOT_FOUND', 'Poll creator does not belong to channel.');
        const timestamp = now(); const pollKey = input.key ?? newId();
        const pollBase = { key: pollKey, scopeKey: channel.scopeKey, channelKey: channel.key, threadKey: thread.key, createdByParticipantKey: creator.key, question: input.question, multipleChoice: input.multipleChoice, closesAt: input.closesAt, createdAt: timestamp, updatedAt: timestamp, embedding: [] };
        const poll = pollSchema.parse({ ...pollBase, embedding: await generateEmbedding(pollEmbeddingInput(pollBase)) });
        const options = await Promise.all(input.options.map(async (option, index) => {
          const base = { key: option.key ?? newId(), scopeKey: poll.scopeKey, pollKey, text: option.text, order: option.order ?? index, createdAt: timestamp, updatedAt: timestamp, embedding: [] };
          return pollOptionSchema.parse({ ...base, embedding: await generateEmbedding(pollOptionEmbeddingInput(base)) });
        }));
        if (new Set(options.map((option) => option.text.trim().toLocaleLowerCase())).size !== options.length) throw new ChorusError('CHORUS_CONFLICT', 'Poll option text must be unique.');
        await withTransaction(['polls', 'pollOptions'], async (trx) => { await trx.query('INSERT @poll INTO polls', { poll: toArangoDoc(poll) }); await trx.query('FOR doc IN @docs INSERT doc INTO pollOptions', { docs: options.map(toArangoDoc) }); });
        return { poll, options };
      });
    },

    async castVotes(items, atomic) {
      return runBatch(items, atomic, async (input) => {
        const [poll, option, participant] = await Promise.all([requireActive('polls', input.pollKey), requireActive('pollOptions', input.optionKey), requireActive('channelParticipants', input.participantKey)]);
        if (option.pollKey !== poll.key) throw new ChorusError('POLL_OPTION_INVALID', 'Option does not belong to poll.');
        if (participant.channelKey !== poll.channelKey) throw new ChorusError('PARTICIPANT_INACTIVE', 'Participant does not belong to poll channel.');
        if (poll.closedAt || (poll.closesAt && new Date(poll.closesAt).getTime() <= Date.now())) throw new ChorusError('POLL_CLOSED', 'Poll is closed.');
        const timestamp = now(); const vote = pollVoteSchema.parse({ key: input.key ?? newId(), scopeKey: poll.scopeKey, pollKey: poll.key, optionKey: option.key, participantKey: participant.key, createdAt: timestamp, updatedAt: timestamp, embedding: [] });
        await withTransaction(['pollVotes'], async (trx) => {
          if (!poll.multipleChoice) await trx.query(`FOR doc IN pollVotes FILTER doc.pollKey == @pollKey && doc.participantKey == @participantKey && ${active} UPDATE doc WITH { deletedAt: @now, updatedAt: @now } IN pollVotes`, { pollKey: poll.key, participantKey: participant.key, now: timestamp });
          await trx.query('UPSERT { pollKey: @pollKey, optionKey: @optionKey, participantKey: @participantKey } INSERT @vote UPDATE { deletedAt: null, updatedAt: @now } IN pollVotes', { pollKey: poll.key, optionKey: option.key, participantKey: participant.key, vote: toArangoDoc(vote), now: timestamp });
        });
        return vote;
      });
    },

    async lifecycle(collection, keys, operation) {
      const results: BatchResult<{ key: string }>[] = [];
      for (const [inputIndex, key] of keys.entries()) {
        try {
          const current = await get(collection, key, true);
          if (!current) throw new ChorusError('CHORUS_NOT_FOUND', 'Resource was not found.');
          if (operation === 'archive') await database.collection(collection).update(key, { deletedAt: now(), updatedAt: now() });
          if (operation === 'restore') await database.collection(collection).update(key, { deletedAt: null, updatedAt: now() }, { keepNull: false });
          if (operation === 'delete') { if (!current.deletedAt) throw new ChorusError('CHORUS_CONFLICT', 'Resource must be archived before permanent deletion.'); await database.collection(collection).remove(key); }
          results.push({ inputIndex, key, success: true, data: { key } });
        } catch (error) { results.push(errorResult(inputIndex, key, error)); }
      }
      return batchResponse(results);
    },
    get,
  };
}
