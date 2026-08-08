import { describe, expect, test } from 'bun:test';
import { DOCUMENT_CHUNK_MAX_CHARACTERS, DOCUMENT_CHUNK_MAX_WORDS, DOCUMENT_MAX_CHUNKS, chunkDocumentContent, chunkDocumentText, documentTextChunksSchema } from './chunking';

const words = (count: number, prefix = 'word') => Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(' ');

describe('document text chunking', () => {
  test('caps chunks at 1000 words without overlap or omissions', () => {
    const input = words(2_105);
    const chunks = chunkDocumentText(input);
    expect(chunks.map(({ wordCount }) => wordCount)).toEqual([1_000, 1_000, 105]);
    expect(chunks.map(({ text }) => text).join('')).toBe(input);
    expect(chunks.every(({ wordCount }) => wordCount <= DOCUMENT_CHUNK_MAX_WORDS)).toBe(true);
  });

  test('prefers paragraph and sentence boundaries', () => {
    const firstParagraph = `${words(600, 'first')}!`;
    const secondParagraph = `${words(500, 'second')}.`;
    const sentenceSplit = `${words(600, 'alpha')}. ${words(500, 'beta')}.`;

    expect(chunkDocumentText(`${firstParagraph}\n\n${secondParagraph}`).map(({ text }) => text.trim())).toEqual([firstParagraph, secondParagraph]);
    expect(chunkDocumentText(sentenceSplit).map(({ wordCount }) => wordCount)).toEqual([600, 500]);
  });

  test('is deterministic, ignores empty input, and bounds a single long token', () => {
    const input = `  First sentence.\r\n\r\nSecond   paragraph?  `;
    expect(chunkDocumentText(input)).toEqual(chunkDocumentText(input));
    expect(chunkDocumentText(' \n\n ')).toEqual([]);
    const longToken = 'x'.repeat(20_000);
    const chunks = chunkDocumentText(longToken);
    expect(chunks.map(({ text }) => text).join('')).toBe(longToken);
    expect(chunks.every(({ text }) => text.length <= DOCUMENT_CHUNK_MAX_CHARACTERS)).toBe(true);
  });

  test('exports storage-ready chunk validation', () => {
    expect(documentTextChunksSchema.safeParse(chunkDocumentText('one two')).success).toBe(true);
    expect(documentTextChunksSchema.safeParse([{ index: 1, text: 'one', wordCount: 1 }]).success).toBe(false);
    expect(documentTextChunksSchema.safeParse([{ index: 0, text: 'one two', wordCount: 1 }]).success).toBe(false);
  });

  test('rejects content that would create an unbounded semantic index', () => {
    const oversized = Array.from({ length: DOCUMENT_MAX_CHUNKS + 1 }, () => words(DOCUMENT_CHUNK_MAX_WORDS)).join('\n\n');
    expect(() => chunkDocumentContent(oversized)).toThrow(`maximum of ${DOCUMENT_MAX_CHUNKS} semantic chunks`);
  });
});
