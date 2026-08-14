import { z } from 'zod';
import { executeAction, type ExecuteActionOptions } from '@/lib/ai/router';
import { speechInputSchema, type SpeechOutput } from '@/lib/ai/providers';
import { mp3DurationMs } from '@/lib/ai/audio/mp3-duration';

export const AUDIO_GENERATE_MAX_TEXT_CHARACTERS = 120_000;
const MAX_POLLY_CHUNK_CHARACTERS = 2_800;
const MAX_AUDIO_CHUNKS = 40;

function planAudioChunks(text: string, wordsPerChunk: number) {
  const words = [...text.matchAll(/\S+/gu)].map((match) => ({ start: match.index, end: match.index + match[0].length }));
  const chunks: Array<{ index: number; text: string; startWord: number; endWord: number; startCharacter: number; endCharacter: number }> = [];
  let startWord = 0;
  while (startWord < words.length) {
    let endWord = Math.min(startWord + wordsPerChunk, words.length);
    while (endWord > startWord + 1 && words[endWord - 1]!.end - words[startWord]!.start > MAX_POLLY_CHUNK_CHARACTERS) endWord -= 1;
    const startCharacter = words[startWord]!.start;
    const endCharacter = words[endWord - 1]!.end;
    chunks.push({ index: chunks.length, text: text.slice(startCharacter, endCharacter), startWord, endWord, startCharacter, endCharacter });
    startWord = endWord;
  }
  return { chunks, words };
}

export const audioGenerateInputSchema = z.object({
  text: z.string().trim().min(1).max(AUDIO_GENERATE_MAX_TEXT_CHARACTERS),
  wordsPerChunk: z.number().int().min(20).max(200).default(100),
  voice: z.string().trim().min(1).max(120).default('Joanna'),
  language: z.string().trim().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/).optional(),
}).strict().superRefine((input, context) => {
  const plan = planAudioChunks(input.text, input.wordsPerChunk);
  if (plan.words.some((word) => word.end - word.start > MAX_POLLY_CHUNK_CHARACTERS)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['text'], message: `Individual words cannot exceed ${MAX_POLLY_CHUNK_CHARACTERS} characters.` });
  if (plan.chunks.length > MAX_AUDIO_CHUNKS) context.addIssue({ code: z.ZodIssueCode.custom, path: ['text'], message: `Audio generation cannot exceed ${MAX_AUDIO_CHUNKS} chunks.` });
});

export const audioGenerateChunkSchema = z.object({
  index: z.number().int().nonnegative(),
  startWord: z.number().int().nonnegative(),
  endWord: z.number().int().positive(),
  startCharacter: z.number().int().nonnegative(),
  endCharacter: z.number().int().positive(),
  audioBase64: z.string().min(1),
  mimeType: z.literal('audio/mpeg'),
  durationMs: z.number().int().positive(),
}).strict();

export const audioGenerateOutputSchema = z.object({
  chunks: z.array(audioGenerateChunkSchema),
  totalWords: z.number().int().positive(),
}).strict();

export type AudioGenerateInput = z.infer<typeof audioGenerateInputSchema>;
export type AudioGenerateChunk = z.infer<typeof audioGenerateChunkSchema>;
export type AudioGenerateOutput = z.infer<typeof audioGenerateOutputSchema>;

export interface AudioGenerateDependencies extends ExecuteActionOptions {
  organizationKey?: string;
  synthesize?: (input: z.output<typeof speechInputSchema>, signal?: AbortSignal) => Promise<SpeechOutput>;
  duration?: (bytes: Uint8Array) => number;
}

export function splitAudioText(rawInput: unknown) {
  const input = audioGenerateInputSchema.parse(rawInput);
  const { chunks, words } = planAudioChunks(input.text, input.wordsPerChunk);
  return { input, chunks, totalWords: words.length };
}

export async function* generateAudioChunks(rawInput: unknown, dependencies: AudioGenerateDependencies = {}): AsyncGenerator<AudioGenerateChunk> {
  const { input, chunks } = splitAudioText(rawInput);
  const organizationKey = dependencies.organizationKey ?? 'nexus';
  for (const chunk of chunks) {
    dependencies.signal?.throwIfAborted();
    const speechInput = speechInputSchema.parse({ text: chunk.text, voice: input.voice, language: input.language, format: 'mp3' });
    const output = dependencies.synthesize
      ? await dependencies.synthesize(speechInput, dependencies.signal)
      : (await executeAction<typeof speechInput, SpeechOutput>({
          mode: 'fixed',
          organizationKey,
          actionSlug: 'generate-speech',
          modelSlug: 'amazon.polly-generative',
          providerSlug: 'aws-polly',
        }, speechInput, dependencies)).output;
    const parsed = z.object({ audioBase64: z.string().min(1), mimeType: z.enum(['audio/mpeg', 'audio/mp3']) }).parse(output);
    const audioBytes = new Uint8Array(Buffer.from(parsed.audioBase64, 'base64'));
    const { text: _text, ...metadata } = chunk;
    yield audioGenerateChunkSchema.parse({ ...metadata, audioBase64: parsed.audioBase64, mimeType: 'audio/mpeg', durationMs: (dependencies.duration ?? mp3DurationMs)(audioBytes) });
  }
}

export const audioGenerateTool = {
  name: 'audio.generate',
  inputSchema: audioGenerateInputSchema,
  providerDefinition: {
    name: 'audio.generate',
    description: 'Generate ordered MP3 speech chunks from supplied text using reliable text-to-speech.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      additionalProperties: false,
      properties: {
        text: { type: 'string', minLength: 1, maxLength: AUDIO_GENERATE_MAX_TEXT_CHARACTERS },
        wordsPerChunk: { type: 'integer', minimum: 20, maximum: 200, default: 100 },
        voice: { type: 'string', minLength: 1, maxLength: 120, default: 'Joanna' },
        language: { type: 'string', pattern: '^[a-z]{2,3}(?:-[A-Z]{2})?$' },
      },
    },
  },
  generate: generateAudioChunks,
  async execute(rawInput: unknown, dependencies: AudioGenerateDependencies = {}): Promise<AudioGenerateOutput> {
    const { totalWords } = splitAudioText(rawInput);
    const chunks: AudioGenerateChunk[] = [];
    for await (const chunk of generateAudioChunks(rawInput, dependencies)) chunks.push(chunk);
    return audioGenerateOutputSchema.parse({ chunks, totalWords });
  },
} as const;
