// neural-map.md §7.2's persisted `ChatMessage` shape, expressed as an AI SDK
// v6 `UIMessage` with the backend-owned persistence fields (`threadId`,
// `createdAt`, `status`) carried in `metadata` rather than as a parallel,
// hand-rolled type. This means the exact same object instance flows from
// `useChat`'s live `messages` array through to history-page hydration with
// zero adapter step at the render boundary — `chat-message-list.tsx` and
// `chat-message.tsx` only ever need to know one shape.
import type { UIMessage } from "ai";

export type ChatMessageMetadata = {
  threadId?: string;
  createdAt?: string;
  status?: "streaming" | "complete" | "error";
};

export type ChatMessage = UIMessage<ChatMessageMetadata>;
export type ChatMessagePart = ChatMessage["parts"][number];
