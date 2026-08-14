import { z } from "zod";
import { postEventStream } from "./api-client";
import { buildAudioGenerateRequest, generatedAudioChunkSchema, splitAudioGenerationText, type GeneratedAudioChunk } from "./audio-generation";
export type { GeneratedAudioChunk } from "./audio-generation";
export interface AudioClientDependencies { postEvents?: typeof postEventStream }

export async function streamGeneratedAudio(input: {
  organizationKey: string;
  agentKey: string;
  text: string;
  wordsPerChunk?: number;
  voice?: string;
  language?: string;
}, onChunk: (chunk: GeneratedAudioChunk) => void, signal?: AbortSignal, dependencies: AudioClientDependencies = {}) {
  const wordsPerChunk = input.wordsPerChunk ?? 100;
  let chunkOffset = 0;
  for (const segment of splitAudioGenerationText(input.text, wordsPerChunk)) {
    let serverError: string | undefined;
    let segmentChunks = 0;
    await (dependencies.postEvents ?? postEventStream)("/audio/generate", buildAudioGenerateRequest({ ...input, text: segment.text, wordsPerChunk }), (event) => {
      if (event.event === "chunk") {
        const chunk = generatedAudioChunkSchema.parse(JSON.parse(event.data));
        segmentChunks += 1;
        onChunk({ ...chunk, index: chunk.index + chunkOffset, startWord: chunk.startWord + segment.startWord, endWord: chunk.endWord + segment.startWord, startCharacter: chunk.startCharacter + segment.startCharacter, endCharacter: chunk.endCharacter + segment.startCharacter });
      }
      if (event.event === "error") serverError = z.object({ error: z.string() }).parse(JSON.parse(event.data)).error;
    }, signal);
    if (serverError) throw new Error(serverError);
    chunkOffset += segmentChunks;
  }
}
