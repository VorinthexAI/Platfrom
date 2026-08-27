import { createHash } from 'node:crypto';
import { z } from 'zod';
import { buildEmbeddingText } from '@/lib/db/base';
import { bookSchema, booksEmbeddingFields, type Book } from '@/lib/db/books.node';
import { bookContextSchema, bookContextsEmbeddingFields } from '@/lib/db/book-contexts.node';
import { bookChapterSchema, bookChaptersEmbeddingFields, type BookChapter } from '@/lib/db/book-chapters.node';
import { bookSourceSchema, bookSourcesEmbeddingFields, type BookSource } from '@/lib/db/book-sources.node';
import { chapterContextSchema, chapterContextsEmbeddingFields, type ChapterContext } from '@/lib/db/chapter-contexts.node';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { documentStorage, type DocumentObjectStorage } from '@/lib/ai/document-processing/storage';
import { executeAction, executeAsk } from '@/lib/ai/router';
import type { ChatOutput } from '@/lib/ai/providers';
import { canonicalizeImageToPng, processImages } from '@/lib/ai/image-processing';
import { speechOutputSchema, type SpeechInput } from '@/lib/ai/actions/generate-speech';
import { createImageGenerationService, type ImageGenerationService } from '@/lib/image-generation/service';
import { createAppAudioService, type AppAudioService } from '@/lib/app-audio/service';
import type { BookGenerator } from './service';
import { createBookRepository, type BookRepository } from './repository';

const ideaSchema = z.object({ title: z.string().trim().min(1), subtitle: z.string().trim().min(1).optional(), description: z.string().trim().min(1), outcome: z.string().trim().min(1), summary: z.string().trim().min(1) }).strict();
const words = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;
const truncateProse = (value: string, maximum: number) => {
  const limited = value.trim().split(/\s+/).slice(0, maximum).join(' ');
  const sentence = limited.match(/^([\s\S]*[.!?])(?:\s|$)/)?.[1]?.trim();
  return sentence && words(sentence) >= 500 ? sentence : limited;
};
const chapterBriefSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().refine((value) => words(value) >= 80 && words(value) <= 120, 'Chapter briefs must contain 80-120 words.'),
  objective: z.string().trim().min(1), evidenceKeyPoints: z.array(z.string().trim().min(1)).min(2).max(12), topics: z.array(z.string().trim().min(1)).min(1).max(20),
  priorTransition: z.string().trim().min(1), nextTransition: z.string().trim().min(1), repetitionBoundaries: z.array(z.string().trim().min(1)).min(1).max(12),
  targetWordMin: z.literal(500), targetWordMax: z.literal(750),
}).strict();
const outlineSchema = z.object({ chapters: z.array(chapterBriefSchema) }).strict();
type Ask = (input: Record<string, unknown>, organizationKey: string, signal?: AbortSignal) => Promise<string>;
type Media = (prompt: string, organizationKey: string, signal?: AbortSignal) => Promise<{ bytes: Uint8Array; mimeType: string } | null>;

function json<T>(schema: z.ZodType<T>, value: string): T { return schema.parse(JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))); }
function hash(value: unknown) { return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }
export async function boundedMap<T>(values: readonly T[], concurrency: number, run: (value: T, index: number) => Promise<void>) {
  let next = 0;
  let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (failure === undefined) {
      const index = next++;
      if (index >= values.length) return;
      try { await run(values[index]!, index); }
      catch (error) { failure ??= error; }
    }
  }));
  if (failure !== undefined) throw failure;
}
function sourceEvidence(sources: readonly BookSource[]) { let remaining = 24_000; return sources.flatMap((source) => { if (remaining <= 0) return []; const content = source.content.slice(0, Math.min(4_000, remaining)); remaining -= content.length; return [{ title: source.title, type: source.sourceType, content, contentHash: source.contentHash, ...(source.url ? { url: source.url } : {}) }]; }); }
function stableChapterBrief(chapter: BookChapter) { const { title, description, objective, evidenceKeyPoints, topics, priorTransition, nextTransition, repetitionBoundaries, targetWordMin, targetWordMax, position } = chapter; return { title, description, objective, evidenceKeyPoints, topics, priorTransition, nextTransition, repetitionBoundaries, targetWordMin, targetWordMax, position }; }

export interface BookRuntimeDependencies {
  repository?: BookRepository; ask?: Ask; images?: Pick<ImageGenerationService, 'generateRaw'>;
  speech?: (input: SpeechInput, organizationKey: string, signal?: AbortSignal) => Promise<{ bytes: Uint8Array; mimeType: string; durationSeconds?: number }>;
  appAudio?: Pick<AppAudioService, 'generateForTarget'>;
  storage?: DocumentObjectStorage; embed?: (text: string, organizationKey: string, signal?: AbortSignal) => Promise<number[]>;
  processImageBatch?: typeof processImages;
  publishChanged?: (scopeKey: string) => Promise<unknown>; publishContentChanged?: (scopeKey: string) => Promise<unknown>; id?: () => string; now?: () => string;
}

export function createBookRuntime(options: BookRuntimeDependencies = {}): BookGenerator {
  const repository = options.repository ?? createBookRepository(); const storage = options.storage ?? documentStorage; const id = options.id ?? newId; const now = options.now ?? (() => new Date().toISOString());
  const ask = options.ask ?? (async (input, organizationKey, signal) => (await executeAsk<ChatOutput>(organizationKey, input as never, { signal, timeoutMs: 180_000 })).output.text);
  const embed = options.embed ?? (async (text, organizationKey, signal) => (await executeAction<{ text: string }, { embedding: number[] }>({ mode: 'auto', organizationKey, actionSlug: 'embed' }, { text }, { signal })).output.embedding);
  const imageService = options.images ?? createImageGenerationService();
  const image: Media = async (prompt, organizationKey, signal) => { try { const generated = await imageService.generateRaw({ prompt, count: 1, size: '1024x1024', quality: 'high', mode: 'default' }, organizationKey, { signal, timeoutMs: 180_000 }); const output = generated.output.images[0]; return output ? { bytes: Buffer.from(output.base64, 'base64'), mimeType: output.mimeType } : null; } catch { return null; } };
  const speech = options.speech ?? (async (input, organizationKey, signal) => { const output = speechOutputSchema.parse((await executeAction({ mode: 'auto', organizationKey, actionSlug: 'generate-speech' }, input, { signal, timeoutMs: 180_000 })).output); return { bytes: Buffer.from(output.base64, 'base64'), mimeType: output.mimeType, durationSeconds: output.durationSeconds }; });
  const appAudio = options.appAudio ?? createAppAudioService({ storage, speech: async (input, organizationKey, actionOptions) => speech(input, organizationKey, actionOptions?.signal) as Promise<{ bytes: Uint8Array; mimeType: 'audio/mpeg'; durationSeconds?: number }> });
  const processImageBatch = options.processImageBatch ?? processImages;
  const notify = options.publishChanged ?? (async (scopeKey) => (await import('@/api/events')).publishScopeEvent(scopeKey, 'book.changed'));
  const notifyContent = options.publishContentChanged ?? (async (scopeKey) => (await import('@/api/events')).publishScopeEvent(scopeKey, 'content.changed'));
  const pngMedia = async (media: Awaited<ReturnType<Media>>) => media == null ? null : { ...(await canonicalizeImageToPng(media.bytes)), mimeType: 'image/png' };
  const vector = async (fields: readonly string[], value: Record<string, unknown>, organizationKey: string, signal?: AbortSignal) => currentEmbeddingSchema.parse(await embed(buildEmbeddingText(fields, value)!, organizationKey, signal));
  const prompt = (systemPrompt: string, text: string, maxTokens = 8_000) => ({ systemPrompt, messages: [{ role: 'user', content: [{ type: 'text', text }] }], options: { temperature: 0.3, maxTokens } });
  const check = async (context: Parameters<BookRepository['isCancellationRequested']>[0], bookKey: string) => { if (context.signal?.aborted || await repository.isCancellationRequested(context, bookKey)) throw new Error('Book generation cancelled.'); };
  const dumpGalleryCopies = async (detail: Awaited<ReturnType<BookRepository['detail']>>, context: Parameters<BookRepository['detail']>[0]) => {
    const exports = [
      ...(detail.book.coverStorageKey ? [{ sourceKey: detail.book.coverStorageKey, filename: `${detail.book.title}.png`, identity: `book:${detail.book.key}` }] : []),
      ...detail.chapters.flatMap(({ chapter }) => chapter.imageStorageKey ? [{ sourceKey: chapter.imageStorageKey, filename: `${chapter.title}.png`, identity: `chapter:${chapter.key}` }] : []),
    ];
    for (let offset = 0; offset < exports.length; offset += 20) {
      const batch = exports.slice(offset, offset + 20);
      const { collectionKey, ownerKey } = await repository.ensureGalleryExportCollection(context, detail.book.embedding, now());
      const inputs = await Promise.all(batch.map(async (item) => {
        const object = await storage.download(item.sourceKey);
        const filename = `${item.filename.replace(/\.png$/i, '').replace(/[\\/]/g, '-').slice(0, 251) || 'image'}.png`;
        return { scopeKey: context.scopeKey, ownerKey, idempotencyKey: `book-image-export:${hash(`${item.identity}\0${item.sourceKey}`)}`, mutationPolicy: 'user' as const, file: { filename, mimeType: object.mimeType ?? 'image/png', sizeBytes: object.bytes.byteLength, bytes: object.bytes }, signal: context.signal };
      }));
      const images = await processImageBatch(inputs, {
        storage,
        captionBatch: async (values) => values.map(({ filename }) => ({ caption: `Artwork exported from ${filename}.`, score: 1 })),
        embed: (text, signal) => embed(text, context.organizationKey, signal),
      });
      await repository.linkGalleryExportImages(context, collectionKey, ownerKey, images.map(({ key }) => key), now());
    }
  };
  return {
    async create(input, context) {
      await repository.authorize(context, true); const timestamp = now(); const bookKey = id(); const sourceDocuments = await repository.sourceDocuments(context, input.archiveDocumentKeys);
      const generationInput = { topic: input.topic, goal: input.goal, currentKnowledge: input.currentKnowledge, writingTone: input.writingTone, chapterCount: input.chapterCount, language: input.language, archiveDocumentKeys: input.archiveDocumentKeys, narratorVoiceKey: input.narratorVoiceKey, narrationPace: input.narrationPace, chapterImages: input.chapterImages, additionalInstructions: input.additionalInstructions };
      const total = input.chapterCount * (input.chapterImages ? 4 : 3) + 3;
      const audience = input.currentKnowledge || 'No prior knowledge provided';
      const draft = { key: bookKey, scopeKey: input.scopeKey, generationRequestKey: input.generationRequestKey, generationBriefFingerprint: input.generationBriefFingerprint, generationInput, generationOwnerKey: context.userKey, title: input.topic, description: `Personalized audiobook about ${input.topic}`, goal: input.goal, audience, outcome: input.goal, language: input.language, narratorVoiceKey: input.narratorVoiceKey, narrationPace: input.narrationPace, status: 'queued' as const, generationStage: 'accepted' as const, generationCompletedUnits: 0, generationTotalUnits: total, generationAttempt: 0, estimatedMinutes: 0, chapterCount: input.chapterCount, createdAt: timestamp, updatedAt: timestamp };
      const contextDraft = { key: id(), scopeKey: input.scopeKey, bookKey, userContext: `Topic: ${input.topic}\nGoal: ${input.goal}\nCurrent knowledge: ${audience}\nTone: ${input.writingTone}`, priorKnowledge: sourceDocuments.length ? 'Selected Archive snapshots are attached.' : audience, priorBookContext: input.topic, personalizationContext: audience, researchContext: 'No automatic web research; use model knowledge and explicitly selected Archive sources.', noveltyContext: 'Prefer concrete examples and original synthesis.', generationBrief: input.additionalInstructions || input.goal, createdAt: timestamp, updatedAt: timestamp };
      const book = bookSchema.parse({ ...draft, embedding: await vector(booksEmbeddingFields, draft, context.organizationKey, context.signal) });
      const bookContext = bookContextSchema.parse({ ...contextDraft, embedding: await vector(bookContextsEmbeddingFields, contextDraft, context.organizationKey, context.signal) });
      const sources = await Promise.all(sourceDocuments.map(async (source) => { const value = { key: id(), scopeKey: input.scopeKey, bookKey, sourceType: 'document' as const, sourceKey: source.key, title: source.name, content: source.content, contentHash: hash(source.content), sourceUpdatedAt: source.updatedAt, relevance: 'Explicitly selected by the user.', createdAt: timestamp }; return bookSourceSchema.parse({ ...value, embedding: await vector(bookSourcesEmbeddingFields, value, context.organizationKey, context.signal) }); }));
      await repository.create(context, book, bookContext, sources); return bookKey;
    },
    async write(bookKey, input, context) {
      if (!context.generationLeaseToken) throw new Error('Book generation lease token is required.'); const pendingUploads = new Set<string>(); const signal = context.signal; const uploadAttempt = hash(context.generationLeaseToken).slice(0, 12);
      const upload = async (value: Parameters<DocumentObjectStorage['upload']>[0]) => { pendingUploads.add(value.key); const stored = await storage.upload(value); if (stored.storageKey !== value.key) { pendingUploads.delete(value.key); pendingUploads.add(stored.storageKey); } return stored; };
      const stage = async (generationStage: Book['generationStage'], status: Book['status']) => { await repository.updateBook(context, bookKey, { generationStage, status, generationError: undefined, updatedAt: now() }); await notify(input.scopeKey).catch(() => undefined); };
      const provider = async <T>(operation: () => Promise<T>) => { const value = await operation(); await check(context, bookKey); return value; };
      const boundedProse = async (instruction: string, data: Record<string, unknown>, label: string) => {
        let content = '';
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const count = words(content);
          if (count >= 500 && count <= 750) return content;
          if (count > 750) return truncateProse(content, 750);
          if (count > 0 && count < 500) {
            const continuation = (await provider(() => ask(prompt(`Continue the existing ${label} with ${500 - count}-${750 - count} additional words. Return only new prose that follows directly from the existing ending; do not repeat, restart, add headings, or add meta commentary.`, JSON.stringify({ ...data, existingProse: content })), context.organizationKey, signal))).trim();
            content = `${content}\n\n${continuation}`.trim();
          } else content = (await provider(() => ask(prompt(instruction, JSON.stringify(data)), context.organizationKey, signal))).trim();
        }
        const count = words(content);
        if (count < 500 || count > 750) throw new Error(`${label} contained ${count} words after 6 attempts; expected 500-750.`);
        return content;
      };
      try {
        await check(context, bookKey); let detail = await repository.detail(context, bookKey); let sources = await repository.sources(context, bookKey);
        const unembeddedSources = sources.filter(({ embedding }) => embedding.every((value) => value === 0));
        if (unembeddedSources.length) { const embedded: BookSource[] = []; await boundedMap(unembeddedSources, 4, async (source) => { embedded.push({ ...source, embedding: await vector(bookSourcesEmbeddingFields, source, context.organizationKey, signal) }); }); await repository.addSources(context, bookKey, embedded); sources = sources.map((source) => embedded.find(({ key }) => key === source.key) ?? source); }
        const archiveEvidence = sourceEvidence(sources.filter(({ sourceType }) => sourceType === 'document'));
        const evidence = { selectedArchive: archiveEvidence };
        let chapters = detail.chapters.map(({ chapter }) => chapter); let currentBook = detail.book; let idea: z.output<typeof ideaSchema> | undefined;
        if (!chapters.length) {
          await stage('outline', 'planning');
          idea = json(ideaSchema, await provider(() => ask(prompt('Design a useful nonfiction audiobook from the complete generation brief and any explicitly selected Archive evidence. Return strict JSON with title, optional subtitle, description, outcome, and summary.', JSON.stringify({ generationBrief: input, evidence })), context.organizationKey, signal)));
          currentBook = await repository.updateBook(context, bookKey, { title: idea.title, subtitle: idea.subtitle, description: idea.description, outcome: idea.outcome, embedding: await vector(['title', 'subtitle', 'description', 'goal', 'audience', 'outcome'], { ...currentBook, ...idea }, context.organizationKey, signal), updatedAt: now() });
        }
        const coverInputHash = hash({ title: currentBook.title, description: currentBook.description, generation: currentBook.generationBriefFingerprint });
        if (!currentBook.coverStorageKey || currentBook.coverInputHash !== coverInputHash) {
          const previousStorageKey = currentBook.coverStorageKey;
          const cover = await pngMedia(await provider(() => image(`Editorial audiobook cover without logos. Title: ${currentBook.title}. ${currentBook.description}`, context.organizationKey, signal)));
          if (!cover) throw new Error('Automatic book cover generation failed.');
          const stored = await upload({ key: `books/${input.scopeKey}/${bookKey}/cover-${coverInputHash.slice(0, 12)}-${uploadAttempt}.png`, bytes: cover.bytes, mimeType: cover.mimeType });
          currentBook = await repository.updateBook(context, bookKey, { coverStorageKey: stored.storageKey, coverInputHash, updatedAt: now() }); pendingUploads.delete(stored.storageKey);
          await notify(input.scopeKey).catch(() => undefined);
          if (previousStorageKey && previousStorageKey !== stored.storageKey) await repository.enqueueUnreferencedStorage(context, [previousStorageKey], now());
          await repository.advanceGeneration(context, bookKey, now());
        }
        await repository.reconcileGeneration(context, bookKey, 1, now());
        if (!chapters.length) {
          let outline: z.output<typeof outlineSchema> | undefined; let outlineError = '';
          for (let attempt = 0; attempt < 3 && !outline; attempt += 1) {
            const correction = outlineError ? ` The previous response was invalid: ${outlineError}. Correct every listed issue.` : '';
            const response = await provider(() => ask(prompt(`Create exactly ${input.chapterCount} ordered chapter briefs. Each description must contain 80-120 words, while targetWordMin must be the number 500 and targetWordMax must be the number 750. Every chapter must include at least two non-empty evidenceKeyPoints, at least one topic, and at least one non-empty repetitionBoundary even when no Archive evidence was selected. Every summary must synthesize the selected Archive evidence when supplied, book goal, reader knowledge, writing tone, language, and additional instructions instead of using generic filler. Make the chapters collectively complete, ordered, and non-repetitive. Return only strict JSON matching {"chapters":[{"title":"...","description":"80-120 words","objective":"...","evidenceKeyPoints":["point one","point two"],"topics":["topic"],"priorTransition":"...","nextTransition":"...","repetitionBoundaries":["boundary"],"targetWordMin":500,"targetWordMax":750}]}.${correction}`, JSON.stringify({ generationBrief: input, book: idea, evidence })), context.organizationKey, signal));
            try {
              const candidate = json(outlineSchema, response);
              if (candidate.chapters.length !== input.chapterCount) throw new Error(`Outline contained ${candidate.chapters.length} chapters instead of ${input.chapterCount}.`);
              outline = candidate;
            } catch (error) {
              outlineError = error instanceof z.ZodError ? error.issues.slice(0, 12).map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') : error instanceof Error ? error.message : 'Unknown outline validation error';
            }
          }
          if (!outline) throw new Error(`Outline generation failed validation after 3 attempts: ${outlineError}`);
          const timestamp = now(); chapters = new Array(outline.chapters.length); const contexts: ChapterContext[] = new Array(outline.chapters.length);
          await boundedMap(outline.chapters, 4, async (brief, index) => { const chapterDraft = { ...brief, key: id(), scopeKey: input.scopeKey, bookKey, position: index + 1, status: 'planned' as const, createdAt: timestamp, updatedAt: timestamp }; const chapter = bookChapterSchema.parse({ ...chapterDraft, embedding: await vector(bookChaptersEmbeddingFields, chapterDraft, context.organizationKey, signal) }); chapters[index] = chapter; const contextDraft = { key: id(), scopeKey: input.scopeKey, chapterKey: chapter.key, previousContext: brief.priorTransition, objectiveContext: brief.objective, sourceContext: brief.evidenceKeyPoints.join('\n'), personalizationContext: input.currentKnowledge, noveltyContext: brief.repetitionBoundaries.join('\n'), nextContext: brief.nextTransition, generationBrief: brief.description, createdAt: timestamp, updatedAt: timestamp }; contexts[index] = chapterContextSchema.parse({ ...contextDraft, embedding: await vector(chapterContextsEmbeddingFields, contextDraft, context.organizationKey, signal) }); });
          await repository.replaceChapters(context, bookKey, chapters, contexts, { chapterCount: chapters.length, generationStage: 'draft', status: 'writing', updatedAt: now() }); await repository.advanceGeneration(context, bookKey, now());
        }
        await repository.reconcileGeneration(context, bookKey, 2, now()); await stage('draft', 'writing');
        const draftChapter = async (chapter: BookChapter, index: number) => {
          const draftInputHash = hash({ generation: detail.book.generationBriefFingerprint, chapter: stableChapterBrief(chapter), evidence });
          if (chapter.content && chapter.draftInputHash === draftInputHash) return;
          await check(context, bookKey); await repository.updateChapter(context, chapter.key, { status: 'writing', updatedAt: now() });
          const content = await boundedProse(`Write 500-750 words of finished nonfiction prose in ${input.language}. Ground factual claims in the supplied source evidence and chapter evidence points. Respect transitions and repetition boundaries. No headings, lists, meta commentary, or unsupported claims.`, { chapter, evidence, personalization: input.currentKnowledge, tone: input.writingTone }, `chapter ${index + 1}`);
          const supersededStorageKeys = [chapter.audioStorageKey, chapter.imageStorageKey].filter((key): key is string => Boolean(key)); const updated = await repository.updateChapter(context, chapter.key, { content, draftInputHash, finalizationInputHash: undefined, audioInputHash: undefined, audioStorageKey: undefined, audioDurationSeconds: undefined, imageInputHash: undefined, imageStorageKey: undefined, status: 'written', estimatedMinutes: Math.ceil(words(content) / 220), embedding: await vector(bookChaptersEmbeddingFields, { ...chapter, content }, context.organizationKey, signal), updatedAt: now() }); chapters[index] = updated; if (supersededStorageKeys.length) await repository.enqueueUnreferencedStorage(context, supersededStorageKeys, now()); await repository.advanceGeneration(context, bookKey, now()); await notify(input.scopeKey).catch(() => undefined);
        };
        const finalizeChapter = async (index: number, previous: string) => { const chapter = chapters[index]!; const finalizationInputHash = hash({ draftInputHash: chapter.draftInputHash, previous: hash(previous), boundaries: chapter.repetitionBoundaries, transitions: [chapter.priorTransition, chapter.nextTransition] }); if (chapter.content && chapter.finalizationInputHash === finalizationInputHash) return chapter.content; await check(context, bookKey); const finalized = await boundedProse('Continuity-edit this chapter while preserving 500-750 words and grounded claims. Return only final prose. Honor prior/next transitions and repetition boundaries.', { previousEnding: previous.slice(-1_500), chapter, evidence }, `finalized chapter ${index + 1}`); const finalizedWordCount = words(finalized); chapters[index] = await repository.updateChapter(context, chapter.key, { content: finalized, finalizationInputHash, status: 'finalized', estimatedMinutes: Math.ceil(finalizedWordCount / 220), embedding: await vector(bookChaptersEmbeddingFields, { ...chapter, content: finalized }, context.organizationKey, signal), updatedAt: now() }); await repository.advanceGeneration(context, bookKey, now()); return finalized; };
        const generateAudio = async (index: number) => { const chapter = chapters[index]!; const audioInputHash = hash({ content: chapter.content, voice: input.narratorVoiceKey, pace: input.narrationPace }); if (chapter.audioStorageKey && chapter.audioInputHash === audioInputHash) return; await check(context, bookKey); const previousStorageKey = chapter.audioStorageKey; const generated = await appAudio.generateForTarget({ organizationKey: context.organizationKey, storageKey: `books/${input.scopeKey}/${bookKey}/chapter-${chapter.position}-${audioInputHash.slice(0, 12)}-${uploadAttempt}.mp3`, text: chapter.content!, voice: input.narratorVoiceKey, pace: input.narrationPace }, { signal, afterSpeech: () => check(context, bookKey), persist: async (audio) => { const target = await repository.updateChapter(context, chapter.key, { audioStorageKey: audio.storageKey, audioInputHash, audioDurationSeconds: audio.durationSeconds, status: 'audio-ready', updatedAt: now() }); await notify(input.scopeKey).catch(() => undefined); return target; }, compensate: (storageKey) => repository.enqueueUnreferencedStorage(context, [storageKey], now()) }); chapters[index] = generated.target; if (previousStorageKey && previousStorageKey !== generated.storageKey) await repository.enqueueUnreferencedStorage(context, [previousStorageKey], now()); await repository.advanceGeneration(context, bookKey, now()); };
        const firstChapterBranch = (async () => { await draftChapter(chapters[0]!, 0); await finalizeChapter(0, ''); await generateAudio(0); })();
        const remainingDraftBranch = boundedMap(chapters.slice(1), 3, (chapter, index) => draftChapter(chapter, index + 1));
        const draftBranches = await Promise.allSettled([firstChapterBranch, remainingDraftBranch]);
        const draftFailure = draftBranches.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (draftFailure) throw draftFailure.reason;
        await repository.reconcileGeneration(context, bookKey, 2 + chapters.length, now()); await stage('continuity', 'finalizing');
        let previous = chapters[0]!.content!; const audioTasks: Array<Promise<{ error?: unknown }>> = []; const activeAudio = new Set<Promise<{ error?: unknown }>>(); let finalizationFailure: unknown;
        try {
          for (let index = 1; index < chapters.length; index += 1) {
            previous = await finalizeChapter(index, previous);
            const task = generateAudio(index).then(() => ({}), (error) => ({ error })); audioTasks.push(task); activeAudio.add(task); void task.then(() => activeAudio.delete(task));
            if (activeAudio.size >= 3) await Promise.race(activeAudio);
          }
        } catch (error) { finalizationFailure = error; }
        if (finalizationFailure !== undefined) { await Promise.all(audioTasks); throw finalizationFailure; }
        await repository.reconcileGeneration(context, bookKey, 2 + chapters.length * 2, now()); await stage('audio', 'narrating');
        const audioResults = await Promise.all(audioTasks); const audioFailure = audioResults.find((result) => result.error !== undefined);
        if (audioFailure) throw audioFailure.error;
        await repository.reconcileGeneration(context, bookKey, 2 + chapters.length * 3, now());
        if (input.chapterImages) { await stage('art', 'narrating'); await boundedMap(chapters, 3, async (chapter, index) => { const imageInputHash = hash({ title: chapter.title, description: chapter.description, content: chapter.content }); if (chapter.imageInputHash === imageInputHash) return; const previousStorageKey = chapter.imageStorageKey; let art: Awaited<ReturnType<typeof pngMedia>> = null; try { art = await pngMedia(await provider(() => image(`Editorial chapter illustration, no text. ${chapter.title}: ${chapter.description}`, context.organizationKey, signal))); } catch (error) { if (context.signal?.aborted || await repository.isCancellationRequested(context, bookKey).catch(() => false)) throw error; } if (art) { const stored = await upload({ key: `books/${input.scopeKey}/${bookKey}/chapter-${chapter.position}-${imageInputHash.slice(0, 12)}-${uploadAttempt}.png`, bytes: art.bytes, mimeType: art.mimeType }); chapters[index] = await repository.updateChapter(context, chapter.key, { imageStorageKey: stored.storageKey, imageInputHash, updatedAt: now() }); pendingUploads.delete(stored.storageKey); if (previousStorageKey && previousStorageKey !== stored.storageKey) await repository.enqueueUnreferencedStorage(context, [previousStorageKey], now()); } await repository.advanceGeneration(context, bookKey, now()); }); await repository.reconcileGeneration(context, bookKey, 2 + chapters.length * 4, now()); }
        await stage('publish', 'finalizing'); await check(context, bookKey); await repository.publishChapters(context, bookKey, input.chapterCount, now()); await (async () => dumpGalleryCopies(await repository.detail(context, bookKey), context))().catch(() => undefined); await notify(input.scopeKey).catch(() => undefined); await notifyContent(input.scopeKey).catch(() => undefined);
      } catch (error) { if (pendingUploads.size) await repository.enqueueUnreferencedStorage(context, [...pendingUploads], now()).catch(() => undefined); const cancellation = await repository.isCancellationRequested(context, bookKey).catch(() => false); if (!cancellation && context.persistFailure !== false) await repository.updateBook(context, bookKey, { status: 'failed', generationError: error instanceof Error ? error.message.slice(0, 4_000) : 'Generation failed.', updatedAt: now() }).catch(() => undefined); throw error; }
    },
  };
}
