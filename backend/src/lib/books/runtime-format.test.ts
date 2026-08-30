import { expect, test } from 'bun:test';
import { APP_SPEECH_WORDS_PER_MINUTE } from '@/lib/app-speech/service';
import { BOOK_CHAPTER_WORD_MAX, BOOK_CHAPTER_WORD_MIN } from '@/lib/db/book-chapters.node';
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

test('targets approximately one narrated minute per chapter', () => {
  const minimumSeconds = BOOK_CHAPTER_WORD_MIN / APP_SPEECH_WORDS_PER_MINUTE * 60;
  const maximumSeconds = BOOK_CHAPTER_WORD_MAX / APP_SPEECH_WORDS_PER_MINUTE * 60;

  expect(minimumSeconds).toBeGreaterThanOrEqual(55);
  expect(maximumSeconds).toBeLessThanOrEqual(62);
});
