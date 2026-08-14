import { z } from "zod";

export const generatedAudioChunkSchema = z.object({
  index: z.number().int().nonnegative(),
  startWord: z.number().int().nonnegative(),
  endWord: z.number().int().positive(),
  startCharacter: z.number().int().nonnegative(),
  endCharacter: z.number().int().positive(),
  audioBase64: z.string().min(1),
  mimeType: z.literal("audio/mpeg"),
}).strict();

export type GeneratedAudioChunk = z.infer<typeof generatedAudioChunkSchema>;
const MAX_POLLY_CHUNK_CHARACTERS = 2_800;
const MAX_REQUEST_CHUNKS = 40;

export function splitAudioGenerationText(text: string, wordsPerChunk = 100) {
  const words = [...text.matchAll(/\S+/gu)].map((match) => ({ start: match.index, end: match.index + match[0].length }));
  if (words.some((word) => word.end - word.start > MAX_POLLY_CHUNK_CHARACTERS)) throw new Error(`A single document word exceeds ${MAX_POLLY_CHUNK_CHARACTERS} characters.`);
  const chunks: { startWord: number; endWord: number }[] = [];
  let chunkStartWord = 0;
  while (chunkStartWord < words.length) {
    let chunkEndWord = Math.min(chunkStartWord + wordsPerChunk, words.length);
    while (chunkEndWord > chunkStartWord + 1 && words[chunkEndWord - 1]!.end - words[chunkStartWord]!.start > MAX_POLLY_CHUNK_CHARACTERS) chunkEndWord -= 1;
    chunks.push({ startWord: chunkStartWord, endWord: chunkEndWord });
    chunkStartWord = chunkEndWord;
  }
  const segments: { text: string; startCharacter: number; startWord: number }[] = [];
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += MAX_REQUEST_CHUNKS) {
    const group = chunks.slice(chunkIndex, chunkIndex + MAX_REQUEST_CHUNKS);
    const startWord = group[0]!.startWord;
    const endWord = group.at(-1)!.endWord;
    const startCharacter = words[startWord]!.start;
    segments.push({ text: text.slice(startCharacter, words[endWord - 1]!.end), startCharacter, startWord });
  }
  return segments;
}

export function buildAudioGenerateRequest(input: {
  organizationKey: string;
  agentKey: string;
  text: string;
  wordsPerChunk?: number;
  voice?: string;
  language?: string;
}) {
  return {
    organizationKey: input.organizationKey,
    agentKey: input.agentKey,
    input: {
      text: input.text,
      wordsPerChunk: input.wordsPerChunk ?? 100,
      ...(input.voice ? { voice: input.voice } : {}),
      ...(input.language ? { language: input.language } : {}),
    },
  };
}
