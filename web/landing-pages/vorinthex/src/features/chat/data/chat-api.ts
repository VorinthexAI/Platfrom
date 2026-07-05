// Shared (server- and client-safe) data helpers for chat message history.
// No "use client" here on purpose: `mapBackendMessage` is a pure data
// transform reused by both the Server Component route (§7.2's TTFB fetch,
// via `backendFetch` directly) and the client `useChatHistory` hook (via
// this file's `fetchChatMessagesPage`, which proxies through our own
// `/api/chat` GET handler rather than talking to the backend directly).
import type { ChatMessage, ChatMessageMetadata } from "../types";

/** Backend persistence shape, neural-map.md §7.2 — distinct from the AI SDK's
 * `UIMessage` wire shape; `mapBackendMessage` bridges the two. */
export type BackendChatMessage = {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "system" | "tool";
  parts: ChatMessage["parts"];
  createdAt: string;
  status?: "streaming" | "complete" | "error";
};

export type ChatHistoryPage = {
  messages: ChatMessage[];
  nextCursor: string | null;
};

export function mapBackendMessage(raw: BackendChatMessage): ChatMessage {
  const metadata: ChatMessageMetadata = {
    threadId: raw.threadId,
    createdAt: raw.createdAt,
    status: raw.status,
  };
  return {
    id: raw.id,
    // AI SDK v6's UIMessage role is 'system' | 'user' | 'assistant' only —
    // a persisted "tool" row's content lives in tool-call/tool-result parts,
    // not a separate role, so it folds into "assistant" here.
    role: raw.role === "tool" ? "assistant" : raw.role,
    parts: raw.parts,
    metadata,
  };
}

/**
 * Client-side fetch of one page of message history via our own `/api/chat`
 * GET proxy (see `src/app/api/chat/route.ts`) — the browser never talks to
 * the backend directly, matching how the POST/streaming path works.
 */
export async function fetchChatMessagesPage(threadId: string, cursor?: string): Promise<ChatHistoryPage> {
  const params = new URLSearchParams({ threadId });
  if (cursor) params.set("cursor", cursor);

  const res = await fetch(`/api/chat?${params.toString()}`, { credentials: "same-origin" });
  if (!res.ok) throw res;

  const data = (await res.json()) as { messages: BackendChatMessage[]; nextCursor: string | null };
  return { messages: data.messages.map(mapBackendMessage), nextCursor: data.nextCursor };
}
