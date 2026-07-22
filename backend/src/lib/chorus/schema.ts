import { channelParticipantSchema, channelParticipantsEmbeddingFields, type ChannelParticipant } from '@/lib/db/channel-participants.node';
import { channelSchema, channelsEmbeddingFields, type Channel } from '@/lib/db/channels.node';
import { messageMentionSchema, messageMentionsEmbeddingFields, type MessageMention } from '@/lib/db/message-mentions.node';
import { messageReactionSchema, messageReactionsEmbeddingFields, type MessageReaction } from '@/lib/db/message-reactions.node';
import { messageSchema, messagesEmbeddingFields, type Message } from '@/lib/db/messages.node';
import { threadSchema, threadsEmbeddingFields, type Thread } from '@/lib/db/threads.node';

export {
  channelSchema, channelParticipantSchema, threadSchema, messageSchema, messageMentionSchema, messageReactionSchema,
};
export type { Channel, ChannelParticipant, Thread, Message, MessageMention, MessageReaction };

export const chorusEmbeddingFields = {
  channels: channelsEmbeddingFields,
  channelParticipants: channelParticipantsEmbeddingFields,
  threads: threadsEmbeddingFields,
  messages: messagesEmbeddingFields,
  messageMentions: messageMentionsEmbeddingFields,
  messageReactions: messageReactionsEmbeddingFields,
} as const;
