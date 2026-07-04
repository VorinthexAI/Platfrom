"use client";

// neural-map.md §8.1 (R3 "Inspect") — the floating (non-modal) node detail
// panel: properties, neighbor count (§10.4.3's "+N more" cap), and the
// "Ask about this in Chat" cross-mode handoff (cross-agent contract: seeds
// `usePendingChatDraftStore` then flips `useConsoleModeStore` to "chat" —
// never auto-sends). Styled via the console-shell's existing
// `.vx-node-detail-card` class (console-theme.css, owned by another agent);
// finer layout here uses inline styles rather than adding new global
// classNames to a stylesheet this agent doesn't own.

import { useConsoleModeStore } from "@/features/console/store/console-mode-store";
import { usePendingChatDraftStore } from "@/features/console/store/pending-chat-draft-store";
import { useNodeDetail } from "./data/use-node-detail";
import { useSelectionStore } from "./store/selection-store";

const NEIGHBOR_DISPLAY_CAP = 200; // mirrors §10.4.3's hard LIMIT 200

export type NodeDetailCardProps = { nodeId: string };

export function NodeDetailCard({ nodeId }: NodeDetailCardProps) {
  const { data, isLoading, isError } = useNodeDetail(nodeId);
  const select = useSelectionStore((s) => s.select);

  const handleAskAboutThis = () => {
    if (!data) return;
    usePendingChatDraftStore
      .getState()
      .setDraft(`Tell me about "${data.label}" (${data.type}) in the graph.`);
    useConsoleModeStore.getState().setMode("chat");
  };

  return (
    <section
      className="vx-node-detail-card"
      aria-label={data ? `${data.label} details` : "Node details"}
    >
      <button
        type="button"
        onClick={() => select(null)}
        aria-label="Close node details"
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          background: "transparent",
          border: "none",
          color: "inherit",
          opacity: 0.6,
          fontSize: 16,
          lineHeight: 1,
          cursor: "pointer",
          padding: 4,
        }}
      >
        &times;
      </button>

      {isLoading && <p style={{ fontSize: 13, opacity: 0.7 }}>Loading…</p>}
      {isError && (
        <p style={{ fontSize: 13, opacity: 0.7 }}>
          Couldn&apos;t load this node. It may have been removed.
        </p>
      )}

      {data && (
        <>
          <h2 style={{ margin: "0 24px 4px 0", fontSize: 16, fontWeight: 600 }}>
            {data.label}
          </h2>
          <p
            style={{
              margin: "0 0 12px",
              fontSize: 11,
              opacity: 0.6,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {data.type}
          </p>

          {data.neighborCount === 0 ? (
            // §8.2's designed destination, not an error: a genuine leaf.
            <p style={{ fontSize: 13, opacity: 0.85, margin: "0 0 12px" }}>
              You&apos;ve reached the edge of the known universe here — this
              node has no further connections to explore.
            </p>
          ) : (
            <p style={{ fontSize: 13, opacity: 0.85, margin: "0 0 12px" }}>
              {data.neighborCount} connection
              {data.neighborCount === 1 ? "" : "s"}
              {data.neighborCount > NEIGHBOR_DISPLAY_CAP
                ? ` (+${data.neighborCount - NEIGHBOR_DISPLAY_CAP} more)`
                : ""}
            </p>
          )}

          {Object.keys(data.properties).length > 0 && (
            <dl
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                columnGap: 10,
                rowGap: 4,
                fontSize: 13,
                margin: "0 0 16px",
              }}
            >
              {Object.entries(data.properties).map(([key, value]) => (
                <PropertyRow key={key} label={key} value={value} />
              ))}
            </dl>
          )}

          <button
            type="button"
            className="vx-universe-ask-button"
            onClick={handleAskAboutThis}
          >
            Ask about this in Chat
          </button>
        </>
      )}
    </section>
  );
}

function PropertyRow({ label, value }: { label: string; value: unknown }) {
  return (
    <>
      <dt style={{ opacity: 0.6, margin: 0 }}>{label}</dt>
      <dd style={{ margin: 0, wordBreak: "break-word" }}>
        {formatPropertyValue(value)}
      </dd>
    </>
  );
}

function formatPropertyValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
