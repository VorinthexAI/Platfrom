import { channelParticipantSchema, channelParticipantsEmbeddingFields, type ChannelParticipant } from '@/lib/db/channel-participants.node';
import { channelSchema, channelsEmbeddingFields, type Channel } from '@/lib/db/channels.node';
import { messageMentionSchema, messageMentionsEmbeddingFields, type MessageMention } from '@/lib/db/message-mentions.node';
import { messageReactionSchema, messageReactionsEmbeddingFields, type MessageReaction } from '@/lib/db/message-reactions.node';
import { messageSchema, messagesEmbeddingFields, type Message } from '@/lib/db/messages.node';
import { threadSchema, threadsEmbeddingFields, type Thread } from '@/lib/db/threads.node';
import { pollSchema, pollsEmbeddingFields, type Poll } from '@/lib/db/polls.node';
import { pollOptionSchema, pollOptionsEmbeddingFields, type PollOption } from '@/lib/db/poll-options.node';
import { pollVoteSchema, pollVotesEmbeddingFields, type PollVote } from '@/lib/db/poll-votes.node';

export {
  channelSchema, channelParticipantSchema, threadSchema, messageSchema, messageMentionSchema, messageReactionSchema, pollSchema, pollOptionSchema, pollVoteSchema,
};
export type { Channel, ChannelParticipant, Thread, Message, MessageMention, MessageReaction, Poll, PollOption, PollVote };

export const communicationEmbeddingFields = {
  channels: channelsEmbeddingFields,
  channelParticipants: channelParticipantsEmbeddingFields,
  threads: threadsEmbeddingFields,
  messages: messagesEmbeddingFields,
  messageMentions: messageMentionsEmbeddingFields,
  messageReactions: messageReactionsEmbeddingFields,
  polls: pollsEmbeddingFields,
  pollOptions: pollOptionsEmbeddingFields,
  pollVotes: pollVotesEmbeddingFields,
} as const;
