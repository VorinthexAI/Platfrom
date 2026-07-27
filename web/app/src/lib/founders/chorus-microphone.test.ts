import { describe, expect, test } from "bun:test";
import { appendSpokenTranscript, encodePcm16 } from "./chorus-microphone";

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
});
