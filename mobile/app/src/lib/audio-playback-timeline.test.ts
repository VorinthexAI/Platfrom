import { describe, expect, test } from "bun:test";
import { audioTimelineDuration, audioTimelinePosition, formatAudioTime, resolveAudioTimelinePosition } from "./audio-playback-timeline";

const chunks = [{ durationMs: 10_000 }, { durationMs: 20_000 }, { durationMs: 5_000 }];

describe("audio playback timeline", () => {
  test("calculates global duration and active position", () => {
    expect(audioTimelineDuration(chunks)).toBe(35);
    expect(audioTimelinePosition(chunks, 1, 4.5)).toBe(14.5);
  });

  test("maps global positions across chunk boundaries", () => {
    expect(resolveAudioTimelinePosition(chunks, 0)).toEqual({ index: 0, seconds: 0 });
    expect(resolveAudioTimelinePosition(chunks, 10)).toEqual({ index: 1, seconds: 0 });
    expect(resolveAudioTimelinePosition(chunks, 29)).toEqual({ index: 1, seconds: 19 });
    expect(resolveAudioTimelinePosition(chunks, 31)).toEqual({ index: 2, seconds: 1 });
  });

  test("clamps seeks outside the generated timeline", () => {
    expect(resolveAudioTimelinePosition(chunks, -2)).toEqual({ index: 0, seconds: 0 });
    expect(resolveAudioTimelinePosition(chunks, 80)).toEqual({ index: 2, seconds: 5 });
    expect(resolveAudioTimelinePosition([], 4)).toEqual({ index: 0, seconds: 0 });
  });

  test("formats elapsed and total time", () => {
    expect(formatAudioTime(0)).toBe("0:00");
    expect(formatAudioTime(65.9)).toBe("1:05");
  });
});
