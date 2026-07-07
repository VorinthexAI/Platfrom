"use client";

import { useSyncExternalStore } from "react";

let cached: boolean | undefined;

function detectWebGL(): boolean {
  if (cached === undefined) {
    try {
      const canvas = document.createElement("canvas");
      cached = Boolean(
        canvas.getContext("webgl2") ?? canvas.getContext("webgl"),
      );
    } catch {
      cached = false;
    }
  }
  return cached;
}

const emptySubscribe = () => () => {};

/**
 * WebGL availability. Returns `null` during SSR/hydration so callers can
 * defer rendering the canvas, then the real capability after hydration.
 */
export function useWebGLSupport(): boolean | null {
  return useSyncExternalStore(
    emptySubscribe,
    detectWebGL,
    () => null,
  );
}
