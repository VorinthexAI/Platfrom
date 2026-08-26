export type ReplacementLoadState = {
  id: number;
  requestId: number;
  observedUnload: boolean;
};

export function beginReplacement(id: number, requestId: number, isLoaded: boolean): ReplacementLoadState {
  return { id, requestId, observedUnload: !isLoaded };
}

export function observeReplacementLoad(state: ReplacementLoadState, requestId: number, replacementId: number, isLoaded: boolean) {
  if (state.requestId !== requestId || state.id !== replacementId) return { state, ready: false };
  if (!isLoaded && !state.observedUnload) return { state: { ...state, observedUnload: true }, ready: false };
  return { state, ready: isLoaded && state.observedUnload };
}

export function clampBookPlaybackSeek(seconds: number, duration: number) {
  const safeSeconds = Number.isFinite(seconds) ? seconds : 0;
  const safeDuration = Number.isFinite(duration) ? duration : 0;
  return Math.max(0, Math.min(safeSeconds, safeDuration));
}
