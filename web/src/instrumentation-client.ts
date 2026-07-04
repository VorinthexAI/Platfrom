// Next.js 16 `instrumentation-client.ts` convention (neural-map.md §3.6,
// §14.2): runs before the app's client bundle mounts anything, so the
// WebGL2/reduced-motion/memory-class capability snapshot is available
// synchronously on first render — avoiding a layout flash where the
// Universe toggle briefly renders in one mode then re-renders once
// detection resolves later.

import {
  detectCapabilitySnapshot,
  writeCapabilitySnapshot,
} from "@/lib/capability-snapshot";

export function register() {
  writeCapabilitySnapshot(detectCapabilitySnapshot());
}
