export type TimedAudioChunk = { durationMs: number };

export function audioTimelineDuration(chunks: TimedAudioChunk[]) {
  return chunks.reduce((total, chunk) => total + chunk.durationMs / 1_000, 0);
}

export function audioTimelinePosition(chunks: TimedAudioChunk[], activeIndex: number, currentSeconds: number) {
  return chunks.slice(0, Math.max(0, activeIndex)).reduce((total, chunk) => total + chunk.durationMs / 1_000, 0) + Math.max(0, currentSeconds);
}

export function resolveAudioTimelinePosition(chunks: TimedAudioChunk[], requestedSeconds: number) {
  if (chunks.length === 0) return { index: 0, seconds: 0 };
  const total = audioTimelineDuration(chunks);
  const target = Math.min(total, Math.max(0, requestedSeconds));
  let start = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const duration = chunks[index]!.durationMs / 1_000;
    if (target < start + duration || index === chunks.length - 1) return { index, seconds: Math.min(duration, Math.max(0, target - start)) };
    start += duration;
  }
  return { index: chunks.length - 1, seconds: chunks.at(-1)!.durationMs / 1_000 };
}

export function formatAudioTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
