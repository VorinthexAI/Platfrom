"use client";

// neural-map.md §6.2 — the mode-toggle icon button. Lifted close to
// verbatim from the plan's sketch.
//
// Reiterating the single easiest thing to get backwards here:
// `mode === "chat"` renders the Globe icon (invitation to leave chat and
// enter the universe), and `mode === "universe"` renders the Chat-bubble
// icon (invitation to leave the universe and return to chat).

import { GlobeIcon } from "@vorinthex/shared/ui";
import { ChatBubbleIcon } from "@vorinthex/shared/ui";

import type { ConsoleMode } from "../store/console-mode-store";

export type ModeToggleButtonProps = {
  mode: ConsoleMode;
  onToggleMode: () => void;
  hasOtherModeActivity: boolean;
};

export function ModeToggleButton({
  mode,
  onToggleMode,
  hasOtherModeActivity,
}: ModeToggleButtonProps) {
  const nextMode = mode === "chat" ? "universe" : "chat";
  return (
    <button
      type="button"
      onClick={onToggleMode}
      aria-label={nextMode === "universe" ? "Open the Universe" : "Open Chat"}
      className="vx-mode-toggle"
      data-pulse={hasOtherModeActivity ? "true" : undefined}
    >
      {mode === "chat" ? <GlobeIcon aria-hidden /> : <ChatBubbleIcon aria-hidden />}
      {hasOtherModeActivity ? (
        <span className="sr-only">
          New activity in {mode === "chat" ? "Universe" : "Chat"}
        </span>
      ) : null}
    </button>
  );
}
