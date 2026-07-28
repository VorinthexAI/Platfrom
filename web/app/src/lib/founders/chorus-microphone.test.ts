import { describe, expect, test } from "bun:test";
import { appendSpokenTranscript, encodePcm16, trimRecordedSilence } from "./chorus-microphone";

const mentions = [
  { participantKey: "p1", type: "orchestrator" as const, key: "atlas", name: "Atlas", role: "CEO", mentionCount: 0 },
  { participantKey: "everyone", type: "everyone" as const, key: "everyone", name: "everyone", mentionCount: 0 },
];

describe("Chorus microphone helpers", () => {
  test("encodes downsampled little-endian PCM16", () => {
    const encoded = encodePcm16(new Float32Array([-1, 0, 1, 0]), 48_000);
    expect(Buffer.from(encoded, "base64")).toEqual(Buffer.from([0, 128, 255, 127]));
  });

  test("appends speech and converts spoken mentions", () => {
    expect(appendSpokenTranscript("Plan:", "At Atlas, notify at everyone.", mentions)).toBe("Plan: @Atlas, notify @everyone.");
    expect(appendSpokenTranscript("Ask ", "@atlas now", mentions)).toBe("Ask @Atlas now");
  });

  test("trims silence while preserving a small speech boundary", () => {
    const samples = new Float32Array([0, 0, 0.02, 0.3, 0.02, 0, 0]);
    const trimmed = trimRecordedSilence(samples, 10);
    expect(trimmed).toHaveLength(5);
    expect(trimmed[1]).toBeCloseTo(0.02);
    expect(trimmed[2]).toBeCloseTo(0.3);
    expect(trimRecordedSilence(new Float32Array([0, 0]), 10)).toHaveLength(0);
  });
});
