import { describe, expect, test } from 'bun:test';
import { DOCUMENT_CHUNK_MAX_CHARACTERS, DOCUMENT_CHUNK_MAX_WORDS, DOCUMENT_MAX_CHUNKS, chunkDocumentContent, chunkDocumentText, documentEmbeddingTexts, documentTextChunksSchema } from './chunking';

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

  test('accepts ten million characters beyond the previous 64 chunk limit', () => {
    const expanded = 'x'.repeat(10_000_000);
    expect(chunkDocumentContent(expanded)).toHaveLength(625);
  });

  test('rejects content that would create an unbounded semantic index', () => {
    const oversized = 'x'.repeat(DOCUMENT_MAX_CHUNKS * DOCUMENT_CHUNK_MAX_CHARACTERS + 1);
    expect(() => chunkDocumentContent(oversized)).toThrow(`maximum of ${DOCUMENT_MAX_CHUNKS} semantic chunks`);
  });

  test('adds bounded semantic overlap to embedding passages without changing stored chunks', () => {
    const chunks = chunkDocumentContent(`${words(1_000, 'first')} ${words(10, 'second')}`);
    const passages = documentEmbeddingTexts('Report', chunks);
    expect(chunks.map((chunk) => chunk).join('')).toBe(`${words(1_000, 'first')} ${words(10, 'second')}`);
    expect(passages[0]).toBe(`Report\n\n${chunks[0]!.trim()}`);
    expect(passages[1]).toContain('Previous context:\n');
    expect(passages[1]).toContain('first999');
    expect(passages[1]).toEndWith(chunks[1]!.trim());
    expect(passages[1]!.length).toBeLessThanOrEqual(chunks[1]!.trim().length + 1_700);
    expect(documentEmbeddingTexts('Report', chunks)).toEqual(passages);
  });
});
