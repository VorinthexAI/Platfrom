// neural-map.md §5.1/§6.3.1/§7.2 — owned by the chat subsystem (the
// console-shell agent explicitly does not create this route). A Server
// Component so the first page of messages is available at first paint
// (fast TTFB) instead of waiting on a client round-trip; all subsequent
// interaction (older-message pagination, new message streaming) is
// client-side via `ChatThreadView` -> `useConsoleChat` / `useChatHistory`.
import { verifySession } from "@/server/dal/session";
import { backendFetch } from "@/server/backend-client";
import { ChatThreadView } from "@/features/chat/chat-thread-view";
import { mapBackendMessage, type BackendChatMessage } from "@/features/chat/data/chat-api";

export default async function ChatThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;

  // The console shell's own layout-level `verifySession()` call is the one
  // exception that hard-redirects on failure (§7.10) — this page's call is
  // the normal per-request DAL guard for reading thread data.
  await verifySession();

  if (threadId === "new") {
    // §7.2: the composer must be usable immediately, with no network
    // round-trip — the real thread is only minted on first send (§7.8),
    // handled entirely client-side by `useConsoleChat`.
    return <ChatThreadView threadId="new" initialMessages={[]} initialNextCursor={null} />;
  }

  let response: Response;
  try {
    response = await backendFetch(`/chat/threads/${threadId}/messages`);
  } catch {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-[var(--vx-console-text-muted)]">
        Couldn&rsquo;t load this conversation.
      </div>
    );
  }

  if (!response.ok) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-[var(--vx-console-text-muted)]">
        Couldn&rsquo;t load this conversation.
      </div>
    );
  }

  const data = (await response.json().catch(() => null)) as {
    messages?: BackendChatMessage[];
    nextCursor?: string | null;
  } | null;

  if (!data || !Array.isArray(data.messages)) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-[var(--vx-console-text-muted)]">
        Couldn&rsquo;t load this conversation.
      </div>
    );
  }

  return (
    <ChatThreadView
      threadId={threadId}
      initialMessages={data.messages.map(mapBackendMessage)}
      initialNextCursor={data.nextCursor ?? null}
    />
  );
}
