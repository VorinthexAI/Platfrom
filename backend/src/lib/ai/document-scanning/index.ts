import { imageCaptionTool } from '@/lib/ai/tools/image-caption';
import { documentKeyForRequest } from '@/lib/ai/document-processing';
import type { DocumentObjectStorage } from '@/lib/ai/document-processing/storage';
import { documentStorage } from '@/lib/ai/document-processing/storage';
import { awsTextractDocumentOcr, type DocumentOcr } from '@/lib/ai/document-processing/textract';
import { signedImageUrl } from '@/lib/gallery/image-url';
import type { DocumentScanInput } from './schemas';

const PAGE_CONCURRENCY = 3;

async function parallelMap<T, R>(values: T[], limit: number, operation: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await operation(values[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return output;
}

export interface DocumentScanDependencies {
  storage?: DocumentObjectStorage;
  ocr?: DocumentOcr;
  signUrl?: (storageKey: string) => Promise<string>;
  caption?: typeof imageCaptionTool.execute;
}

export async function scanDocumentImages(input: DocumentScanInput, organizationKey: string, dependencies: DocumentScanDependencies = {}) {
  const storage = dependencies.storage ?? documentStorage;
  const ocr = dependencies.ocr ?? awsTextractDocumentOcr;
  const signUrl = dependencies.signUrl ?? signedImageUrl;
  const caption = dependencies.caption ?? imageCaptionTool.execute;
  const documentKey = documentKeyForRequest(input.scopeKey, input.folderKey, input.idempotencyKey);
  const storageKeys = input.pages.map((page, index) => `content/${organizationKey}/${input.scopeKey}/${documentKey}/scan/page-${String(index + 1).padStart(2, '0')}.${page.mimeType === 'image/png' ? 'png' : 'jpg'}`);
  const uploaded: string[] = [];
  try {
    await parallelMap(input.pages, PAGE_CONCURRENCY, async (page, index) => {
      await storage.upload({ key: storageKeys[index]!, bytes: page.bytes, mimeType: page.mimeType });
      uploaded.push(storageKeys[index]!);
    });
    const urls = await Promise.all(storageKeys.map(signUrl));
    const [textractPages, aiExtraction] = await Promise.all([
      parallelMap(storageKeys, PAGE_CONCURRENCY, async (key) => (await ocr.extract(key)).extractedText),
      caption({ imageUrls: urls, purpose: 'document-transcription' }, { organizationKey }),
    ]);
    const reconciled = await caption({ imageUrls: urls, purpose: 'document-reconciliation', referenceTexts: textractPages.map((primary, index) => ({ primary, secondary: aiExtraction.captions[index]! })) }, { organizationKey });
    const content = reconciled.captions.map((page, index) => `## Page ${index + 1}\n\n${page.trim()}`).join('\n\n');
    if (!content.trim()) throw new Error('Document scan produced no readable text.');
    return { documentKey, content, storageKeys };
  } catch (error) {
    await Promise.allSettled(uploaded.map((key) => storage.delete(key)));
    throw error;
  }
}

export * from './schemas';
