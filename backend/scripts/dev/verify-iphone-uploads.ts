/** Isolated HEVC MOV/transparent PNG upload and full-video caption-adapter smoke; no DB writes or model calls. */
import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';
import { mediaDescriptionInputSchema, mediaDescriptionOutputSchema, textAction } from '@/lib/ai/actions/text';
import { documentUploadReserveSchema } from '@/lib/ai/document-processing/direct-upload';
import { mediaCaptionSource } from '@/lib/ai/document-processing/media-caption';
import { createOpenRouterProvider } from '@/lib/ai/providers/openrouter';
import { getExternalModelId } from '@/lib/ai/providers/registry';
import { executeAction } from '@/lib/ai/router';
import { fileStorageKey, fileThumbnailStorageKey } from '@/lib/db/files.node';
import { newId } from '@/lib/ids';
import { createPublicS3Client, s3, S3_BUCKET } from '@/lib/s3';
import { convertedPngFilename, iphoneMediaFilename, iphoneMediaFormat } from '../../../mobile/app/src/lib/iphone-upload-formats';

const runFile = promisify(execFile);

function requireLocalStorage() {
  const endpoint = process.env.S3_ENDPOINT_URL ?? process.env.AWS_ENDPOINT_URL;
  const host = endpoint ? new URL(endpoint).hostname : '';
  if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '[::1]'].includes(host) || S3_BUCKET !== 'vorinthex-dev') {
    throw new Error('The iPhone upload smoke requires local S3/LocalStack and the vorinthex-dev bucket.');
  }
  return endpoint!;
}

async function putAndVerify(key: string, bytes: Buffer, mimeType: string, endpoint: string) {
  const url = await getSignedUrl(createPublicS3Client({ ...process.env, S3_PUBLIC_ENDPOINT_URL: endpoint }), new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, ContentType: mimeType }), { expiresIn: 60 });
  const uploaded = await fetch(url, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: bytes });
  if (!uploaded.ok) throw new Error(`Local signed upload failed (${uploaded.status}).`);
  const head = await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  assert.equal(head.ContentLength, bytes.length);
  assert.equal(head.ContentType, mimeType);
  const object = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  const roundTrip = Buffer.from(await object.Body!.transformToByteArray());
  assert.equal(createHash('sha256').update(roundTrip).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
}

async function sampleHevcMov() {
  const folder = join(import.meta.dir, 'assets');
  await mkdir(folder, { recursive: true });
  const id = newId();
  const movie = join(folder, `iphone-hevc-${id}.mov`);
  const preview = join(folder, `iphone-hevc-${id}.png`);
  const installed = resolve(import.meta.dir, '../../../node_modules/ffmpeg-static/ffmpeg.exe');
  const ffmpeg = process.env.FFMPEG_PATH ?? (existsSync(installed) ? installed : 'ffmpeg');
  try {
    await runFile(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=4', '-t', '1', '-c:v', 'libx265', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', '-x265-params', 'log-level=error', '-y', movie], { timeout: 60_000 });
    const probe = await runFile(ffmpeg, ['-hide_banner', '-i', movie, '-f', 'null', '-'], { timeout: 30_000 });
    assert.match(probe.stderr, /Video: hevc/i);
    await runFile(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', movie, '-vf', 'scale=512:512', '-frames:v', '1', '-y', preview], { timeout: 30_000 });
    const [bytes, thumbnail] = await Promise.all([readFile(movie), readFile(preview)]);
    assert.equal((await sharp(thumbnail).metadata()).format, 'png');
    return { bytes, thumbnail };
  } finally {
    await Promise.all([movie, preview].map((file) => unlink(file).catch(() => undefined)));
  }
}

async function verifyMovCaptionSource(storageKey: string, video: Buffer, endpoint: string, live: boolean) {
  const source = mediaCaptionSource({ extension: 'mov', mimeType: 'video/quicktime', storageKey });
  assert.deepEqual(source, { kind: 'video', mimeType: 'video/mov', storageKey });
  const url = await getSignedUrl(createPublicS3Client({ ...process.env, S3_PUBLIC_ENDPOINT_URL: endpoint }), new GetObjectCommand({ Bucket: S3_BUCKET, Key: storageKey }), { expiresIn: 60 });
  const input = mediaDescriptionInputSchema.parse({ operation: 'describe-media', media: { kind: source.kind, mimeType: source.mimeType, url } });
  let requests = 0;
  const fakeFetch: typeof fetch = (request, init) => {
    if (new URL(String(request)).hostname === new URL(endpoint).hostname) return fetch(request, init);
    requests += 1;
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: Array<{ type: string; video_url?: { url: string } }> }> };
    const content = body.messages[0]!.content;
    assert.equal(content[1]?.type, 'video_url');
    assert.equal(content.some((part) => part.type === 'image_url'), false);
    const inline = content[1]!.video_url!.url;
    assert.ok(inline.startsWith('data:video/mov;base64,'));
    assert.deepEqual(Buffer.from(inline.slice('data:video/mov;base64,'.length), 'base64'), video);
    return Promise.resolve(Response.json({ choices: [{ message: { content: '{"caption":"A red video clip."}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
  };
  const adapter = createOpenRouterProvider({ apiKey: 'local-dummy-token' }, fakeFetch);
  const primary = textAction.models.find(({ slot }) => slot === 'primary');
  if (!primary || primary.provider !== 'openrouter') throw new Error('The text action has no OpenRouter primary route.');
  const externalModelId = getExternalModelId(primary.model, primary.provider);
  if (!externalModelId) throw new Error('The primary text model is missing its external ID.');
  const result = await adapter.execute({ actionId: 'text', teamKey: newId(), modelId: primary.model, externalModelId, input });
  assert.equal(mediaDescriptionOutputSchema.parse(result.output).caption, 'A red video clip.');
  assert.equal(requests, 1);
  if (live) {
    const response = await executeAction<typeof input, { caption: string }>(
      { mode: 'auto', teamKey: newId(), actionSlug: 'text' }, input,
      { providers: ['text.primary'], timeoutMs: 120_000, retry: { attempts: 1 } },
    );
    assert.ok(mediaDescriptionOutputSchema.parse(response.output).caption);
    console.log('Live provider captioned the original HEVC MOV.');
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--live')) throw new Error('Only --live is supported.');
  const endpoint = requireLocalStorage();
  for (const [name, mime] of [['IMG_0001.HEIC', 'image/heic'], ['IMG_0001.HEIF', 'image/heif'], ['photo.jpg', 'image/jpeg'], ['photo.webp', 'image/webp'], ['photo.gif', 'image/gif'], ['photo.png', 'image/png']]) {
    assert.equal(iphoneMediaFormat(name!, mime!), 'convert-png');
    assert.equal(convertedPngFilename(name!).endsWith('.png'), true);
  }
  assert.equal(iphoneMediaFilename(null, 'video/quicktime', 'video', 1), 'media-2.mov');
  assert.equal(iphoneMediaFilename('clip.mp4', 'video/quicktime', 'video', 1), 'clip.mov');

  // A real, tiny hvc1/HEVC QuickTime sample and its decoded preview are generated locally.
  const { bytes: mov, thumbnail: videoThumbnail } = await sampleHevcMov();
  const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 51, g: 68, b: 85, alpha: 0.5 } } }).png().toBuffer();
  const imageThumbnail = await sharp(png).resize({ width: 512 }).png().toBuffer();
  assert.equal((await sharp(png).metadata()).hasAlpha, true);
  const scopeKey = newId();
  const userKey = newId();
  const images = [
    { filename: 'IMG_0001.png', extension: 'png', mimeType: 'image/png', bytes: png, preview: imageThumbnail, previewMime: 'image/png' },
    { filename: 'IMG_0002.mov', extension: 'mov', mimeType: 'video/quicktime', bytes: mov, preview: videoThumbnail, previewMime: 'image/png' },
  ] as const;
  documentUploadReserveSchema.parse({ scopeKey, idempotencyKey: 'iphone-format-smoke', files: images.map(({ bytes, preview, previewMime, ...file }) => ({ ...file, sizeBytes: bytes.length, thumbnail: { mimeType: previewMime, sizeBytes: preview.length } })) });
  assert.equal(documentUploadReserveSchema.safeParse({ scopeKey, idempotencyKey: 'bad-quicktime', files: [{ filename: 'video.mov', mimeType: 'video/mp4', sizeBytes: mov.length, extension: 'mov' }] }).success, false);
  assert.equal(documentUploadReserveSchema.safeParse({ scopeKey, idempotencyKey: 'no-preview', files: [{ filename: 'video.mov', mimeType: 'video/quicktime', sizeBytes: mov.length, extension: 'mov' }] }).success, false);
  assert.equal(documentUploadReserveSchema.safeParse({ scopeKey, idempotencyKey: 'wrong-preview', files: [{ filename: 'video.mov', mimeType: 'video/quicktime', sizeBytes: mov.length, extension: 'mov', thumbnail: { mimeType: 'image/jpeg', sizeBytes: imageThumbnail.length } }] }).success, false);

  const touched: string[] = [];
  try {
    for (const image of images) {
      const fileKey = newId();
      const key = fileStorageKey(userKey, fileKey, image.extension);
      touched.push(key);
      await putAndVerify(key, image.bytes, image.mimeType, endpoint);
      const thumbKey = fileThumbnailStorageKey(userKey, fileKey, image.previewMime);
      touched.push(thumbKey);
      await putAndVerify(thumbKey, image.preview, image.previewMime, endpoint);
      if (image.extension === 'png') assert.equal((await sharp(image.bytes).metadata()).hasAlpha, true);
      else await verifyMovCaptionSource(key, image.bytes, endpoint, args.includes('--live'));
      console.log(`${image.extension.toUpperCase()}: signed upload, MIME/bytes, ${image.extension === 'mov' ? 'HEVC decoding and mock full-video caption' : 'transparency'} verified.`);
    }
  } finally {
    await Promise.all(touched.map((key) => s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }))));
  }
}

if (import.meta.main) main().catch((error) => { console.error(error); process.exitCode = 1; });
