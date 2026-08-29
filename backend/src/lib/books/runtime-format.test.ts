import { expect, test } from 'bun:test';
import { BOOK_CHAPTER_WORD_MIN } from '@/lib/db/book-chapters.node';
import { formatChapterParagraphs, narrationText } from './runtime';

test('formats chapter prose into readable real-newline paragraphs', () => {
  const formatted = formatChapterParagraphs(Array.from({ length: BOOK_CHAPTER_WORD_MIN }, (_, index) => `word${index}`).join(' '));
  const paragraphs = formatted.split('\n\n');

  expect(paragraphs.length).toBeGreaterThan(1);
  expect(paragraphs.every((paragraph) => paragraph.split(/\s+/).length >= 30 && paragraph.split(/\s+/).length <= 45)).toBe(true);
  expect(formatted).not.toContain('\\n');
});

test('normalizes escaped breaks for storage and removes them from narration', () => {
  const formatted = formatChapterParagraphs('First short paragraph.\\n\\nSecond short paragraph.');

  expect(formatted).toBe('First short paragraph.\n\nSecond short paragraph.');
  expect(narrationText(formatted)).toBe('First short paragraph. Second short paragraph.');
});
