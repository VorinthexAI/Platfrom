"use client";

// neural-map.md §6.5's table — the universe-mode floating island content:
// fuzzy node search (fly-to on result click), a zoom-tier readout, and an
// "ask about what I'm looking at" quick-action that pivots to Chat with a
// seeded (never auto-sent) draft.
//
// This module statically imports from `@/features/universe/**` and is
// therefore only ever reached via floating-island-host.tsx's
// `next/dynamic({ ssr: false })` import — never import this file directly
// from a chat-only code path (§13.4).

import { useState } from "react";

import { useUniverseSearch } from "@/features/universe/data/use-universe-search";
import { useEngineSnapshot } from "@/features/universe/engine/engine-bridge";
import { useSelectionStore } from "@/features/universe/store/selection-store";
import { SearchIcon } from "@vorinthex/shared/ui";
import { ChatBubbleIcon } from "@vorinthex/shared/ui";

import { useConsoleModeStore } from "../store/console-mode-store";
import { usePendingChatDraftStore } from "../store/pending-chat-draft-store";

// Cross-agent contract: the universe engine's camera controller should
// listen for this event and fly the camera to the given node id. Invented
// here (not previously pinned anywhere in neural-map.md) — see this
// agent's final report for the exact contract relayed to the universe
// agent.
export const UNIVERSE_FLY_TO_EVENT = "vx:universe:fly-to";

// Mirrors `useUniverseSearch`'s pinned return shape (see this feature's
// cross-agent contract). Declared locally so the result list stays
// correctly typed even while `@/features/universe/data/use-universe-search`
// doesn't exist on disk yet.
type UniverseSearchResult = {
  id: string;
  label: string;
  type: string;
  position: [number, number, number];
};

export function UniverseCommandBar() {
  const [query, setQuery] = useState("");
  const [resultsOpen, setResultsOpen] = useState(false);

  // `useUniverseSearch` debounces internally (§34.4/§60 — ~200ms) and only
  // enables the query once it's non-trivially long; pass the raw value
  // straight through.
  const { data: results, isLoading } = useUniverseSearch(query);

  const snapshot = useEngineSnapshot();
  const select = useSelectionStore((state) => state.select);
  const setMode = useConsoleModeStore((state) => state.setMode);

  const handleSelectResult = (nodeId: string) => {
    select(nodeId);
    window.dispatchEvent(
      new CustomEvent(UNIVERSE_FLY_TO_EVENT, { detail: { nodeId } }),
    );
    setResultsOpen(false);
    setQuery("");
  };

  const handleAskAboutSelection = () => {
    const subject = snapshot?.breadcrumb ?? "this part of the universe";
    usePendingChatDraftStore
      .getState()
      .setDraft(`Tell me about what I'm looking at: ${subject}.`);
    setMode("chat");
  };

  const showResults = resultsOpen && query.trim().length >= 2;

  return (
    <div className="vx-universe-command-bar">
      <SearchIcon size="sm" variant="muted" aria-hidden />
      <input
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setResultsOpen(true);
        }}
        onFocus={() => setResultsOpen(true)}
        placeholder="Search the graph…"
        aria-label="Search the universe"
      />

      <span className="vx-universe-zoom-readout">
        {snapshot ? `${snapshot.regime} · Tier ${snapshot.zoomTier}` : "…"}
      </span>

      <button
        type="button"
        className="vx-universe-ask-button"
        onClick={handleAskAboutSelection}
        disabled={!snapshot}
      >
        <ChatBubbleIcon size="sm" aria-hidden />
        Ask about this
      </button>

      {showResults && (
        <div className="vx-universe-search-results">
          {isLoading && (
            <div className="vx-universe-search-empty">Searching…</div>
          )}
          {!isLoading && results && results.length === 0 && (
            <div className="vx-universe-search-empty">
              No nodes match &ldquo;{query}&rdquo;.
            </div>
          )}
          {!isLoading &&
            results?.map((result: UniverseSearchResult) => (
              <button
                key={result.id}
                type="button"
                className="vx-universe-search-result"
                onClick={() => handleSelectResult(result.id)}
              >
                <span>{result.label}</span>
                <span className="vx-universe-search-result-type">{result.type}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
