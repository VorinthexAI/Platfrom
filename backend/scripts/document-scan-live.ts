#!/usr/bin/env bun
import { resolve } from 'node:path';
import { loadEnvironment, type EnvironmentName } from './lib/environment';

const environment = (process.argv[2] ?? 'dev') as EnvironmentName;
if (environment !== 'dev' && environment !== 'prod') throw new Error('Usage: bun run scripts/document-scan-live.ts <dev|prod> [image ...]');
const bucketOverride = process.env.LIVE_SCAN_S3_BUCKET;
loadEnvironment(environment);
if (bucketOverride) process.env.S3_BUCKET = bucketOverride;
if (environment === 'prod' && /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/)/.test(process.env.AWS_ENDPOINT_URL ?? '')) delete process.env.AWS_ENDPOINT_URL;
if (environment === 'prod' && process.env.BEDROCK_AWS_ACCESS_KEY_ID) {
  process.env.AWS_ACCESS_KEY_ID = process.env.BEDROCK_AWS_ACCESS_KEY_ID;
  process.env.AWS_SECRET_ACCESS_KEY = process.env.BEDROCK_AWS_SECRET_ACCESS_KEY;
  if (process.env.BEDROCK_AWS_SESSION_TOKEN && process.env.BEDROCK_AWS_SESSION_TOKEN !== 'undefined') process.env.AWS_SESSION_TOKEN = process.env.BEDROCK_AWS_SESSION_TOKEN;
  else delete process.env.AWS_SESSION_TOKEN;
}

const defaultImages = [
  '../../mobile/scripts/assets/screenshots/google/phone/01.png',
  '../../mobile/scripts/assets/screenshots/google/phone/02.png',
];
const imagePaths = (process.argv.slice(3).length ? process.argv.slice(3) : defaultImages).map((path) => resolve(import.meta.dir, path));
const [{ scanDocumentImages }, { documentStorage }, { newId }, { signedImageUrl }, openrouter, captionConstants] = await Promise.all([
  import('../src/lib/ai/document-scanning'),
  import('../src/lib/ai/document-processing/storage'),
  import('../src/lib/ids'),
  import('../src/lib/gallery/image-url'),
  import('../src/lib/ai/providers/openrouter'),
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
try {
  if (process.env.LIVE_SCAN_VISUAL_ONLY === 'true') {
    storageKeys = await Promise.all(pages.map(async (page, index) => {
      const key = `content/live-${environment}/${newId()}/visual-page-${index + 1}.${page.mimeType === 'image/png' ? 'png' : 'jpg'}`;
      await documentStorage.upload({ key, bytes: page.bytes, mimeType: page.mimeType });
      return key;
    }));
    const urls = await Promise.all(storageKeys.map(signedImageUrl));
    const provider = openrouter.createOpenRouterProvider(openrouter.resolveOpenRouterEnvironment(process.env));
    const response = await provider.execute<{ imageUrls: string[]; purpose: 'document-transcription' }, { captions: string[] }>({ actionId: 'caption-image', modelId: captionConstants.IMAGE_CAPTION_MODEL, externalModelId: captionConstants.IMAGE_CAPTION_EXTERNAL_MODEL_ID, input: { imageUrls: urls, purpose: 'document-transcription' }, organizationKey: 'nexus' });
    const visual = response.output;
    visual.captions.forEach((text, index) => console.log(`\n===== PAGE ${index + 1}: VISUAL AI =====\n${text}`));
    console.log(`\nVerified Qwen transcription for ${visual.captions.length} real image page(s).`);
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
    console.log(`\nVerified ${diagnostics.length} real image page(s). Final document length: ${result.content.length} characters.`);
  }
} finally {
  await Promise.allSettled(storageKeys.map((key) => documentStorage.delete(key)));
}
