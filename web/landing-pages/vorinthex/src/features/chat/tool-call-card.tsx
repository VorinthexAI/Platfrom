"use client";

// neural-map.md §7.9/§8.4/§17.2 — renders a `search_universe` tool call as a
// distinct structured card rather than inline prose, with a "View in
// Universe" action that bridges Chat -> Universe mode.
//
// Cross-agent event contract (documented per the task brief): clicking
// "View in Universe" calls `useConsoleModeStore.getState().setMode("universe")`
// and then dispatches `window.dispatchEvent(new CustomEvent("vx:universe:fly-to",
// { detail: { nodeId } }))`. The universe engine (owned by another agent) is
// expected to add a `window.addEventListener("vx:universe:fly-to", ...)`
// listener that triggers the §8.4 fly-to camera transition for that node id.
// We can't import the universe engine directly (bundle-isolation, §13.4), so
// this DOM CustomEvent is the deliberate, documented seam between the two.
import { Badge, Card, Spinner } from "@vorinthex/shared/ui";
import { useConsoleModeStore } from "@/features/console/store/console-mode-store";

export type SearchResult = {
  id: string;
  label: string;
  type: string;
  position: [number, number, number];
};

export type ToolCallCardProps = {
  toolName: "search_universe";
  args: { query: string };
  /** null while the tool call is in flight. */
  result: SearchResult[] | null;
  onViewInUniverse: (nodeId: string) => void;
};

/** Default implementation of the Chat -> Universe bridge (§7.9). Exported so
 * callers can reuse it verbatim instead of re-deriving the event contract. */
export function flyToNodeInUniverse(nodeId: string) {
  useConsoleModeStore.getState().setMode("universe");
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("vx:universe:fly-to", { detail: { nodeId } }));
  }
}

export function ToolCallCard({ args, result, onViewInUniverse }: ToolCallCardProps) {
  return (
    <Card className="my-2 max-w-md border border-[var(--vx-console-border)] bg-[var(--vx-console-surface)] p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-[var(--vx-console-text-muted)]">
        <span aria-hidden="true">&#128269;</span>
        <span>Searched the universe for &ldquo;{args.query}&rdquo;</span>
      </div>

      {result === null ? (
        <div className="mt-2 flex items-center gap-2 text-sm text-[var(--vx-console-text-muted)]">
          <Spinner className="h-3.5 w-3.5" />
          <span>Searching&hellip;</span>
        </div>
      ) : result.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--vx-console-text-muted)]">No matches in the universe for that.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {result.map((node) => (
            <li key={node.id} className="flex items-center justify-between gap-2 text-sm text-[var(--vx-console-text)]">
              <span className="flex min-w-0 items-center gap-2">
                <Badge className="shrink-0 bg-[var(--vx-console-surface-raised)] text-[var(--vx-console-text-muted)]">
                  {node.type}
                </Badge>
                <span className="truncate">{node.label}</span>
              </span>
              <button
                type="button"
                onClick={() => onViewInUniverse(node.id)}
                className="shrink-0 text-xs font-medium text-[var(--vx-console-accent)] hover:underline"
              >
                View in Universe
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
