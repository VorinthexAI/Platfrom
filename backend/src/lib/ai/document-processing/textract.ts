import {
  AnalyzeDocumentCommand,
  GetDocumentAnalysisCommand,
  StartDocumentAnalysisCommand,
  TextractClient,
  type Block,
} from '@aws-sdk/client-textract';
import { createHash } from 'node:crypto';
import { S3_BUCKET } from '@/lib/s3';
import type { ExtractionResult } from './schemas';
import { htmlToExtractedBlocks, htmlToPlainText, sanitizeDocumentHtml } from './representation';

function positiveLimit(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const textract = new TextractClient({
  region: process.env.AWS_REGION ?? 'eu-north-1',
  endpoint: process.env.AWS_ENDPOINT_URL,
  credentials: process.env.AWS_ACCESS_KEY_ID ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
    ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
  } : undefined,
});

const imageTextract = new TextractClient({
  region: process.env.CONTENT_SCAN_TEXTRACT_REGION ?? (process.env.AWS_ENDPOINT_URL ? process.env.AWS_REGION : undefined) ?? 'eu-west-1',
  endpoint: process.env.AWS_ENDPOINT_URL,
  credentials: process.env.AWS_ACCESS_KEY_ID ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
    ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
  } : undefined,
});

const wait = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(signal.reason);
  const timeout = setTimeout(done, milliseconds);
  function done() {
    signal.removeEventListener('abort', aborted);
    resolve();
  }
  function aborted() {
    clearTimeout(timeout);
    reject(signal.reason);
  }
  signal.addEventListener('abort', aborted, { once: true });
});

export interface DocumentOcr {
  extract(storageKey: string): Promise<ExtractionResult>;
}

export interface DocumentImageOcr {
  extract(storageKey: string, bytes: Uint8Array): Promise<ExtractionResult>;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

function relatedIds(block: Block, type = 'CHILD') {
  return block.Relationships?.filter((relationship) => relationship.Type === type).flatMap((relationship) => relationship.Ids ?? []) ?? [];
}

function relatedText(block: Block, byId: Map<string, Block>, visited = new Set<string>()): string {
  if (block.Text?.trim()) return block.Text.trim();
  if (block.Id) {
    if (visited.has(block.Id)) return '';
    visited.add(block.Id);
  }
  return relatedIds(block).map((id) => byId.get(id)).filter((child): child is Block => Boolean(child)).map((child) => relatedText(child, byId, new Set(visited))).filter(Boolean).join(' ').trim();
}

function tableHtml(table: Block, byId: Map<string, Block>) {
  const cells = relatedIds(table).map((id) => byId.get(id)).filter((block): block is Block => block?.BlockType === 'CELL');
  const rows = new Map<number, Block[]>();
  for (const cell of cells) {
    const row = cell.RowIndex ?? 1;
    const rowCells = rows.get(row) ?? [];
    rowCells.push(cell);
    rows.set(row, rowCells);
  }
  const body = [...rows.entries()].sort(([a], [b]) => a - b).map(([, row]) => `<tr>${row.sort((a, b) => (a.ColumnIndex ?? 0) - (b.ColumnIndex ?? 0)).map((cell) => {
    const header = cell.EntityTypes?.includes('COLUMN_HEADER');
    const tag = header ? 'th' : 'td';
    const columnSpan = (cell.ColumnSpan ?? 1) > 1 ? ` colspan="${cell.ColumnSpan}"` : '';
    const rowSpan = (cell.RowSpan ?? 1) > 1 ? ` rowspan="${cell.RowSpan}"` : '';
    return `<${tag}${columnSpan}${rowSpan}>${escapeHtml(relatedText(cell, byId))}</${tag}>`;
  }).join('')}</tr>`).join('');
  return body ? `<table><tbody>${body}</tbody></table>` : '';
}

function layoutHtml(block: Block, byId: Map<string, Block>) {
  const text = relatedText(block, byId);
  if (block.BlockType === 'LAYOUT_TITLE') return text ? `<h1>${escapeHtml(text)}</h1>` : '';
  if (block.BlockType === 'LAYOUT_SECTION_HEADER') return text ? `<h2>${escapeHtml(text)}</h2>` : '';
  if (block.BlockType === 'LAYOUT_LIST') {
    const items = relatedIds(block).map((id) => byId.get(id)).filter((child): child is Block => Boolean(child)).map((child) => relatedText(child, byId)).filter(Boolean);
    return items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '';
  }
  if (block.BlockType === 'LAYOUT_FIGURE') return text ? `<figure><figcaption>${escapeHtml(text)}</figcaption></figure>` : '';
  if (block.BlockType === 'LAYOUT_TABLE') {
    const table = relatedIds(block).map((id) => byId.get(id)).find((child) => child?.BlockType === 'TABLE');
    return table ? tableHtml(table, byId) : '';
  }
  if (block.BlockType === 'LAYOUT_HEADER' || block.BlockType === 'LAYOUT_FOOTER' || block.BlockType === 'LAYOUT_PAGE_NUMBER') {
    return text ? `<p><em>${escapeHtml(text)}</em></p>` : '';
  }
  return text ? `<p>${escapeHtml(text)}</p>` : '';
}

export function textractBlocksToExtractionResult(blocks: Block[]): ExtractionResult {
  const uniqueBlocks = [...new Map(blocks.map((block, index) => [block.Id ?? `anonymous-${index}`, block])).values()];
  const byId = new Map(uniqueBlocks.flatMap((block) => block.Id ? [[block.Id, block] as const] : []));
  const pages = new Map<number, Block[]>();
  for (const block of uniqueBlocks) {
    if (block.BlockType?.startsWith('LAYOUT_')) {
      const page = block.Page ?? 1;
      const pageBlocks = pages.get(page) ?? [];
      pageBlocks.push(block);
      pages.set(page, pageBlocks);
    }
  }
  if (!pages.size) {
    for (const block of uniqueBlocks) {
      if (block.BlockType === 'LINE' && block.Text?.trim()) {
        const page = block.Page ?? 1;
        const pageBlocks = pages.get(page) ?? [];
        pageBlocks.push(block);
        pages.set(page, pageBlocks);
      }
    }
  }
  const extractedHtml = sanitizeDocumentHtml([...pages.entries()].sort(([a], [b]) => a - b).map(([page, pageBlocks]) => {
    const sorted = pageBlocks.sort((a, b) => (a.Geometry?.BoundingBox?.Top ?? 0) - (b.Geometry?.BoundingBox?.Top ?? 0) || (a.Geometry?.BoundingBox?.Left ?? 0) - (b.Geometry?.BoundingBox?.Left ?? 0));
    const content = sorted.map((block) => block.BlockType?.startsWith('LAYOUT_') ? layoutHtml(block, byId) : `<p>${escapeHtml(block.Text?.trim() ?? '')}</p>`).join('');
    return `<section class="doc-page" data-page="${page}">${content}</section>`;
  }).join(''));
  const extractedText = htmlToPlainText(extractedHtml);
  return {
    extractedText,
    extractedHtml,
    blocks: htmlToExtractedBlocks(extractedHtml),
    metadata: { provider: 'aws-textract', layout: 'semantic', pages: pages.size },
  };
}

export const awsTextractDocumentOcr: DocumentOcr = {
  async extract(storageKey) {
    const timeoutMs = positiveLimit(process.env.CONTENT_TEXTRACT_TIMEOUT_MS, 300_000);
    const maxCharacters = positiveLimit(process.env.CONTENT_MAX_EXTRACTED_CHARACTERS, 10_000_000);
    const maxBlocks = positiveLimit(process.env.CONTENT_TEXTRACT_MAX_BLOCKS, 250_000);
    const deadline = Date.now() + timeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const started = await textract.send(new StartDocumentAnalysisCommand({
        DocumentLocation: { S3Object: { Bucket: S3_BUCKET, Name: storageKey } },
        FeatureTypes: ['LAYOUT', 'TABLES'],
        ClientRequestToken: createHash('sha256').update(S3_BUCKET).update('\0').update(storageKey).digest('hex'),
      }), { abortSignal: controller.signal });
      if (!started.JobId) throw new Error('AWS Textract did not return a job identifier.');

      const blocks: Block[] = [];
      const blockIds = new Set<string>();
      const seenTokens = new Set<string>();
      let nextToken: string | undefined;
      let pollAttempt = 0;
      do {
        let response;
        do {
          if (Date.now() >= deadline) throw new Error('AWS Textract extraction timed out.');
          response = await textract.send(new GetDocumentAnalysisCommand({ JobId: started.JobId, NextToken: nextToken }), { abortSignal: controller.signal });
          if (response.JobStatus === 'FAILED' || response.JobStatus === 'PARTIAL_SUCCESS') {
            throw new Error('AWS Textract could not extract the document.');
          }
          if (response.JobStatus === 'IN_PROGRESS') {
            const delay = Math.min(500 * 2 ** pollAttempt, 5_000) + Math.floor(Math.random() * 250);
            pollAttempt += 1;
            await wait(delay, controller.signal);
          }
        } while (response.JobStatus === 'IN_PROGRESS');
        pollAttempt = 0;
        if (response.JobStatus !== 'SUCCEEDED') throw new Error(`AWS Textract returned unexpected status ${response.JobStatus ?? 'unknown'}.`);
        for (const block of response.Blocks ?? []) {
          if (block.Id && blockIds.has(block.Id)) continue;
          if (block.Id) blockIds.add(block.Id);
          blocks.push(block);
          if (blocks.length > maxBlocks) throw new Error(`AWS Textract exceeded the configured limit of ${maxBlocks} blocks.`);
        }
        nextToken = response.NextToken;
        if (nextToken && seenTokens.has(nextToken)) throw new Error('AWS Textract returned a repeated pagination token.');
        if (nextToken) seenTokens.add(nextToken);
      } while (nextToken);

      const result = textractBlocksToExtractionResult(blocks);
      if (result.extractedText.length > maxCharacters) throw new Error('Extracted document content exceeds the configured limit.');
      return result;
    } finally {
      clearTimeout(timeout);
    }
  },
};

export const awsTextractImageOcr: DocumentImageOcr = {
  async extract(_storageKey, bytes) {
    const timeoutMs = positiveLimit(process.env.CONTENT_TEXTRACT_TIMEOUT_MS, 300_000);
    const maxCharacters = positiveLimit(process.env.CONTENT_MAX_EXTRACTED_CHARACTERS, 10_000_000);
    const response = await imageTextract.send(new AnalyzeDocumentCommand({ Document: { Bytes: bytes }, FeatureTypes: ['LAYOUT', 'TABLES'] }), { abortSignal: AbortSignal.timeout(timeoutMs) });
    const result = textractBlocksToExtractionResult(response.Blocks ?? []);
    if (result.extractedText.length > maxCharacters) throw new Error('Extracted document content exceeds the configured limit.');
    return result;
  },
};
