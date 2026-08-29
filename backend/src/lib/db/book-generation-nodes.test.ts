import { describe, expect, test } from 'bun:test';
import { buildEmbeddingText } from './base';
import { bookSchema, booksEmbeddingFields } from './books.node';
import { bookContextSchema, bookContextsEmbeddingFields } from './book-contexts.node';
import { bookThemeSchema, bookThemesEmbeddingFields } from './book-themes.node';
import { bookSourceSchema, bookSourcesEmbeddingFields } from './book-sources.node';
import { bookPartSchema, bookPartsEmbeddingFields } from './book-parts.node';
import { bookChapterSchema, bookChaptersEmbeddingFields } from './book-chapters.node';
import { chapterContextSchema, chapterContextsEmbeddingFields } from './chapter-contexts.node';
import { bookProgressSchema } from './book-progress.node';
import { EMBEDDING_DIMENSIONS } from '../embeddings';

const key = 'cmrnlzf650002qc7k4p5zem5w';
const otherKey = 'cmrnlzf640001qc7kazsr96k5';
const now = '2026-08-08T12:00:00.000Z';
const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);

describe('book generation node contracts', () => {
  test('requires exact current-dimensional vectors on every semantic record', () => {
    expect(EMBEDDING_DIMENSIONS).toBe(1_536);
    const semanticSchemas = [bookSchema, bookContextSchema, bookThemeSchema, bookSourceSchema, bookPartSchema, bookChapterSchema, chapterContextSchema];
    for (const schema of semanticSchemas) {
      const object = 'innerType' in schema ? schema.innerType() : schema;
      expect(object.shape.embedding.safeParse(embedding).success).toBe(true);
      expect(object.shape.embedding.safeParse(embedding.slice(1)).success).toBe(false);
    }
    expect(bookProgressSchema.shape).not.toHaveProperty('embedding');
  });

  test('defines the exact semantic field ordering', () => {
    expect(booksEmbeddingFields).toEqual(['title', 'subtitle', 'description', 'goal', 'audience', 'outcome']);
    expect(bookContextsEmbeddingFields).toEqual(['userContext', 'priorKnowledge', 'priorBookContext', 'personalizationContext', 'researchContext', 'noveltyContext', 'generationBrief']);
    expect(bookThemesEmbeddingFields).toEqual(['name', 'description']);
    expect(bookSourcesEmbeddingFields).toEqual(['title', 'content', 'relevance']);
    expect(bookPartsEmbeddingFields).toEqual(['title', 'description', 'objective']);
    expect(bookChaptersEmbeddingFields).toEqual(['title', 'description', 'objective', 'content']);
    expect(chapterContextsEmbeddingFields).toEqual(['previousContext', 'objectiveContext', 'sourceContext', 'personalizationContext', 'noveltyContext', 'nextContext', 'generationBrief']);
    expect(buildEmbeddingText(booksEmbeddingFields, { title: 'Leadership', description: 'Grow', goal: 'Lead', audience: 'Managers', outcome: 'Coach' })).toBe('Leadership\n\nGrow\n\nLead\n\nManagers\n\nCoach');
  });

  test('validates book metadata and progress defaults', () => {
    const book = bookSchema.parse({ key, scopeKey: otherKey, title: 'Leadership', description: 'A personal guide', goal: 'Lead better', audience: 'Managers', outcome: 'Build leaders', language: 'en', status: 'planning', embedding, createdAt: now, updatedAt: now });
    expect(book).toMatchObject({ isFavorite: false, status: 'planning' });
    expect(book).toMatchObject({ chapterCount: 0, estimatedMinutes: 0 });
    const chapter = bookChapterSchema.parse({ key, scopeKey: otherKey, bookKey: key, title: 'Start', description: 'Opening', objective: 'Orient the reader', evidenceKeyPoints: ['Use the selected evidence.'], priorTransition: 'Open the argument.', nextTransition: 'Lead into the next chapter.', repetitionBoundaries: ['Do not repeat the opening.'], targetWordMin: 400, targetWordMax: 450, embedding, position: 1, createdAt: now, updatedAt: now });
    expect(chapter).toMatchObject({ status: 'planned', topics: [], estimatedMinutes: 0 });
    const progress = bookProgressSchema.parse({ key, scopeKey: otherKey, userKey: key, bookKey: key, chapterKey: otherKey, progressSeconds: 0, createdAt: now, updatedAt: now });
    expect(progress.isCompleted).toBe(false);
    expect(progress.completedAt).toBeNull();
    for (const schema of [bookContextSchema, bookThemeSchema, bookSourceSchema, bookPartSchema, chapterContextSchema, bookProgressSchema]) expect(schema.safeParse({ unknown: true }).success).toBe(false);
  });

  test('strictly validates generation fingerprint and lease metadata', () => {
    const metadata = { generationBriefFingerprint: 'a'.repeat(64), generationLeaseToken: 'writer-1', generationLeaseExpiresAt: now };
    const common = { key, scopeKey: otherKey, title: 'Leadership', description: 'A personal guide', goal: 'Lead better', audience: 'Managers', outcome: 'Build leaders', language: 'en', status: 'planning', embedding, createdAt: now, updatedAt: now };
    expect(bookSchema.safeParse({ ...common, ...metadata }).success).toBe(true);
    expect(bookSchema.safeParse({ ...common, ...metadata, generationBriefFingerprint: 'not-a-sha256' }).success).toBe(false);
    expect(bookSchema.safeParse({ ...common, ...metadata, generationLeaseExpiresAt: 'tomorrow' }).success).toBe(false);
  });

  test('requires internal source keys and web source URLs', () => {
    const common = { key, scopeKey: otherKey, bookKey: key, title: 'Source', content: 'Snapshot', contentHash: 'a'.repeat(64), relevance: 'Grounding', embedding, createdAt: now };
    expect(bookSourceSchema.safeParse({ ...common, sourceType: 'document', sourceKey: otherKey }).success).toBe(true);
    expect(bookSourceSchema.safeParse({ ...common, sourceType: 'document' }).success).toBe(false);
    expect(bookSourceSchema.safeParse({ ...common, sourceType: 'web', url: 'https://example.com/research' }).success).toBe(true);
    expect(bookSourceSchema.safeParse({ ...common, sourceType: 'web', sourceKey: otherKey }).success).toBe(false);
    expect(bookSourceSchema.safeParse({ ...common, sourceType: 'trip', sourceKey: otherKey }).success).toBe(false);
  });
});
