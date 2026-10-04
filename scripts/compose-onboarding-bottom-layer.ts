#!/usr/bin/env bun
/** Make one reusable graphite texture from image 12 and apply it to intro artwork. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { INTRO_SCREENSHOT_STEPS } from '../mobile/app/src/data/intro-screenshot-steps';

const ROOT = resolve(import.meta.dir, '..');
const FRAMES = join(ROOT, 'scripts', 'image', 'outputs', 'onboarding-frames');
const OUTPUT = join(FRAMES, 'new');
const STEPS = join(OUTPUT, 'steps');
const BUNDLED_FRAMES = join(ROOT, 'mobile', 'app', 'assets', 'onboarding', 'frames');
const ASSET = join(ROOT, 'mobile', 'app', 'assets', 'onboarding', 'graphite-bottom-layer.png');
const WIDTH = 1080;
const HEIGHT = 1920;
const BAND_HEIGHT = 135; // original 1080×2340 screenshot: only its Android navigation row
const DISPLAY = { left: 170, top: 158, width: 740, height: 1604 } as const;

const illustrationSteps = [
  { step: 1, file: '01-lost-item.png' },
  { step: 2, file: '02-scattered-work.png' },
  { step: 3, file: '03-connected-context.png' },
  { step: 6, file: '06-bring-what-matters.png' },
  { step: 8, file: '08-ask-in-your-own-words.png' },
  { step: 13, file: '13-chats-become-knowledge.png' },
  { step: 15, file: '15-one-balance.png' },
] as const;

async function graphiteBand(background: Buffer): Promise<Buffer> {
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${BAND_HEIGHT}"><defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".24" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></linearGradient></defs><rect width="${WIDTH}" height="${BAND_HEIGHT}" fill="url(#fade)"/></svg>`);
  return sharp(background).extract({ left: 0, top: HEIGHT - BAND_HEIGHT, width: WIDTH, height: BAND_HEIGHT })
    .blur(3).modulate({ brightness: 0.65, saturation: 0.5 }).ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

async function deviceBand(band: Buffer): Promise<Buffer> {
  const height = Math.round(BAND_HEIGHT * DISPLAY.height / 2340);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${DISPLAY.width}" height="${height}"><path d="M0 0 H${DISPLAY.width} V${height - 68} Q${DISPLAY.width} ${height} ${DISPLAY.width - 68} ${height} H68 Q0 ${height} 0 ${height - 68} Z" fill="#fff"/></svg>`);
  return sharp(band).resize(DISPLAY.width, height).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

async function contactSheet() {
  const cell = { width: 180, height: 320 };
  const gap = 14;
  const margin = 22;
  const columns = 3;
  const tiles = await Promise.all(Array.from({ length: 15 }, async (_, index) => ({
    input: await sharp(join(STEPS, `${String(index + 1).padStart(2, '0')}.png`)).resize(cell.width, cell.height).png().toBuffer(),
    left: margin + index % columns * (cell.width + gap),
    top: margin + Math.floor(index / columns) * (cell.height + gap),
  })));
  await sharp({ create: { width: margin * 2 + columns * cell.width + (columns - 1) * gap, height: margin * 2 + 5 * cell.height + 4 * gap, channels: 3, background: '#030405' } })
    .composite(tiles).png().toFile(join(STEPS, 'contact-sheet.png'));
}

async function main() {
  const source = join(FRAMES, '12-deep-graphite-iphone-source.png');
  if (!await Bun.file(source).exists()) throw new Error('Generate image 12 before composing the graphite bottom layer.');
  await mkdir(STEPS, { recursive: true });
  await mkdir(BUNDLED_FRAMES, { recursive: true });
  const background = await sharp(source).resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre' }).png().toBuffer();
  const band = await graphiteBand(background);
  await Promise.all([writeFile(join(OUTPUT, 'graphite-bottom-layer.png'), band), writeFile(ASSET, band)]);
  const insideDevice = await deviceBand(band);
  const navTop = DISPLAY.top + DISPLAY.height - (await sharp(insideDevice).metadata()).height!;

  for (let step = 1; step <= 15; step += 1) {
    const screenshot = INTRO_SCREENSHOT_STEPS.find((item) => item.step === step);
    const illustration = illustrationSteps.find((item) => item.step === step);
    const base = screenshot ? join(OUTPUT, `${screenshot.id}-${screenshot.source}.png`) : illustration ? join(FRAMES, 'illustrations', illustration.file) : background;
    const image = typeof base === 'string' ? await readFile(base) : base;
    const overlay = screenshot ? { input: insideDevice, left: DISPLAY.left, top: navTop } : { input: band, left: 0, top: HEIGHT - BAND_HEIGHT };
    const target = join(STEPS, `${String(step).padStart(2, '0')}.png`);
    await sharp(image).composite([overlay]).png().toFile(target);
    const metadata = await sharp(target).metadata();
    if (metadata.width !== WIDTH || metadata.height !== HEIGHT) throw new Error(`Intro step ${step} has an unexpected size.`);
    await sharp(target).jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(join(BUNDLED_FRAMES, `${String(step).padStart(2, '0')}.jpg`));
    console.log(`Composed step ${step}`);
  }
  await contactSheet();
  console.log(`Graphite layer, 15 frame previews, and mobile assets: ${STEPS} (no model calls).`);
}

if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
