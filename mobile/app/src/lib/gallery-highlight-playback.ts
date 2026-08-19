export const HIGHLIGHT_SLIDE_DURATION_MS = 3_000;

export type HighlightPlaybackState = {
  index: number;
  playing: boolean;
  progressMs: number;
};

export type HighlightPlaybackAction =
  | { type: "load"; slideCount: number; autoplay?: boolean }
  | { type: "play"; slideCount: number }
  | { type: "pause" }
  | { type: "previous" }
  | { type: "next"; slideCount: number }
  | { type: "tick"; elapsedMs: number; slideCount: number; durationMs?: number };

export const initialHighlightPlaybackState: HighlightPlaybackState = { index: 0, playing: false, progressMs: 0 };

export function reduceHighlightPlayback(state: HighlightPlaybackState, action: HighlightPlaybackAction): HighlightPlaybackState {
  if (action.type === "load") return { index: 0, playing: Boolean(action.autoplay && action.slideCount > 0), progressMs: 0 };
  if (action.type === "pause") return { ...state, playing: false };
  if (action.type === "play") {
    if (action.slideCount === 0) return state;
    return state.index >= action.slideCount - 1 && state.progressMs >= HIGHLIGHT_SLIDE_DURATION_MS
      ? { index: 0, playing: true, progressMs: 0 }
      : { ...state, playing: true };
  }
  if (action.type === "previous") return { index: Math.max(0, state.index - 1), playing: state.playing, progressMs: 0 };
  if (action.type === "next") {
    if (action.slideCount === 0) return initialHighlightPlaybackState;
    const final = state.index >= action.slideCount - 1;
    return final ? { index: state.index, playing: false, progressMs: 0 } : { index: state.index + 1, playing: state.playing, progressMs: 0 };
  }
  if (!state.playing || action.slideCount === 0) return state;
  const durationMs = action.durationMs ?? HIGHLIGHT_SLIDE_DURATION_MS;
  const progressMs = state.progressMs + Math.max(0, action.elapsedMs);
  if (progressMs < durationMs) return { ...state, progressMs };
  if (state.index >= action.slideCount - 1) return { ...state, playing: false, progressMs: durationMs };
  return { index: state.index + 1, playing: true, progressMs: progressMs - durationMs };
}
