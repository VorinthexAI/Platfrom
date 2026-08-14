import { describe, expect, test } from 'bun:test';
import { audioGenerateInputSchema, audioGenerateTool, generateAudioChunks, splitAudioText } from './audio-generate';

describe('audio.generate', () => {
  test('splits text into ordered word-bounded chunks with source offsets', () => {
    const words = Array.from({ length: 205 }, (_, index) => `word${index}`);
    const text = words.map((word, index) => `${word}${index === words.length - 1 ? '' : index % 2 === 0 ? '  ' : '\n'}`).join('');
    const result = splitAudioText({ text, wordsPerChunk: 100 });
    expect(result.totalWords).toBe(205);
    expect(result.chunks.map(({ startWord, endWord }) => [startWord, endWord])).toEqual([[0, 100], [100, 200], [200, 205]]);
    expect(result.chunks.every((chunk) => chunk.text === text.slice(chunk.startCharacter, chunk.endCharacter))).toBe(true);
  });

  test('keeps every Polly request under its billed character limit', () => {
    const text = Array.from({ length: 40 }, (_, index) => `${index}-${'x'.repeat(180)}`).join(' ');
    const result = splitAudioText({ text, wordsPerChunk: 100 });
    expect(result.chunks.length).toBeGreaterThan(1);
    expect(result.chunks.every((chunk) => chunk.text.length <= 2_800)).toBe(true);
    expect(result.chunks.at(-1)?.endWord).toBe(40);
  });

  test('rejects oversized individual words and excessive billable fan-out', () => {
    expect(() => splitAudioText({ text: 'x'.repeat(2_801), wordsPerChunk: 100 })).toThrow('Individual words cannot exceed 2800 characters');
    expect(() => splitAudioText({ text: Array.from({ length: 820 }, () => 'x').join(' '), wordsPerChunk: 20 })).toThrow('Audio generation cannot exceed 40 chunks');
  });

  test('generates MP3 chunks sequentially and exposes each completion', async () => {
    const calls: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const chunks = [];
    for await (const chunk of generateAudioChunks({ text: Array.from({ length: 45 }, (_, index) => `word${index}`).join(' '), wordsPerChunk: 20 }, {
      organizationKey: 'organization',
      async synthesize(input) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        calls.push(input.text);
        await Bun.sleep(1);
        active -= 1;
        return { audioBase64: Buffer.from(input.text).toString('base64'), mimeType: 'audio/mpeg' };
      },
    })) chunks.push(chunk);
    expect(chunks.map(({ index, startWord, endWord }) => [index, startWord, endWord])).toEqual([[0, 0, 20], [1, 20, 40], [2, 40, 45]]);
    expect(calls).toHaveLength(3);
    expect(maximumActive).toBe(1);
    expect(chunks.every(({ mimeType, audioBase64 }) => mimeType === 'audio/mpeg' && audioBase64.length > 0)).toBe(true);
  });

  test('collects the stream for ordinary tool execution and rejects unknown input', async () => {
    const result = await audioGenerateTool.execute({ text: 'one two three', wordsPerChunk: 20 }, { synthesize: async () => ({ audioBase64: 'bXAz', mimeType: 'audio/mp3' }) });
    expect(result).toMatchObject({ totalWords: 3, chunks: [{ index: 0, startWord: 0, endWord: 3, mimeType: 'audio/mpeg' }] });
    expect(() => audioGenerateInputSchema.parse({ text: 'hello', unexpected: true })).toThrow('Unrecognized key');
    expect(() => audioGenerateInputSchema.parse({ text: 'hello', wordsPerChunk: 19 })).toThrow();
  });
});
