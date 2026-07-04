"use client";

// Small colocated helper, not in the original file list but required to
// satisfy neural-map.md §13.4/§9.1's hard rule: nothing under
// `@/features/universe/**` may be statically imported from a file that's
// part of the chat-only initial render path. `console-header.tsx` renders
// in both modes (it's part of the always-mounted shell chrome), so this
// breadcrumb — which reads the engine snapshot via
// `@/features/universe/engine/engine-bridge` — is split into its own
// module and pulled in via `next/dynamic({ ssr: false })` from
// console-header.tsx, only once the user has actually visited Universe
// mode. See console-header.tsx's import site.

import { useEngineSnapshot } from "@/features/universe/engine/engine-bridge";

export function UniverseBreadcrumb() {
  const snapshot = useEngineSnapshot();
  return (
    <span className="vx-console-breadcrumb">
      {snapshot?.breadcrumb ?? "Universe"}
    </span>
  );
}
