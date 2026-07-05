"use client";

import dynamic from "next/dynamic";

const OrbitScene = dynamic(
  () => import("./orbit-scene").then((mod) => mod.OrbitScene),
  { ssr: false, loading: () => <ScenePlaceholder /> },
);

export function OrbitSceneLoader({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <OrbitScene />
    </div>
  );
}

function ScenePlaceholder() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div
        className="h-[45%] max-h-[280px] w-[45%] max-w-[280px] animate-pulse rounded-full"
        style={{
          background:
            "radial-gradient(circle at 32% 28%, #2a2b31 0%, #1b1c20 45%, #0c0d0f 78%)",
        }}
      />
    </div>
  );
}
