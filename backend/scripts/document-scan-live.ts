#!/usr/bin/env bun
import { resolve } from 'node:path';
import { closeProdSshTunnel, loadEnvironment, type EnvironmentName, verifyDatabaseConnection } from './lib/environment';

const environment = (process.argv[2] ?? 'dev') as EnvironmentName;
if (environment !== 'dev' && environment !== 'prod') throw new Error('Usage: bun run scripts/document-scan-live.ts <dev|prod> [image ...]');
const bucketOverride = process.env.LIVE_SCAN_S3_BUCKET;
const textractOnly = process.env.LIVE_SCAN_TEXTRACT_ONLY === 'true';
const visualOnly = process.env.LIVE_SCAN_VISUAL_ONLY === 'true';
loadEnvironment(environment);
if (bucketOverride) process.env.S3_BUCKET = bucketOverride;
if (environment === 'prod' && /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/)/.test(process.env.AWS_ENDPOINT_URL ?? '')) delete process.env.AWS_ENDPOINT_URL;
if (!textractOnly && !visualOnly) await verifyDatabaseConnection(environment);

const defaultImages = [
  '../../mobile/scripts/assets/screenshots/google/phone/01.png',
  '../../mobile/scripts/assets/screenshots/google/phone/02.png',
];
const imagePaths = (process.argv.slice(3).length ? process.argv.slice(3) : defaultImages).map((path) => resolve(import.meta.dir, path));
const [{ scanDocumentImages }, { documentStorage }, { awsTextractImageOcr }, { newId }, { signedImageUrl }, router, captionConstants] = await Promise.all([
  import('../src/lib/ai/document-scanning'),
  import('../src/lib/ai/document-processing/storage'),
  import('../src/lib/ai/document-processing/textract'),
  import('../src/lib/ids'),
  import('../src/lib/gallery/image-url'),
  import('../src/lib/ai/router'),
  import('../src/lib/image-caption-constants'),
]);
const pages = await Promise.all(imagePaths.map(async (path) => {
  const file = Bun.file(path);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = path.toLowerCase().endsWith('.png') ? 'image/png' as const : 'image/jpeg' as const;
  return { filename: path.split(/[\\/]/).at(-1)!, mimeType, sizeBytes: bytes.byteLength, bytes };
}));
let diagnostics: Array<{ textract: string; visual: string; unified: string }> = [];
let storageKeys: string[] = [];
const startedAt = performance.now();
try {
  if (textractOnly) {
    storageKeys = await Promise.all(pages.map(async (page, index) => {
      const key = `content/live-${environment}/${newId()}/textract-page-${index + 1}.${page.mimeType === 'image/png' ? 'png' : 'jpg'}`;
      await documentStorage.upload({ key, bytes: page.bytes, mimeType: page.mimeType });
      return key;
    }));
    const extracted = await Promise.all(storageKeys.map(async (key, index) => awsTextractImageOcr.extract(key, pages[index]!.bytes)));
    extracted.forEach((page, index) => console.log(`\n===== PAGE ${index + 1}: TEXTRACT =====\n${page.extractedText}`));
    console.log(`\nVerified Textract OCR for ${extracted.length} real image page(s) in ${Math.round(performance.now() - startedAt)} ms.`);
  } else if (visualOnly) {
    storageKeys = await Promise.all(pages.map(async (page, index) => {
      const key = `content/live-${environment}/${newId()}/visual-page-${index + 1}.${page.mimeType === 'image/png' ? 'png' : 'jpg'}`;
      await documentStorage.upload({ key, bytes: page.bytes, mimeType: page.mimeType });
      return key;
    }));
    const urls = await Promise.all(storageKeys.map(signedImageUrl));
    const response = await router.executeAction<{ imageUrls: string[]; purpose: 'document-transcription' }, { results: { caption: string; score: number }[] }>({ mode: 'fixed', actionSlug: 'caption-image', modelSlug: captionConstants.IMAGE_CAPTION_MODEL, providerSlug: 'google-vertex', organizationKey: 'nexus' }, { imageUrls: urls, purpose: 'document-transcription' });
    const visual = response.output;
    visual.results.forEach(({ caption }, index) => console.log(`\n===== PAGE ${index + 1}: VISUAL AI =====\n${caption}`));
    console.log(`\nVerified visual transcription for ${visual.results.length} real image page(s).`);
  } else {
    const result = await scanDocumentImages({ scopeKey: newId(), name: 'Live scan verification', pages, idempotencyKey: `live-${Date.now()}` }, `live-${environment}`, {
      onPageResults(values) { diagnostics = values; },
    });
    storageKeys = result.storageKeys;
    diagnostics.forEach((page, index) => {
      console.log(`\n===== PAGE ${index + 1}: TEXTRACT =====\n${page.textract}`);
      console.log(`\n===== PAGE ${index + 1}: VISUAL AI =====\n${page.visual}`);
      console.log(`\n===== PAGE ${index + 1}: UNIFIED =====\n${page.unified}`);
    });
    console.log(`\nVerified ${diagnostics.length} real image page(s). Final document length: ${result.content.length} characters in ${Math.round(performance.now() - startedAt)} ms.`);
  }
} finally {
  await Promise.allSettled(storageKeys.map((key) => documentStorage.delete(key)));
  closeProdSshTunnel();
}
