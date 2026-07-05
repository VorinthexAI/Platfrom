"use client";

// neural-map.md §6.1, §6.3, §6.3.1 — the console shell client component.
// Owns: the header, the floating island host (mounted once), and the
// CSS-grid body area that hosts both the chat and universe panels
// off-tree, toggled by visibility (never unmount/remount, never a route
// push) so WebGL context and chat scroll position survive every toggle.

import { useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";

import type { Session } from "@/server/dal/session";
import { EmptyState } from "@vorinthex/shared/ui";

import { useConsoleModeStore } from "./store/console-mode-store";
import { ConsoleHeader } from "./console-header/console-header";
import { FloatingIslandHost } from "./floating-island/floating-island-host";

// Dynamic-imported with `ssr: false` so `three`/`@react-three/*` never end
// up in the chat-only initial bundle (neural-map.md §13.4, §9.1). This is
// the load-bearing mechanism referenced throughout §6 — do not switch this
// to a static import.
const UniverseCanvasBoundary = dynamic(
  () =>
    import("@/features/universe/universe-canvas-boundary").then(
      (mod) => mod.UniverseCanvasBoundary,
    ),
  { ssr: false },
);

type ConsoleShellProps = {
  session: Session;
  children: ReactNode;
};

export function ConsoleShell({ session, children }: ConsoleShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const mode = useConsoleModeStore((state) => state.mode);

  // Which route segment Next actually rendered `children` for on this
  // request — captured once and never re-derived. Both panels are always
  // treated symmetrically after this point (§6.3.1): the toggle mechanic
  // itself is fully decoupled from routing, so this only matters for
  // deciding which slot gets the real routed `children` vs. an off-tree
  // mount.
  const [entryMode] = useState<"chat" | "universe">(() =>
    pathname?.startsWith("/console/u") ? "universe" : "chat",
  );

  // The Universe panel lazy-mounts on first visit to universe mode (don't
  // pay its bundle/WebGL-context cost for chat-only users) and, once
  // mounted, is never unmounted again for the rest of the session (§6.3).
  // A monotonic latch: setting state directly during render (guarded so it
  // only fires once) is React's documented pattern for "adjusting state
  // when a prop/store value changes" — see
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders.
  // This intentionally avoids both an effect (which would cost an extra
  // render pass) and a ref mutation during render (which React Compiler's
  // lint rules forbid outright).
  const [universeMounted, setUniverseMounted] = useState(
    entryMode === "universe" || mode === "universe",
  );
  if (mode === "universe" && !universeMounted) {
    setUniverseMounted(true);
  }

  // Remember the most recently seen URL for each mode, so toggling back
  // restores exactly where the user left off (real thread id, camera query
  // string, etc) rather than resetting to a bare `/console/c/new` or
  // `/console/u`.
  const chatUrlRef = useRef(
    entryMode === "chat" ? currentUrl(pathname, searchParams) : "/console/c/new",
  );
  const universeUrlRef = useRef(
    entryMode === "universe" ? currentUrl(pathname, searchParams) : "/console/u",
  );

  useEffect(() => {
    const full = currentUrl(pathname, searchParams);
    if (mode === "chat") chatUrlRef.current = full;
    else universeUrlRef.current = full;
    // Only the active mode's URL should be trusted as "current" — the
    // inactive mode's panel doesn't navigate while hidden.
  }, [pathname, searchParams, mode]);

  // Per §6.3: toggling is client-side visibility, never a route push. This
  // keeps the address bar accurate for deep-linking/sharing via
  // `history.replaceState`, which does not trigger RSC navigation.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const target = mode === "chat" ? chatUrlRef.current : universeUrlRef.current;
    const active = window.location.pathname + window.location.search;
    if (active !== target) {
      window.history.replaceState(null, "", target);
    }
  }, [mode]);

  return (
    <div className="vx-console-root" data-console-theme="dark">
      <ConsoleHeader session={session} />
      <div className="vx-console-body">
        <div hidden={mode !== "chat"}>
          {entryMode === "chat" ? (
            children
          ) : (
            // The user's very first hit this session was a shared universe
            // link (§6.3.1) — there's no routed chat page to fall back on
            // here since (chat)'s page.tsx never rendered for this
            // request. This is a deliberately minimal placeholder; the
            // always-mounted floating-island composer (below) remains
            // fully usable regardless, and sending a message will create
            // a real thread the normal way. See the final report's
            // coordination note for the chat agent.
            <ChatSlotFallback />
          )}
        </div>
        {universeMounted && (
          <div hidden={mode !== "universe"}>
            {entryMode === "universe" ? children : <UniverseCanvasBoundary />}
          </div>
        )}
      </div>
      <FloatingIslandHost />
    </div>
  );
}

function currentUrl(
  pathname: string | null,
  searchParams: URLSearchParams,
): string {
  const path = pathname ?? "/console/c/new";
  const query = searchParams.size ? `?${searchParams.toString()}` : "";
  return `${path}${query}`;
}

function ChatSlotFallback() {
  return (
    <div className="vx-console-chat-fallback">
      <EmptyState>
        <p>Ask anything — about your data, your graph, or just to think something through.</p>
      </EmptyState>
    </div>
  );
}
