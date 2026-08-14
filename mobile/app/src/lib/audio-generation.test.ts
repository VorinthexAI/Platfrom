import { expect, test } from "bun:test";
import { buildAudioGenerateRequest, generatedAudioChunkSchema, splitAudioGenerationText } from "./audio-generation";

test("builds a default one-hundred-word audio generation request", () => {
  expect(buildAudioGenerateRequest({ organizationKey: "organization", agentKey: "agent", text: "Read this." })).toEqual({ organizationKey: "organization", agentKey: "agent", input: { text: "Read this.", wordsPerChunk: 100 } });
});

test("preserves explicit generation controls without adding empty options", () => {
  expect(buildAudioGenerateRequest({ organizationKey: "organization", agentKey: "agent", text: "Läs detta.", wordsPerChunk: 80, voice: "Elin", language: "sv-SE" })).toEqual({ organizationKey: "organization", agentKey: "agent", input: { text: "Läs detta.", wordsPerChunk: 80, voice: "Elin", language: "sv-SE" } });
});

test("accepts complete MP3 chunks and rejects malformed stream data", () => {
  expect(generatedAudioChunkSchema.parse({ index: 0, startWord: 0, endWord: 2, startCharacter: 0, endCharacter: 9, audioBase64: "bXAz", mimeType: "audio/mpeg" })).toMatchObject({ index: 0, endWord: 2 });
  expect(() => generatedAudioChunkSchema.parse({ index: 0, audioBase64: "bXAz", mimeType: "audio/wav" })).toThrow();
});

test("splits very large documents into ordered bounded generation requests", () => {
  const text = Array.from({ length: 48_005 }, (_, index) => `word${index}`).join(" ");
  const segments = splitAudioGenerationText(text, 100);
  expect(segments.length).toBeGreaterThan(1);
  expect(segments.every((segment) => segment.text.length <= 120_000)).toBe(true);
  expect(segments.map(({ startWord }) => startWord)).toEqual([...segments.map(({ startWord }) => startWord)].sort((a, b) => a - b));
  expect(segments.map(({ text: value }) => value).join(" ")).toBe(text);
});

test("rejects an individual document token that cannot fit a request", () => {
  expect(() => splitAudioGenerationText("x".repeat(2_801))).toThrow("single document word");
});

test("mirrors Polly character chunking when segmenting long words", () => {
  const text = Array.from({ length: 41 }, () => "x".repeat(1_400)).join(" ");
  expect(splitAudioGenerationText(text, 100)).toHaveLength(2);
});
