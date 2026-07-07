import { EventEmitter } from 'node:events';

/**
 * Tiny in-process singleton bus that lets write paths (fragment collects,
 * waitlist joins/verifications) nudge the live SSE stream immediately instead
 * of waiting for its next poll tick.
 */
export const liveBus = new EventEmitter();
// Every open SSE connection registers a listener; don't warn on fan-out.
liveBus.setMaxListeners(0);

export const COUNTERS_DIRTY_EVENT = 'counters-dirty';

export function notifyCountersDirty() {
  liveBus.emit(COUNTERS_DIRTY_EVENT);
}
