import { z } from 'zod';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { sanitizeDocumentContent } from './actions';
import { chunkDocumentContent, documentSemanticHash } from './chunking';

export interface DocumentRepresentationActionResult {
  embedding?: number[];
  contentChunks?: string[];
  chunkEmbeddings?: number[][];
  semanticChunkCount?: number;
  semanticContentHash?: string;
}

export interface PreparedDocumentRepresentation {
  content: string;
  embedding: number[];
  contentChunks: string[];
  chunkEmbeddings: number[][];
  semanticChunkCount: number;
  semanticContentHash: string;
}

export interface PrepareDocumentRepresentationDependencies {
  documentEmbed: (input: { name: string; content: string }) => Promise<DocumentRepresentationActionResult>;
  embeddingDimensions?: number;
}

/** Prepares canonical Archive representation fields without authorization or persistence. */
export async function prepareDocumentRepresentation(
  input: { name: string; content: string; semanticSource?: string },
  dependencies: PrepareDocumentRepresentationDependencies,
): Promise<PreparedDocumentRepresentation> {
  const content = sanitizeDocumentContent(z.string().min(1).parse(input.content));
  if (!content) throw new Error('Document content is empty.');
  const semanticSource = input.semanticSource === undefined
    ? content
    : sanitizeDocumentContent(z.string().min(1).parse(input.semanticSource));
  if (!semanticSource) throw new Error('Document semantic source is empty.');

  const dimensions = dependencies.embeddingDimensions ?? EMBEDDING_DIMENSIONS;
  const vectorSchema = z.array(z.number().finite()).length(dimensions);
  const expectedChunks = chunkDocumentContent(semanticSource);
  const expectedHash = documentSemanticHash(semanticSource);
  const embedded = await dependencies.documentEmbed({ name: input.name, content: semanticSource });
  const embedding = vectorSchema.parse(embedded.embedding);
  const contentChunks = embedded.contentChunks ?? expectedChunks;
  if (contentChunks.length !== expectedChunks.length || contentChunks.some((chunk, index) => chunk !== expectedChunks[index])) {
    throw new Error('Document embedding chunks must be derived from the canonical semantic source.');
  }
  const chunkEmbeddings = embedded.chunkEmbeddings
    ? z.array(vectorSchema).length(contentChunks.length).parse(embedded.chunkEmbeddings)
    : contentChunks.length === 1 ? [embedding] : undefined;
  if (!chunkEmbeddings) throw new Error('Document embedding action did not return every semantic chunk.');
  const semanticChunkCount = embedded.semanticChunkCount ?? contentChunks.length;
  if (semanticChunkCount !== contentChunks.length) throw new Error('Document semantic chunk count does not match its chunks.');
  const semanticContentHash = embedded.semanticContentHash ?? expectedHash;
  if (semanticContentHash !== expectedHash) throw new Error('Document semantic content hash does not match its source.');

  return { content, embedding, contentChunks, chunkEmbeddings, semanticChunkCount, semanticContentHash };
}

const namedEntities: Record<string, string> = {
  amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
};

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== '#') return namedEntities[code.toLowerCase()] ?? entity;
    const numeric = code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
    return Number.isFinite(numeric) && numeric > 0 && numeric <= 0x10ffff ? String.fromCodePoint(numeric) : entity;
  });
}

/** Recovers plain text from the legacy HTML field during the destructive data migration. */
export function htmlToPlainText(input: string): string {
  return decodeHtmlEntities(input
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<img\b[^>]*\balt\s*=\s*(["'])(.*?)\1[^>]*>/gi, '$2\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:td|th)>/gi, '\t')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/(?:address|article|aside|blockquote|div|figcaption|figure|footer|h[1-6]|header|li|main|nav|ol|p|pre|section|table|ul)>/gi, '\n\n')
    .replace(/<\/?[a-z][^>]*>/gi, ''))
    .replace(/\u00a0/g, ' ')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
