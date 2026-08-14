import { imageCaptionTool } from '@/lib/ai/tools/image-caption';
import { documentKeyForRequest } from '@/lib/ai/document-processing';
import type { DocumentObjectStorage } from '@/lib/ai/document-processing/storage';
import { documentStorage } from '@/lib/ai/document-processing/storage';
import { awsTextractImageOcr, type DocumentImageOcr } from '@/lib/ai/document-processing/textract';
import { signedImageUrl } from '@/lib/gallery/image-url';
import type { DocumentScanInput } from './schemas';

export interface DocumentScanDependencies {
  storage?: DocumentObjectStorage;
  ocr?: DocumentImageOcr;
  signUrl?: (storageKey: string) => Promise<string>;
  caption?: typeof imageCaptionTool.execute;
  onPageResults?: (pages: Array<{ textract: string; visual: string; unified: string }>) => void | Promise<void>;
}

export async function scanDocumentImages(input: DocumentScanInput, organizationKey: string, dependencies: DocumentScanDependencies = {}) {
  const storage = dependencies.storage ?? documentStorage;
  const ocr = dependencies.ocr ?? awsTextractImageOcr;
  const signUrl = dependencies.signUrl ?? signedImageUrl;
  const caption = dependencies.caption ?? imageCaptionTool.execute;
  const documentKey = documentKeyForRequest(input.scopeKey, input.folderKey, input.idempotencyKey);
  const storageKeys = input.pages.map((page, index) => `content/${organizationKey}/${input.scopeKey}/${documentKey}/scan/page-${String(index + 1).padStart(2, '0')}.${page.mimeType === 'image/png' ? 'png' : 'jpg'}`);
  const uploaded: string[] = [];
  try {
    await Promise.all(input.pages.map(async (page, index) => {
      await storage.upload({ key: storageKeys[index]!, bytes: page.bytes, mimeType: page.mimeType });
      uploaded.push(storageKeys[index]!);
    }));
    const urls = await Promise.all(storageKeys.map(signUrl));
    const [textractPages, aiExtraction] = await Promise.all([
      Promise.all(storageKeys.map(async (key, index) => (await ocr.extract(key, input.pages[index]!.bytes)).extractedText)),
      caption({ imageUrls: urls, purpose: 'document-transcription' }, { organizationKey }),
    ]);
    const reconciled = await caption({ imageUrls: urls, purpose: 'document-reconciliation', referenceTexts: textractPages.map((primary, index) => ({ primary, secondary: aiExtraction.captions[index]! })) }, { organizationKey });
    await dependencies.onPageResults?.(textractPages.map((textract, index) => ({ textract, visual: aiExtraction.captions[index]!, unified: reconciled.captions[index]! })));
    const content = reconciled.captions.map((page, index) => `## Page ${index + 1}\n\n${page.trim()}`).join('\n\n');
    if (!content.trim()) throw new Error('Document scan produced no readable text.');
    return { documentKey, content, storageKeys };
  } catch (error) {
    await Promise.allSettled(uploaded.map((key) => storage.delete(key)));
    throw error;
  }
}

export * from './schemas';
