import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { insertOutput } from '@/lib/db/outputs.node';
import { newId } from '@/lib/ids';
import { S3_BUCKET, s3 } from '@/lib/s3';
import { renderHtmlToPdf, renderHtmlToPng } from '@/core/headless-browser';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';

export const EXECUTION_TARGET = 'render' as const;

const ALLOWED_LAYOUT_SLUGS = new Set(['default']);
const VIDEO_TIMEOUT_MS = 5 * 60 * 1000;

const DIMENSIONS = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1920 },
} as const;

const orientationSchema = z.enum(['square', 'portrait']);
const renderFormatSchema = z.enum(['png', 'pdf', 'video']);

export type Orientation = z.infer<typeof orientationSchema>;
export type RenderFormat = z.infer<typeof renderFormatSchema>;

const renderVariantSchema = z.object({
  orientation: orientationSchema,
  format: renderFormatSchema,
});

const slideInputSchema = z.object({
  backgroundImageKey: z.string().min(1),
  title: z.string(),
  imageAlt: z.string(),
  overlayText: z.string().max(140).optional(),
  layoutSlug: z.string().default('default'),
});

export const renderPostInputSchema = z.object({
  postId: z.string().min(1),
  slides: z.array(slideInputSchema).min(1),
  variants: z.array(renderVariantSchema).min(1),
  videoConfig: z.record(z.string(), z.unknown()).optional(),
});

type RenderPostInput = z.input<typeof renderPostInputSchema>;
type SlideInput = z.infer<typeof slideInputSchema>;
type RenderVariant = z.infer<typeof renderVariantSchema>;
type RenderResult = { orientation: Orientation; format: RenderFormat; s3Key?: string; error?: string };

export async function render_post(input: RenderPostInput): Promise<{ status: 'done' | 'failed'; results: RenderResult[] }> {
  try {
    const parsed = renderPostInputSchema.parse(input);
    validateVariants(parsed.variants);
    for (const slide of parsed.slides) validateLayoutSlug(slide.layoutSlug);

    const postType = parsed.slides.length === 1 ? 'single' : 'multi';
    const imageDataByKey = await resolveSlideImages(parsed.slides);
    const neededOrientations = getNeededPngFrameOrientations(parsed.variants);
    const frames = new Map<Orientation, Buffer[]>();
    const htmlByOrientation = new Map<Orientation, string[]>();

    for (const orientation of neededOrientations) {
      const renderedFrames: Buffer[] = [];
      const populatedLayouts: string[] = [];
      for (const slide of parsed.slides) {
        const html = await populateLayout({ postType, orientation, slide, imageUrl: imageDataByKey.get(slide.backgroundImageKey)! });
        populatedLayouts.push(html);
        renderedFrames.push(await renderHtmlToPng(html, DIMENSIONS[orientation]));
      }
      frames.set(orientation, renderedFrames);
      htmlByOrientation.set(orientation, populatedLayouts);
    }

    const results: RenderResult[] = [];
    for (const variant of parsed.variants) {
      if (variant.format === 'png') {
        results.push(await runRequiredVariant(variant, () => uploadPngFrames(parsed.postId, variant.orientation, frames.get(variant.orientation) ?? [])));
      } else if (variant.format === 'pdf') {
        results.push(await runRequiredVariant(variant, async () => {
          const layouts = htmlByOrientation.get(variant.orientation)
            ?? await populateAllLayouts(postType, variant.orientation, parsed.slides, imageDataByKey);
          return uploadPdf(parsed.postId, variant.orientation, await renderHtmlToPdf(buildPdfDocument(layouts, DIMENSIONS[variant.orientation]), DIMENSIONS[variant.orientation]));
        }));
      } else {
        try {
          const portraitFrames = frames.get('portrait') ?? [];
          results.push({ ...variant, s3Key: await uploadVideo(parsed.postId, await renderVideo(portraitFrames, parsed.videoConfig)) });
        } catch (error) {
          results.push({ ...variant, error: errorMessage(error) });
        }
      }
    }

    if (results.some((result) => result.format !== 'video' && !result.s3Key)) {
      return { status: 'failed', results };
    }

    await insertOutput({
      key: newId(),
      type: 'post.render',
      data: { postId: parsed.postId, status: 'done', results },
      storagePath: null,
      usageCount: 0,
      createdAt: new Date().toISOString(),
    });

    return { status: 'done', results };
  } catch (error) {
    const fallback = fallbackResult(input, errorMessage(error));
    return { status: 'failed', results: [fallback] };
  }
}

function validateVariants(variants: RenderVariant[]) {
  const invalid = variants.find((variant) => variant.orientation === 'square' && variant.format === 'video');
  if (invalid) throw new Error('Invalid render variant: video is only supported for portrait orientation.');
}

function validateLayoutSlug(layoutSlug: string) {
  if (!ALLOWED_LAYOUT_SLUGS.has(layoutSlug)) {
    throw new Error(`Invalid post layout slug: ${layoutSlug}`);
  }
}

function getNeededPngFrameOrientations(variants: RenderVariant[]) {
  const orientations = new Set<Orientation>();
  for (const variant of variants) {
    if (variant.format === 'png') orientations.add(variant.orientation);
    if (variant.format === 'video') orientations.add('portrait');
  }
  return [...orientations];
}

async function runRequiredVariant(variant: RenderVariant, fn: () => Promise<string>): Promise<RenderResult> {
  try {
    return { ...variant, s3Key: await fn() };
  } catch (error) {
    return { ...variant, error: errorMessage(error) };
  }
}

async function resolveSlideImages(slides: SlideInput[]) {
  const images = new Map<string, string>();
  for (const slide of slides) {
    if (!images.has(slide.backgroundImageKey)) {
      images.set(slide.backgroundImageKey, await fetchS3ImageAsDataUri(slide.backgroundImageKey));
    }
  }
  return images;
}

async function fetchS3ImageAsDataUri(key: string) {
  const object = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  const bytes = await object.Body?.transformToByteArray();
  if (!bytes) throw new Error(`Unable to read S3 image: ${key}`);
  return `data:${object.ContentType ?? contentTypeForKey(key)};base64,${Buffer.from(bytes).toString('base64')}`;
}

function contentTypeForKey(key: string) {
  const lower = key.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

async function populateAllLayouts(postType: 'single' | 'multi', orientation: Orientation, slides: SlideInput[], imageDataByKey: Map<string, string>) {
  const layouts = [];
  for (const slide of slides) {
    layouts.push(await populateLayout({ postType, orientation, slide, imageUrl: imageDataByKey.get(slide.backgroundImageKey)! }));
  }
  return layouts;
}

async function populateLayout(input: { postType: 'single' | 'multi'; orientation: Orientation; slide: SlideInput; imageUrl: string }) {
  const template = await Bun.file(layoutPath(input.postType, input.orientation, input.slide.layoutSlug)).text();
  return renderTemplate(template, {
    title: escapeHtml(input.slide.title),
    image_url: input.imageUrl,
    image_alt: escapeHtml(input.slide.imageAlt),
    overlay_text: input.slide.overlayText ? escapeHtml(input.slide.overlayText) : '',
  });
}

function layoutPath(postType: 'single' | 'multi', orientation: Orientation, layoutSlug: string) {
  validateLayoutSlug(layoutSlug);
  return resolve(process.env.SHARED_DIR ?? resolve(process.cwd(), '..', 'shared'), 'brand', 'posts', postType, orientation, `${layoutSlug}-layout.html`);
}

function renderTemplate(template: string, data: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? '');
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function uploadPngFrames(postId: string, orientation: Orientation, frames: Buffer[]) {
  if (frames.length === 0) throw new Error(`No ${orientation} PNG frames were rendered.`);
  for (let index = 0; index < frames.length; index += 1) {
    await uploadBuffer(`renders/${postId}/${orientation}/${index}.png`, frames[index], 'image/png');
  }
  return `renders/${postId}/${orientation}`;
}

async function uploadPdf(postId: string, orientation: Orientation, pdf: Buffer) {
  const key = `renders/${postId}/${orientation}/post.pdf`;
  await uploadBuffer(key, pdf, 'application/pdf');
  return key;
}

async function uploadVideo(postId: string, video: Buffer) {
  const key = `renders/${postId}/portrait/video.mp4`;
  await uploadBuffer(key, video, 'video/mp4');
  return key;
}

async function uploadBuffer(key: string, body: Buffer, contentType: string) {
  await s3.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: body, ContentType: contentType }));
}

function buildPdfDocument(layouts: string[], dims: { width: number; height: number }) {
  const styles = new Set<string>();
  const bodies = layouts.map((layout) => {
    for (const style of extractStyleBlocks(layout)) styles.add(style);
    return extractBody(layout);
  });
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <style>
      @page { size: ${dims.width}px ${dims.height}px; margin: 0; }
      html, body { margin: 0; padding: 0; }
      .pdf-page { width: ${dims.width}px; height: ${dims.height}px; overflow: hidden; page-break-after: always; break-after: page; }
      .pdf-page:last-child { page-break-after: auto; break-after: auto; }
      ${[...styles].join('\n')}
    </style>
  </head>
  <body>
    ${bodies.map((body) => `<section class="pdf-page">${body}</section>`).join('\n')}
  </body>
</html>`;
}

function extractStyleBlocks(html: string) {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]);
}

function extractBody(html: string) {
  return html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
}

async function renderVideo(frames: Buffer[], videoConfig?: Record<string, unknown>) {
  if (frames.length === 0) throw new Error('No portrait PNG frames available for video render.');
  const dir = await mkdtemp(join(tmpdir(), 'vorinthex-render-'));
  try {
    for (let index = 0; index < frames.length; index += 1) {
      await writeFile(join(dir, `frame-${String(index).padStart(4, '0')}.png`), frames[index]);
    }
    const output = join(dir, 'video.mp4');
    await runFfmpeg(buildFfmpegArgs(dir, output, frames.length, videoConfig));
    return Buffer.from(await Bun.file(output).arrayBuffer());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function buildFfmpegArgs(dir: string, output: string, frameCount: number, videoConfig?: Record<string, unknown>) {
  const secondsPerSlide = typeof videoConfig?.secondsPerSlide === 'number' ? videoConfig.secondsPerSlide : 3;
  const transitionSeconds = typeof videoConfig?.transitionSeconds === 'number' ? videoConfig.transitionSeconds : 0.5;
  const fps = typeof videoConfig?.fps === 'number' ? videoConfig.fps : 30;
  const inputs = Array.from({ length: frameCount }, (_, index) => ['-loop', '1', '-t', String(secondsPerSlide), '-i', join(dir, `frame-${String(index).padStart(4, '0')}.png`)]).flat();
  const filters = Array.from({ length: frameCount }, (_, index) => `[${index}:v]scale=1080:1920,zoompan=z='min(zoom+0.0015,1.08)':d=${Math.floor(secondsPerSlide * fps)}:s=1080x1920:fps=${fps},format=yuv420p[v${index}]`);
  const transitionFilters: string[] = [];
  let outputLabel = 'v0';
  for (let index = 1; index < frameCount; index += 1) {
    const nextLabel = `x${index}`;
    const offset = Math.max(0, (secondsPerSlide - transitionSeconds) * index);
    transitionFilters.push(`[${outputLabel}][v${index}]xfade=transition=fade:duration=${transitionSeconds}:offset=${offset}[${nextLabel}]`);
    outputLabel = nextLabel;
  }
  const filterComplex = frameCount === 1
    ? filters.join(';')
    : `${filters.join(';')};${transitionFilters.join(';')}`;
  return [
    '-y',
    ...inputs,
    '-filter_complex',
    filterComplex,
    '-map',
    `[${outputLabel}]`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    output,
  ];
}

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`ffmpeg timed out after ${VIDEO_TIMEOUT_MS}ms`));
    }, VIDEO_TIMEOUT_MS);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

function fallbackResult(input: unknown, message: string): RenderResult {
  const parsed = typeof input === 'object' && input !== null ? input as { variants?: RenderVariant[] } : {};
  const variant = parsed.variants?.[0] ?? { orientation: 'square' as const, format: 'png' as const };
  return { orientation: variant.orientation, format: variant.format, error: message };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
