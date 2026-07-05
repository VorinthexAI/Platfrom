// Client capability detection (neural-map.md §14.2). Read synchronously by
// the console shell/Universe boundary before first paint, via
// `src/instrumentation-client.ts`, so the "3D vs. degraded" decision never
// causes a post-hydration flash.

export type MemoryClass = "low" | "standard" | "unknown";

export type CapabilitySnapshot = {
  webgl2: boolean;
  reducedMotion: boolean;
  memoryClass: MemoryClass;
};

const STORAGE_KEY = "vx_capability_snapshot";

let cached: CapabilitySnapshot | null = null;

export function detectWebGL2Support(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2"));
  } catch {
    return false;
  }
}

export function estimateDeviceMemoryClass(): MemoryClass {
  if (typeof navigator === "undefined") return "unknown";
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number })
    .deviceMemory;
  if (typeof deviceMemory === "number") {
    return deviceMemory <= 2 ? "low" : "standard";
  }
  const isMobileUA = /Mobi|Android/i.test(navigator.userAgent ?? "");
  return isMobileUA ? "low" : "unknown";
}

export function detectCapabilitySnapshot(): CapabilitySnapshot {
  const reducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
  return {
    webgl2: detectWebGL2Support(),
    reducedMotion,
    memoryClass: estimateDeviceMemoryClass(),
  };
}

export function writeCapabilitySnapshot(snapshot: CapabilitySnapshot): void {
  cached = snapshot;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // sessionStorage unavailable (private mode, etc.) — in-memory cache still works.
  }
}

/** Reads the snapshot written by `instrumentation-client.ts`, falling back to a fresh detection pass. */
export function readCapabilitySnapshot(): CapabilitySnapshot {
  if (cached) return cached;
  if (typeof window !== "undefined") {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        cached = JSON.parse(raw) as CapabilitySnapshot;
        return cached;
      }
    } catch {
      // fall through to live detection
    }
  }
  cached = detectCapabilitySnapshot();
  return cached;
}
