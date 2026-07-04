"use client";

// neural-map.md §7.4/§7.9/§17.2 — a single chat message. Memoized keyed by
// message id + a cheap content hash: historical (non-streaming) messages
// should only ever re-render if their own content actually changed, and the
// *only* message that re-renders on every token is the one currently
// streaming (enforced by `messagesEqual` below always treating
// `isStreamingNow: true` as unequal).
import { memo } from "react";
import { Avatar } from "@/shared/packages/ui";
import { IncrementalMarkdownRenderer } from "./markdown/incremental-markdown-renderer";
import { ToolCallCard, flyToNodeInUniverse, type SearchResult } from "./tool-call-card";
import type { ChatMessage } from "./types";

export type ChatMessageProps = {
  message: ChatMessage;
  /** True only for the single currently-streaming message. */
  isStreamingNow: boolean;
};

function ReasoningDisclosure({ text, isComplete }: { text: string; isComplete: boolean }) {
  return (
    <details
      className="my-2 rounded-md border border-[var(--vx-console-border)] bg-[var(--vx-console-surface)] px-3 py-1.5 text-sm text-[var(--vx-console-text-muted)]"
      // Collapsed by default; auto-collapses again once the final answer
      // begins because each new message gets a fresh <details> (uncontrolled
      // `open` state), matching §7.9's "auto-collapse once the final answer
      // begins" rule without needing extra state here.
      open={!isComplete}
    >
      <summary className="cursor-pointer select-none font-medium">Thinking&hellip;</summary>
      <div className="mt-1 whitespace-pre-wrap">{text}</div>
    </details>
  );
}

function ChatMessageImpl({ message, isStreamingNow }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex gap-3 px-4 py-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
      data-message-id={message.id}
      data-streaming={isStreamingNow || undefined}
    >
      <Avatar
        alt={isUser ? "You" : "Assistant"}
        fallback={isUser ? "You" : "AI"}
        className="h-8 w-8 shrink-0 bg-[var(--vx-console-surface-raised)] text-[var(--vx-console-text-muted)]"
      />
      <div
        className={`min-w-0 max-w-[75ch] flex-1 text-[15px] text-[var(--vx-console-text)] ${isUser ? "text-right" : "text-left"}`}
      >
        {message.parts.map((part, index) => {
          switch (part.type) {
            case "text":
              return (
                <IncrementalMarkdownRenderer
                  key={index}
                  textDelta={part.text}
                  isComplete={!isStreamingNow || part.state === "done"}
                />
              );
            case "reasoning":
              return <ReasoningDisclosure key={index} text={part.text} isComplete={part.state === "done"} />;
            case "dynamic-tool": {
              if (part.toolName !== "search_universe") return null;
              const args = (part.input as { query: string } | undefined) ?? { query: "" };
              const result = part.state === "output-available" ? (part.output as SearchResult[]) : null;
              return (
                <ToolCallCard
                  key={part.toolCallId}
                  toolName="search_universe"
                  args={args}
                  result={result}
                  onViewInUniverse={flyToNodeInUniverse}
                />
              );
            }
            default:
              return null;
          }
        })}
      </div>
    </div>
  );
}

function contentHash(message: ChatMessage): string {
  // Cheap structural hash — not cryptographic, just enough to detect a
  // content change for memoization purposes (§7.4).
  return message.parts
    .map((part) => {
      if (part.type === "text" || part.type === "reasoning") return `${part.type}:${part.text.length}:${part.text.slice(-16)}`;
      if (part.type === "dynamic-tool") return `tool:${part.toolCallId}:${part.state}`;
      return part.type;
    })
    .join("|");
}

function messagesEqual(prev: ChatMessageProps, next: ChatMessageProps): boolean {
  if (next.isStreamingNow) return false; // the streaming message always re-renders on new tokens
  if (prev.isStreamingNow !== next.isStreamingNow) return false;
  if (prev.message.id !== next.message.id) return false;
  return contentHash(prev.message) === contentHash(next.message);
}

export const ChatMessageComponent = memo(ChatMessageImpl, messagesEqual);

// Re-exported so callers don't need a separate import just for the hashing
// helper if they need to key on the same content-change signal elsewhere.
export { contentHash as chatMessageContentHash };
