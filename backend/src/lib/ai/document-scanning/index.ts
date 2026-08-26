import { imageCaptionTool } from '@/lib/ai/tools/image-caption';
import { documentKeyForRequest } from '@/lib/ai/document-processing';
import type { DocumentObjectStorage } from '@/lib/ai/document-processing/storage';
import { documentStorage } from '@/lib/ai/document-processing/storage';
import { awsTextractImageOcr, type DocumentImageOcr } from '@/lib/ai/document-processing/textract';
import { imageDataUrl } from '@/lib/gallery/image-reference';
import { MAX_DOCUMENT_SCAN_PAGE_BYTES, type DocumentScanInput } from './schemas';
import sharp from 'sharp';

const RELIABLE_AVERAGE_CONFIDENCE = 95;
const RELIABLE_MINIMUM_CONFIDENCE = 80;

export interface DocumentScanDependencies {
  storage?: DocumentObjectStorage;
  ocr?: DocumentImageOcr;
  caption?: typeof imageCaptionTool.execute;
  onPageResults?: (pages: Array<{ textract: string; visual: string; unified: string }>) => void | Promise<void>;
}

export function normalizeDocumentTranscription(value: string) {
  const lines = value.replace(/\r\n?/g, '\n')
    .replace(/^\s*```[^\n]*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .replace(/^\s*(?:final\s+)?transcription\s*:\s*/i, '')
    .split('\n').map((line) => line.replace(/\t+/g, ' ').replace(/ {2,}/g, ' ').trim());
  while (lines[0] === '') lines.shift();
  while (lines.at(-1) === '') lines.pop();
  const textLineCount = lines.filter(Boolean).length;
  const blankLineCount = lines.length - textLineCount;
  const textractLineSpacing = textLineCount >= 3 && blankLineCount >= textLineCount - 1;
  return lines.join('\n').replace(textractLineSpacing ? /\n{2,}/g : /\n{3,}/g, textractLineSpacing ? '\n' : '\n\n').trim();
}

export function isReliableDocumentOcr(result: { extractedText: string; metadata?: Record<string, unknown> }) {
  const average = Number(result.metadata?.averageConfidence);
  const minimum = Number(result.metadata?.minimumConfidence);
  return Boolean(result.extractedText.trim()) && Number.isFinite(average) && average >= RELIABLE_AVERAGE_CONFIDENCE && Number.isFinite(minimum) && minimum >= RELIABLE_MINIMUM_CONFIDENCE;
}

export async function scanDocumentImages(input: DocumentScanInput, organizationKey: string, dependencies: DocumentScanDependencies = {}) {
  const storage = dependencies.storage ?? documentStorage;
  const ocr = dependencies.ocr ?? awsTextractImageOcr;
  const caption = dependencies.caption ?? imageCaptionTool.execute;
  const documentKey = documentKeyForRequest(input.scopeKey, input.folderKey, input.idempotencyKey);
  const storageKeys = input.pages.map((_, index) => `content/${organizationKey}/${input.scopeKey}/${documentKey}/scan/page-${String(index + 1).padStart(2, '0')}.png`);
  const uploaded: string[] = [];
  try {
    const pages = await Promise.all(input.pages.map(async (page) => new Uint8Array(await sharp(page.bytes, { animated: false, failOn: 'error', limitInputPixels: 100_000_000 }).rotate().png().toBuffer())));
    if (pages.some((page) => page.byteLength > MAX_DOCUMENT_SCAN_PAGE_BYTES) || pages.reduce((sum, page) => sum + page.byteLength, 0) > MAX_DOCUMENT_SCAN_PAGE_BYTES * 2) throw new Error('Canonical PNG scan pages exceed the supported size limit.');
    await Promise.all(pages.map(async (bytes, index) => {
      await storage.upload({ key: storageKeys[index]!, bytes, mimeType: 'image/png' });
      uploaded.push(storageKeys[index]!);
    }));
    const textractResults = await Promise.all(storageKeys.map((key, index) => ocr.extract(key, pages[index]!)));
    const textractPages = textractResults.map((result) => result.extractedText);
    const visualPages = textractPages.map(() => '');
    const unifiedPages = textractPages.map(normalizeDocumentTranscription);
    await Promise.all(textractResults.map(async (result, index) => {
      if (isReliableDocumentOcr(result)) return;
      const url = imageDataUrl(pages[index]!, 'image/png');
      try {
        visualPages[index] = (await caption({ imageUrls: [url], purpose: 'document-transcription' }, { organizationKey })).results[0]?.caption.trim() ?? '';
      } catch {
        return;
      }
      const primary = unifiedPages[index]!;
      const secondary = normalizeDocumentTranscription(visualPages[index]!);
      if (!secondary) return;
      try {
        unifiedPages[index] = normalizeDocumentTranscription((await caption({ imageUrls: [url], purpose: 'document-reconciliation', referenceTexts: [{ primary, secondary }] }, { organizationKey })).results[0]?.caption ?? '') || primary || secondary;
      } catch {
        unifiedPages[index] = primary || secondary;
      }
    }));
    await dependencies.onPageResults?.(textractPages.map((textract, index) => ({ textract, visual: visualPages[index]!, unified: unifiedPages[index]! })));
    const content = unifiedPages.length === 1 ? normalizeDocumentTranscription(unifiedPages[0]!) : unifiedPages.map((page, index) => `Page ${index + 1}\n\n${normalizeDocumentTranscription(page)}`).join('\n\n');
    if (!content.trim()) throw new Error('Document scan produced no readable text.');
    return { documentKey, content, storageKeys };
  } catch (error) {
    await Promise.allSettled(uploaded.map((key) => storage.delete(key)));
    throw error;
  }
}

export * from './schemas';
