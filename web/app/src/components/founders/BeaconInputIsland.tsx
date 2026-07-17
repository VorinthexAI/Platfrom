"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AscendIcon, CloseIcon } from "@vorinthex/shared/ui/icons";
import type { BeaconStatus } from "@/lib/founders/types";

export const BEACON_INPUT_LIMIT = 20_000;

interface BeaconInputIslandProps {
  status: BeaconStatus;
  error: string | null;
  disabled: boolean;
  disabledReason: string | null;
  onSubmit: (message: string) => void;
  onCancel: () => void;
}

/**
 * The floating Beacon input island. Multiline, Enter submits, Shift+Enter
 * inserts a newline, one active request at a time, cancel while streaming.
 * The island is the only prominent surface on the canvas — a restrained
 * obsidian slab floating clear of the viewport edge.
 */
export function BeaconInputIsland({ status, error, disabled, disabledReason, onSubmit, onCancel }: BeaconInputIslandProps) {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const busy = status === "connecting" || status === "streaming";

  // Grow with the content up to a calm maximum, then scroll inside.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 168)}px`;
  }, [message]);

  function submit() {
    const trimmed = message.trim();
    if (!trimmed || disabled || busy) return;
    onSubmit(trimmed);
    setMessage("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  const statusLine = error
    ?? disabledReason
    ?? (status === "connecting" ? "Reaching Beacon…" : status === "streaming" ? "Beacon is responding…" : "");

  return (
    <div className="founders-surface rounded-2xl p-3 transition-shadow focus-within:border-white/25 focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_24px_80px_rgba(0,0,0,0.38),0_0_44px_rgba(221,226,229,0.1)]">
      <label className="block">
        <span className="sr-only">Ask Beacon</span>
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(event) => setMessage(event.target.value.slice(0, BEACON_INPUT_LIMIT))}
          onKeyDown={onKeyDown}
          rows={1}
          maxLength={BEACON_INPUT_LIMIT}
          disabled={disabled}
          placeholder={disabled ? disabledReason ?? "Beacon is unavailable." : "Ask Beacon"}
          aria-label="Ask Beacon"
          className="scrollbar-hide w-full resize-none bg-transparent px-2 py-1.5 text-[0.95rem] leading-relaxed text-silver-50 outline-none placeholder:text-silver-500 disabled:cursor-not-allowed"
        />
      </label>
      <div className="mt-1.5 flex items-end justify-between gap-3 px-1">
        <p aria-live="polite" role="status" className="min-h-4 flex-1 truncate font-mono text-[0.62rem] tracking-[0.16em] text-silver-500 uppercase">
          {statusLine}
        </p>
        {message.length > BEACON_INPUT_LIMIT - 1_000 ? (
          <span className="font-mono text-[0.62rem] tracking-[0.12em] text-silver-500">
            {message.length.toLocaleString()}/{BEACON_INPUT_LIMIT.toLocaleString()}
          </span>
        ) : null}
        {busy ? (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel response"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/40 text-silver-100 transition-colors hover:border-white/30 hover:text-white"
          >
            <CloseIcon size="sm" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={disabled || !message.trim()}
            aria-label="Ask Beacon"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/20 text-[#10141a] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: "var(--gradient-chrome)" }}
          >
            <AscendIcon size="sm" />
          </button>
        )}
      </div>
    </div>
  );
}
