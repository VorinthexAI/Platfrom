"use client";

// neural-map.md §6.5, §7.7, §7.10, §33.1 — the chat mode floating island
// content: autosize textarea, Enter/Shift+Enter with IME-composition
// guard, queued-send while streaming, drag-and-drop attachment onto the
// whole island, and seeded-draft consumption from the Universe's "ask
// about what I'm looking at" bridge (pending-chat-draft-store.ts).
//
// This composer's `<textarea>` DOM node is never unmounted across mode
// toggles (see floating-island-host.tsx) — that's what makes the
// draft-persistence contract in §7.10 actually hold.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { usePathname } from "next/navigation";

import { useConsoleChat } from "@/features/chat/use-console-chat";
import { UploadIcon } from "@/shared/packages/ui/icons/upload/upload.web";

import { useConsoleModeStore } from "../store/console-mode-store";
import { usePendingChatDraftStore } from "../store/pending-chat-draft-store";

const DRAFT_PERSIST_DEBOUNCE_MS = 250;
const NEW_THREAD_SENTINEL = "new";

type PendingAttachment = {
  id: string;
  file: File;
};

export function ChatComposer() {
  const pathname = usePathname();
  const threadId = extractThreadId(pathname);

  const { sendMessage, status, stop } = useConsoleChat(threadId);
  const mode = useConsoleModeStore((state) => state.mode);

  const [draft, setDraft] = useState(() => restoreDraft(threadId));
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [queuedSend, setQueuedSend] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wasBusyRef = useRef(false);
  const dragDepthRef = useRef(0);

  // `status === "streaming"` is the plan's literal morph condition (§6.5);
  // "submitted" (queued server-side, stream not yet started) is folded in
  // here too so a second Enter press can't double-submit before the first
  // token arrives — it still queues rather than fires immediately, same as
  // the streaming case.
  const isBusy = status === "streaming" || status === "submitted";

  // Reload the draft when the thread identity actually changes (e.g. the
  // optimistic `new` -> real thread id swap from §7.8 does NOT count,
  // since that's a URL replace, not a new composer instance — but a user
  // navigating to a genuinely different existing thread does).
  const lastThreadIdRef = useRef(threadId);
  useEffect(() => {
    if (lastThreadIdRef.current === threadId) return;
    lastThreadIdRef.current = threadId;
    setDraft(restoreDraft(threadId));
  }, [threadId]);

  // Persist draft on every keystroke, debounced — §7.10.
  useEffect(() => {
    const handle = setTimeout(() => persistDraft(threadId, draft), DRAFT_PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [threadId, draft]);

  // Autosize — grows up to 40vh, then internally scrolls. §7.7.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = window.innerHeight * 0.4;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [draft]);

  // Queued-send: if the user hit Enter while a previous stream was still
  // running, fire the queued message the instant it finishes. §7.7.
  useEffect(() => {
    if (wasBusyRef.current && !isBusy && queuedSend) {
      sendMessage({ text: queuedSend });
      setQueuedSend(null);
    }
    wasBusyRef.current = isBusy;
  }, [isBusy, queuedSend, sendMessage]);

  // Consume a pending draft handed off from the Universe's "ask about what
  // I'm looking at" quick-action (pending-chat-draft-store.ts) on mount and
  // every time this composer becomes the visible one again.
  useEffect(() => {
    if (mode !== "chat") return;
    const pending = usePendingChatDraftStore.getState().consumeDraft();
    if (pending !== null) {
      // This is a one-shot consumption of an external mutable queue (the
      // draft is removed from the store by `consumeDraft()` itself), not a
      // derived-state copy — a legitimate effect, despite the lint rule's
      // general (and usually correct) bias against setState-in-effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(pending);
    }
  }, [mode]);

  const submit = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (isBusy) {
      setQueuedSend(trimmed); // don't fire yet — wait for the current stream to finish
    } else {
      sendMessage({ text: trimmed });
    }
    setDraft("");
    persistDraft(threadId, "");
    setAttachments([]);
  }, [draft, isBusy, sendMessage, threadId]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // Critical: ignore Enter while an IME composition is in progress
      // (CJK/Korean input), or the composing text gets prematurely
      // submitted. §7.7.
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        submit();
      }
    },
    [submit],
  );

  const addFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    setAttachments((prev) => [
      ...prev,
      ...Array.from(files).map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        file,
      })),
    ]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
  }, []);

  // Drag-and-drop onto the whole island, not just a tiny icon target — §7.7.
  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragActive(true);
  }, []);
  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
  }, []);
  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragActive(false);
  }, []);
  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDragActive(false);
      addFiles(event.dataTransfer.files);
    },
    [addFiles],
  );

  return (
    <div
      className="vx-chat-composer"
      data-drag-active={isDragActive ? "true" : undefined}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <button
        type="button"
        className="vx-composer-icon-button"
        aria-label="Attach files"
        onClick={() => fileInputRef.current?.click()}
      >
        <UploadIcon aria-hidden size="sm" />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          addFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything…"
        rows={1}
        aria-label="Message"
      />

      {isBusy ? (
        <button
          type="button"
          onClick={stop}
          aria-label="Stop generating"
          className="vx-composer-icon-button vx-composer-stop"
        >
          <StopIcon />
        </button>
      ) : (
        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim()}
          aria-label="Send message"
          className="vx-composer-icon-button vx-composer-send"
        >
          <SendIcon />
        </button>
      )}

      {queuedSend && (
        <div className="vx-composer-queued-hint">Sending after this response finishes…</div>
      )}

      {attachments.length > 0 && (
        <div className="vx-composer-attachments">
          {attachments.map((attachment) => (
            <span key={attachment.id} className="vx-composer-attachment-chip">
              {attachment.file.name}
              <button
                type="button"
                aria-label={`Remove ${attachment.file.name}`}
                onClick={() => removeAttachment(attachment.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function extractThreadId(pathname: string | null): string {
  const match = pathname?.match(/\/console\/c\/([^/]+)/);
  return match?.[1] ?? NEW_THREAD_SENTINEL;
}

function restoreDraft(threadId: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(`vx-draft:${threadId}`) ?? "";
  } catch {
    return "";
  }
}

function persistDraft(threadId: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(`vx-draft:${threadId}`, value);
    else window.sessionStorage.removeItem(`vx-draft:${threadId}`);
  } catch {
    // sessionStorage unavailable (private mode, etc) — draft loss here is
    // an acceptable degradation, not a crash.
  }
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 12l16-8-6 8 6 8-16-8Z"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" />
    </svg>
  );
}
