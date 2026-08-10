import { z } from 'zod';
import { createHash } from 'node:crypto';

export const DOCUMENT_CHUNK_MAX_WORDS = 1_000;
export const DOCUMENT_CHUNK_MAX_CHARACTERS = 16_000;
export const DOCUMENT_MAX_CHUNKS = 640;
export const DOCUMENT_CHUNK_OVERLAP_WORDS = 100;
export const DOCUMENT_CHUNK_OVERLAP_CHARACTERS = 1_600;

function countWords(value: string): number {
  return value.match(/\S+/g)?.length ?? 0;
}

const chunkTextSchema = z.string().min(1).max(DOCUMENT_CHUNK_MAX_CHARACTERS).refine((value) => value.trim().length > 0, 'Document chunks cannot be blank.');

export const documentTextChunkSchema = z.object({
  index: z.number().int().nonnegative(),
  text: chunkTextSchema,
  wordCount: z.number().int().min(1).max(DOCUMENT_CHUNK_MAX_WORDS),
}).strict();

export type DocumentTextChunk = z.infer<typeof documentTextChunkSchema>;

export const documentTextChunksSchema = z.array(documentTextChunkSchema).max(DOCUMENT_MAX_CHUNKS).superRefine((chunks, context) => {
  for (const [position, chunk] of chunks.entries()) {
    if (chunk.index !== position) context.addIssue({ code: z.ZodIssueCode.custom, path: [position, 'index'], message: 'Chunk indices must be contiguous and zero-based.' });
    if (countWords(chunk.text) !== chunk.wordCount) context.addIssue({ code: z.ZodIssueCode.custom, path: [position, 'wordCount'], message: 'Chunk wordCount must match its text.' });
  }
});

export const documentContentChunksSchema = z.array(chunkTextSchema.refine(
  (text) => countWords(text) <= DOCUMENT_CHUNK_MAX_WORDS,
  `Document chunks cannot exceed ${DOCUMENT_CHUNK_MAX_WORDS} words.`,
)).min(1).max(DOCUMENT_MAX_CHUNKS);

function preferredBoundary(value: string, start: number, maximum: number): number {
  const candidate = value.slice(start, start + maximum);
  const minimum = Math.min(256, Math.floor(maximum / 2));
  for (const pattern of [/\n\s*\n/g, /[.!?]["')\]]?\s+/g, /\s+/g]) {
    let boundary = 0;
    for (const match of candidate.matchAll(pattern)) {
      const end = match.index + match[0].length;
      if (end >= minimum) boundary = end;
    }
    if (boundary) return boundary;
  }
  return maximum;
}

/** Produces deterministic exact slices whose concatenation equals canonical input. */
export function chunkDocumentText(text: string): DocumentTextChunk[] {
  const source = text.trim();
  if (!source) return [];
  const chunks: DocumentTextChunk[] = [];
  let offset = 0;

  while (offset < source.length) {
    const remainingLength = source.length - offset;
    let wordBoundary = remainingLength;
    let scannedWordCount = 0;
    const scan = source.slice(offset, offset + DOCUMENT_CHUNK_MAX_CHARACTERS + 1);
    for (const word of scan.matchAll(/\S+/g)) {
      if (scannedWordCount++ === DOCUMENT_CHUNK_MAX_WORDS) {
        wordBoundary = word.index;
        break;
      }
    }
    const hardMaximum = Math.min(remainingLength, DOCUMENT_CHUNK_MAX_CHARACTERS, wordBoundary);
    const length = hardMaximum === remainingLength ? hardMaximum : preferredBoundary(source, offset, hardMaximum);
    const chunk = source.slice(offset, offset + Math.max(length, 1));
    const wordCount = countWords(chunk);
    if (!wordCount) throw new Error('Document chunking could not make progress through whitespace.');
    chunks.push({ index: chunks.length, text: chunk, wordCount });
    if (chunks.length > DOCUMENT_MAX_CHUNKS) throw new Error(`Document content exceeds the maximum of ${DOCUMENT_MAX_CHUNKS} semantic chunks.`);
    offset += chunk.length;
  }

  return documentTextChunksSchema.parse(chunks);
}

export function chunkDocumentContent(text: string): string[] {
  const chunks = documentTextChunksSchema.parse(chunkDocumentText(text)).map((chunk) => chunk.text);
  return documentContentChunksSchema.parse(chunks);
}

function trailingSemanticContext(text: string): string {
  const bounded = text.slice(-DOCUMENT_CHUNK_OVERLAP_CHARACTERS);
  const words = [...bounded.matchAll(/\S+/g)];
  const wordStart = words.at(-DOCUMENT_CHUNK_OVERLAP_WORDS)?.index ?? 0;
  const candidate = bounded.slice(wordStart);
  const paragraph = candidate.lastIndexOf('\n\n');
  const sentence = [...candidate.matchAll(/[.!?]["')\]]?\s+/g)].at(-1);
  const boundary = Math.max(paragraph >= 0 ? paragraph + 2 : 0, sentence ? sentence.index + sentence[0].length : 0);
  return candidate.slice(boundary).trim() || candidate.trim();
}

/** Builds bounded, deterministic retrieval passages while keeping stored chunks exact and non-overlapping. */
export function documentEmbeddingTexts(name: string, chunks: string[]): string[] {
  return chunks.map((chunk, index) => [
    name.trim(),
    index > 0 ? `Previous context:\n${trailingSemanticContext(chunks[index - 1]!)}` : '',
    chunk.trim(),
  ].filter(Boolean).join('\n\n'));
}

export function documentSemanticHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
