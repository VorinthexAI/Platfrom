"use client";

// neural-map.md §9.1/§14.3 — the sole entry point other agents import.
// Dynamically imported by the console-shell agent via
// `next/dynamic(ssr:false)` (see cross-agent contract) — but bundle
// isolation (§13.4) requires one more level: even *this* file being loaded
// must not pull `three`/`@react-three/*` into the fetched chunk for a
// WebGL2-incapable device, since those users should never pay that download
// cost. So `./universe-canvas` (which statically imports `three`) is itself
// behind a nested `next/dynamic(ssr:false)`, only ever rendered once the
// capability check has already passed.

import { useState } from "react";
import dynamic from "next/dynamic";

import { readCapabilitySnapshot } from "@/lib/capability-snapshot";
import { DataGrid } from "@vorinthex/shared/ui";
import type { SerializedCameraState } from "./types";

const UniverseCanvas = dynamic(
  () => import("./universe-canvas").then((mod) => mod.UniverseCanvas),
  { ssr: false, loading: () => <UniverseSkeleton /> },
);

/** §8.7 — initial camera state is read from the URL itself, not props. */
function parseInitialCameraState(): SerializedCameraState | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const x = params.get("x");
  const y = params.get("y");
  const z = params.get("z");
  if (x === null || y === null || z === null) return null;

  const parsedX = Number(x);
  const parsedY = Number(y);
  const parsedZ = Number(z);
  if ([parsedX, parsedY, parsedZ].some((n) => Number.isNaN(n))) return null;

  return {
    x: parsedX,
    y: parsedY,
    z: parsedZ,
    yaw: Number(params.get("yaw") ?? 0) || 0,
    pitch: Number(params.get("pitch") ?? -0.15) || -0.15,
    tier: Number(params.get("tier") ?? 0) || 0,
    focus: params.get("focus"),
  };
}

function UniverseSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading universe"
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background: "#0b0d10",
        color: "#9ba1ac",
        fontSize: 13,
      }}
    >
      Loading the universe…
    </div>
  );
}

/** §14.3's first row — a positively-framed 2D fallback, never an error banner. */
function UniverseListFallback() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "auto",
        padding: 24,
        background: "#0b0d10",
        color: "#edeff2",
      }}
    >
      <h2 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 600 }}>
        Explore as a list
      </h2>
      <p style={{ margin: "0 0 20px", fontSize: 13, color: "#9ba1ac" }}>
        Your browser or device doesn&apos;t support the interactive 3D view,
        so here&apos;s a searchable, filterable list of the graph instead.
      </p>
      <DataGrid />
    </div>
  );
}

export function UniverseCanvasBoundary() {
  const [initialCameraState] = useState<SerializedCameraState | null>(() =>
    parseInitialCameraState(),
  );
  const [capability] = useState(() => readCapabilitySnapshot());

  if (!capability.webgl2) {
    return <UniverseListFallback />;
  }

  return <UniverseCanvas initialCameraState={initialCameraState} />;
}

export default UniverseCanvasBoundary;
