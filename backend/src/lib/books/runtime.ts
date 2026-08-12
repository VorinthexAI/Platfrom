import { z } from 'zod';
import { buildEmbeddingText } from '@/lib/db/base';
import { bookSchema, booksEmbeddingFields } from '@/lib/db/books.node';
import { bookContextSchema, bookContextsEmbeddingFields } from '@/lib/db/book-contexts.node';
import { bookChapterSchema, bookChaptersEmbeddingFields } from '@/lib/db/book-chapters.node';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { documentStorage, type DocumentObjectStorage } from '@/lib/ai/document-processing/storage';
import { executeAction } from '@/lib/ai/router';
import type { ChatOutput, ImageOutput, SpeechOutput } from '@/lib/ai/providers';
import type { BookCreateInput, BookGenerator } from './service';
import { createBookRepository, type BookAccessContext, type BookRepository } from './repository';

const ideaSchema = z.object({ title: z.string().trim().min(1), subtitle: z.string().trim().min(1).optional(), description: z.string().trim().min(1), outcome: z.string().trim().min(1), summary: z.string().trim().min(1) }).strict();
const outlineSchema = z.object({ chapters: z.array(z.object({ title: z.string().trim().min(1), description: z.string().trim().min(1), objective: z.string().trim().min(1), topics: z.array(z.string().trim().min(1)).min(1).max(20) }).strict()).min(1).max(30) }).strict();
type Ask = (input: Record<string, unknown>, organizationKey: string) => Promise<string>;
type Speak = (text: string, language: string, organizationKey: string) => Promise<{ bytes: Uint8Array; mimeType: string; durationMs?: number }>;
type Cover = (prompt: string, organizationKey: string) => Promise<{ bytes: Uint8Array; mimeType: string } | null>;

function speechChunks(content: string, maximum = 2_800) {
  const paragraphs = content.split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean);
  const chunks: string[] = [];
  for (const paragraph of paragraphs) {
    const sentences = paragraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [paragraph];
    for (const sentence of sentences) {
      const value = sentence.trim();
      if (!value) continue;
      if (value.length > maximum) {
        for (let start = 0; start < value.length; start += maximum) chunks.push(value.slice(start, start + maximum));
      } else if (chunks.length && chunks[chunks.length - 1]!.length + value.length + 1 <= maximum) {
        chunks[chunks.length - 1] += ` ${value}`;
      } else chunks.push(value);
    }
  }
  return chunks;
}

function json<T>(schema: z.ZodType<T>, value: string): T {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return schema.parse(JSON.parse(cleaned));
}

export interface BookRuntimeDependencies {
  repository?: BookRepository; ask?: Ask; speak?: Speak; cover?: Cover; storage?: DocumentObjectStorage;
  embed?: (text: string) => Promise<number[]>; id?: () => string; now?: () => string;
}

export function createBookRuntime(options: BookRuntimeDependencies = {}): BookGenerator {
  const repository = options.repository ?? createBookRepository(); const storage = options.storage ?? documentStorage; const id = options.id ?? newId; const now = options.now ?? (() => new Date().toISOString());
  const ask = options.ask ?? (async (input, organizationKey) => (await executeAction<Record<string, unknown>, ChatOutput>({ mode: 'auto', organizationKey, actionSlug: 'ask' }, input)).output.text);
  const embed = options.embed ?? (async (text) => { const { embedText } = await import('@/lib/embeddings'); return embedText({ text }); });
  const speak: Speak = options.speak ?? (async (text, language, organizationKey) => { const output = (await executeAction<Record<string, unknown>, SpeechOutput>({ mode: 'auto', organizationKey, actionSlug: 'generate-speech' }, { text, language, format: 'mp3' })).output; return { bytes: Buffer.from(output.audioBase64, 'base64'), mimeType: output.mimeType }; });
  const cover = options.cover ?? (async (prompt, organizationKey) => { try { const output = (await executeAction<Record<string, unknown>, ImageOutput>({ mode: 'auto', organizationKey, actionSlug: 'generate-image' }, { prompt, count: 1, size: '1024x1024' })).output.images[0]; return output ? { bytes: Buffer.from(output.base64, 'base64'), mimeType: output.mimeType } : null; } catch { return null; } });
  const vector = async (fields: readonly string[], value: Record<string, unknown>) => currentEmbeddingSchema.parse(await embed(buildEmbeddingText(fields, value)!));
  const prompt = (systemPrompt: string, text: string, maxTokens = 4_000) => ({ systemPrompt, messages: [{ role: 'user', content: [{ type: 'text', text }] }], options: { temperature: 0.3, maxTokens } });
  return {
    async create(input, context) {
      await repository.authorize(context, true);
      const idea = json(ideaSchema, await ask(prompt('Design a useful nonfiction book from the reader brief. Return only strict JSON with title, optional subtitle, description, outcome, and summary.', JSON.stringify(input)), context.organizationKey));
      const timestamp = now(); const bookKey = id();
       const draft = { key: bookKey, scopeKey: input.scopeKey, ...(input.generationRequestKey ? { generationRequestKey: input.generationRequestKey } : {}), title: idea.title, ...(idea.subtitle ? { subtitle: idea.subtitle } : {}), description: idea.description, goal: input.goal, audience: input.audience, outcome: idea.outcome, language: input.language, status: 'planning' as const, createdAt: timestamp, updatedAt: timestamp };
      const sourceNotes = input.sourceNotes?.trim() || 'No source notes supplied.';
      const contextDraft = { key: id(), scopeKey: input.scopeKey, bookKey, userContext: `Topic: ${input.topic}\nGoal: ${input.goal}\nAudience: ${input.audience}\nTone: ${input.tone}\nLength: ${input.length}`, priorKnowledge: sourceNotes, priorBookContext: idea.summary, personalizationContext: `Write for ${input.audience} in a ${input.tone} tone.`, researchContext: input.sourceNotes?.trim() || 'Use durable general knowledge and avoid unsupported claims.', noveltyContext: 'Prefer concrete examples, useful distinctions, and original synthesis.', generationBrief: idea.summary, createdAt: timestamp, updatedAt: timestamp };
      await repository.create(context, bookSchema.parse({ ...draft, embedding: await vector(booksEmbeddingFields, draft) }), bookContextSchema.parse({ ...contextDraft, embedding: await vector(bookContextsEmbeddingFields, contextDraft) }));
      return bookKey;
    },
    async write(bookKey, input, context) {
      await repository.authorize(context, true); const initial = await repository.detail(context, bookKey); const timestamp = now();
      await repository.updateBook(context, bookKey, { status: 'generating', updatedAt: timestamp });
      try {
        let chapters = initial.chapters.map(({ chapter }) => chapter);
        if (!chapters.length) {
          const requested = input.length === 'short' ? 5 : input.length === 'deep' ? 12 : 8;
          const outline = json(outlineSchema, await ask(prompt(`Create an ordered nonfiction outline of about ${requested} chapters. Return only strict JSON: {"chapters":[{"title","description","objective","topics":[...]}]}.`, JSON.stringify(input)), context.organizationKey));
          chapters = await Promise.all(outline.chapters.map(async (chapter, index) => { const draft = { ...chapter, key: id(), scopeKey: input.scopeKey, bookKey, position: index + 1, status: 'planned' as const, createdAt: timestamp, updatedAt: timestamp }; return bookChapterSchema.parse({ ...draft, embedding: await vector(bookChaptersEmbeddingFields, draft) }); }));
          await repository.replaceChapters(context, bookKey, chapters, { chapterCount: chapters.length, updatedAt: timestamp });
        }
        const written: typeof chapters = [];
        for (const chapter of chapters.sort((a, b) => a.position - b.position)) {
           if (chapter.content && chapter.audioStorageKey) { written.push(chapter); continue; }
           if (!chapter.content) await repository.updateChapter(context, chapter.key, { status: 'writing', updatedAt: now() });
           const previous = written.map((item) => `${item.title}: ${item.description}`).join('\n');
           const content = chapter.content ?? (await ask(prompt(`Write this nonfiction chapter as natural, human prose in ${input.language}. Follow the chapter objective and topics while matching the requested ${input.tone} tone.

Use complete paragraphs, varied sentence lengths, concrete examples, and smooth transitions. Write with the confidence and rhythm of an experienced nonfiction author. Prefer plain punctuation and natural connective language.

Do not use bullet lists, numbered lists, headings, fragments, slogans, canned motivational language, repetitive summaries, or meta commentary. Avoid em dashes and avoid excessive hyphens; use commas, periods, or full connecting phrases instead. Do not announce the chapter structure or say what the reader will learn. Return only the finished chapter prose.`, JSON.stringify({ book: { title: initial.book.title, description: initial.book.description, goal: input.goal, audience: input.audience, tone: input.tone, language: input.language }, chapter, previous }), input.length === 'deep' ? 8_000 : input.length === 'short' ? 2_500 : 4_500), context.organizationKey)).trim();
          const estimatedMinutes = Math.max(1, Math.ceil(content.split(/\s+/).length / 220));
          let audioStorageKey: string | undefined; let audioDurationSeconds: number | undefined;
           try {
             const narration = await Promise.all(speechChunks(content).map((chunk) => speak(chunk, input.language, context.organizationKey)));
             const mimeType = narration[0]?.mimeType ?? 'audio/mpeg';
             const extension = mimeType.includes('wav') ? 'wav' : mimeType.includes('ogg') ? 'ogg' : 'mp3';
             const byteLength = narration.reduce((sum, item) => sum + item.bytes.byteLength, 0);
             const bytes = new Uint8Array(byteLength);
             let offset = 0;
             for (const item of narration) { bytes.set(item.bytes, offset); offset += item.bytes.byteLength; }
             audioStorageKey = (await storage.upload({ key: `books/${input.scopeKey}/${bookKey}/chapters/${chapter.key}.${extension}`, bytes, mimeType })).storageKey;
             const durationMs = narration.reduce((sum, item) => sum + (item.durationMs ?? 0), 0);
             audioDurationSeconds = durationMs ? Math.max(1, Math.ceil(durationMs / 1_000)) : undefined;
           } catch { /* Prose remains available when speech is not configured. */ }
          const patch = { content, estimatedMinutes, status: audioStorageKey ? 'audio-ready' as const : 'written' as const, ...(audioStorageKey ? { audioStorageKey } : {}), ...(audioDurationSeconds ? { audioDurationSeconds } : {}), embedding: await vector(bookChaptersEmbeddingFields, { ...chapter, content }), updatedAt: now() };
          written.push(await repository.updateChapter(context, chapter.key, patch));
        }
        let coverStorageKey = initial.book.coverStorageKey;
        if (!coverStorageKey) { const image = await cover(`Editorial nonfiction book cover, no logos. Title: ${initial.book.title}. Theme: ${initial.book.description}.`, context.organizationKey); if (image) { const extension = image.mimeType.includes('jpeg') ? 'jpg' : image.mimeType.includes('webp') ? 'webp' : 'png'; coverStorageKey = (await storage.upload({ key: `books/${input.scopeKey}/${bookKey}/cover.${extension}`, bytes: image.bytes, mimeType: image.mimeType })).storageKey; } }
        await repository.updateBook(context, bookKey, { status: 'ready', chapterCount: written.length, estimatedMinutes: written.reduce((sum, chapter) => sum + chapter.estimatedMinutes, 0), ...(coverStorageKey ? { coverStorageKey } : {}), updatedAt: now() });
      } catch (error) { await repository.updateBook(context, bookKey, { status: 'failed', updatedAt: now() }); throw error; }
    },
  };
}
