"use client";

// neural-map.md §6.5 — the floating island: a single, persistent,
// centered-bottom surface that exists in both modes but morphs its
// content.
//
// CRITICAL: both `<ChatComposer/>` and `<UniverseCommandBar/>` are kept
// mounted simultaneously (toggled via `hidden`, mirroring the main
// chat/universe panel pattern in console-shell.tsx) rather than a naive
// `{mode === "chat" ? <ChatComposer/> : <UniverseCommandBar/>}` ternary —
// a ternary would unmount/remount on every toggle, which is exactly what
// would lose the chat `<textarea>` DOM node (and the in-progress draft
// with it). §6.5's own inline sketch shows the ternary for illustration,
// but the plan's own "never remounts either" requirement (also stated at
// the top of this file's originating instructions) means the ternary
// version must not be what ships.
//
// `UniverseCommandBar` still lazy-mounts on first visit to Universe mode
// (it statically imports from `@/features/universe/**`, which must not be
// part of the chat-only initial bundle — §13.4) and, once mounted, is
// never unmounted again, matching the Universe canvas panel's own
// lazy-mount-then-persist lifecycle in console-shell.tsx.

import dynamic from "next/dynamic";
import { useState } from "react";

import { useConsoleModeStore } from "../store/console-mode-store";
import { ChatComposer } from "./chat-composer";

const UniverseCommandBar = dynamic(
  () => import("./universe-command-bar").then((mod) => mod.UniverseCommandBar),
  { ssr: false },
);

export function FloatingIslandHost() {
  const mode = useConsoleModeStore((state) => state.mode);

  // Monotonic latch via a guarded render-phase setState (see console-shell.tsx
  // for the same pattern and why it's used instead of an effect or a ref
  // mutated during render).
  const [universeBarMounted, setUniverseBarMounted] = useState(mode === "universe");
  if (mode === "universe" && !universeBarMounted) {
    setUniverseBarMounted(true);
  }

  return (
    <div className="vx-island" role="region" aria-label="Composer">
      <div className="vx-island-surface">
        <div hidden={mode !== "chat"}>
          <ChatComposer />
        </div>
        {universeBarMounted && (
          <div hidden={mode !== "universe"}>
            <UniverseCommandBar />
          </div>
        )}
      </div>
    </div>
  );
}
