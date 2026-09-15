#!/usr/bin/env bun
import sharp from 'sharp';
import { imageCaptionInputSchema, imageCaptionOutputSchema, type ImageCaptionOutput } from '@/lib/ai/providers';
import { executeAction } from '@/lib/ai/router';
import { calculateActionCostMicroSparks, MICRO_SPARKS_PER_SPARK } from '@/lib/costs';

function integerArgument(name: string, fallback: number, maximum: number) {
  const raw = process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
  const value = Number(raw ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`--${name} must be an integer from 1 to ${maximum}.`);
  return value;
}

const imageCount = integerArgument('images', 20, 20);
const repeat = integerArgument('repeat', 1, 5);
const maximumCaptionMs = Number(process.env.GALLERY_CAPTION_EVAL_MAX_MS ?? 60_000);
if (!Number.isFinite(maximumCaptionMs) || maximumCaptionMs <= 0) throw new Error('GALLERY_CAPTION_EVAL_MAX_MS must be a positive number.');

async function fixture(index: number) {
  const hue = (index * 47) % 360;
  const svg = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg"><rect width="512" height="512" fill="hsl(${hue},65%,42%)"/><circle cx="256" cy="220" r="120" fill="white" fill-opacity="0.72"/><text x="256" y="420" text-anchor="middle" font-family="Arial" font-size="52" fill="white">Image ${index + 1}</text></svg>`;
  const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

const imageUrls = await Promise.all(Array.from({ length: imageCount }, (_, index) => fixture(index)));
const input = imageCaptionInputSchema.parse({ imageUrls });
const reports = [];

for (let iteration = 1; iteration <= repeat; iteration += 1) {
  const startedAt = performance.now();
  const response = await executeAction<typeof input & { operation: 'caption' }, ImageCaptionOutput>({
    mode: 'auto',
    teamKey: 'gallery-caption-performance',
    actionSlug: 'image',
  }, { operation: 'caption', ...input }, {
    providers: ['image.secondary'],
    retry: { intervalMs: 2_000, attempts: 3 },
    timeoutMs: maximumCaptionMs,
  });
  const elapsedMs = Math.round(performance.now() - startedAt);
  const output = imageCaptionOutputSchema.parse(response.output);
  if (output.results.length !== imageCount) throw new Error(`Expected ${imageCount} captions, received ${output.results.length}.`);
  const microSparks = calculateActionCostMicroSparks('image', response.usage, { operation: 'caption', imageUrls });
  const report = {
    iteration,
    imageCount,
    elapsedMs,
    millisecondsPerImage: Math.round((elapsedMs / imageCount) * 100) / 100,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    totalTokens: response.usage.totalTokens,
    microSparks,
    sparks: microSparks / MICRO_SPARKS_PER_SPARK,
    provider: response.providerId,
    model: response.externalModelId,
  };
  console.info(JSON.stringify(report));
  if (elapsedMs > maximumCaptionMs) throw new Error(`Caption completion took ${elapsedMs}ms, exceeding ${maximumCaptionMs}ms.`);
  reports.push(report);
}

const sorted = reports.map(({ elapsedMs }) => elapsedMs).sort((left, right) => left - right);
console.info(JSON.stringify({
  summary: {
    runs: reports.length,
    imageCount,
    minimumMs: sorted[0],
    medianMs: sorted[Math.floor(sorted.length / 2)],
    maximumMs: sorted.at(-1),
    totalTokens: reports.reduce((sum, report) => sum + report.totalTokens, 0),
    totalSparks: Math.round(reports.reduce((sum, report) => sum + report.sparks, 0) * MICRO_SPARKS_PER_SPARK) / MICRO_SPARKS_PER_SPARK,
  },
}));
