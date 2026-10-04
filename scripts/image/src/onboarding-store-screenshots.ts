#!/usr/bin/env bun
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { z } from 'zod';
import { INTRO_SCREENSHOT_STEPS } from '../../../mobile/app/src/data/intro-screenshot-steps';
import { INTRO_STEPS } from '../../../mobile/app/src/data/intro-step-copy';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DESIGN = path.join(ROOT, 'scripts/image/onboarding-store-screenshots');
const OUTPUT = path.join(ROOT, 'scripts/image/outputs/onboarding-store-screenshots');
const FRAMES = path.join(ROOT, 'mobile/app/assets/onboarding/frames');
const PUBLISH = path.join(ROOT, 'mobile/scripts/assets/screenshots');
const STORES = {
  apple: { width: 1320, height: 2868, folder: 'apple/iphone-6-7' },
  google: { width: 1080, height: 1920, folder: 'google/phone' },
} as const;
const copySchema = z.record(z.string().regex(/^0[1-8]$/), z.object({ title: z.string().trim().min(1).max(80).optional(), subtitle: z.string().trim().min(1).max(120) }).strict());

async function assetUrl(file: string) {
  return `data:${file.endsWith('.png') ? 'image/png' : file.endsWith('.ttf') ? 'font/ttf' : 'image/jpeg'};base64,${(await readFile(file)).toString('base64')}`;
}

async function isolatedPhone(file: string) {
  const frame = await readFile(file);
  const { width, height } = await sharp(frame).metadata();
  if (width !== 1080 || height !== 1920) throw new Error(`Unexpected onboarding frame dimensions: ${file}`);
  // The composited phone includes backdrop pixels outside its shell. Feather a
  // tight device-shaped mask so the full-bleed graphite plate shows through.
  const mask = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><defs><filter id="soft"><feGaussianBlur stdDeviation="10"/></filter></defs><rect x="112" y="90" width="856" height="1730" rx="120" fill="white" filter="url(#soft)"/></svg>');
  const png = await sharp(frame).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function contactSheet(store: keyof typeof STORES) {
  const width = 240;
  const height = Math.round(width * STORES[store].height / STORES[store].width);
  const gap = 18;
  const padding = 24;
  const tiles = await Promise.all(INTRO_SCREENSHOT_STEPS.map(async ({ id }, index) => ({
    input: await sharp(path.join(OUTPUT, store, `${id}.png`)).resize(width, height).png().toBuffer(),
    left: padding + index % 4 * (width + gap),
    top: padding + Math.floor(index / 4) * (height + gap),
  })));
  await sharp({ create: { width: padding * 2 + 4 * width + 3 * gap, height: padding * 2 + 2 * height + gap, channels: 3, background: '#030507' } })
    .composite(tiles).png().toFile(path.join(OUTPUT, store, 'contact-sheet.png'));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('bun run screenshots:store [--publish]\nEdit onboarding-store-screenshots/copy.json and rerun. --publish also updates the Apple and Google submission folders.');
    return;
  }
  if (args.some((arg) => arg !== '--publish')) throw new Error(`Unknown option: ${args.join(' ')}`);
  const copy = copySchema.parse(JSON.parse(await readFile(path.join(DESIGN, 'copy.json'), 'utf8')));
  const ids = INTRO_SCREENSHOT_STEPS.map(({ id }) => id);
  if (Object.keys(copy).length !== ids.length || ids.some((id) => !copy[id])) throw new Error('Store copy must have exactly one entry for each of the eight onboarding screenshots.');

  const candidates = process.platform === 'win32'
    ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']
    : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] : ['/usr/bin/google-chrome', '/usr/bin/chromium'];
  const browser = await chromium.launch({ headless: true }).catch(async (error: unknown) => {
    const executablePath = candidates.find(existsSync);
    if (!executablePath) throw error;
    return chromium.launch({ headless: true, executablePath });
  });
  try {
    const backdrop = await assetUrl(path.join(DESIGN, 'graphite-backdrop.jpg'));
    const light = await assetUrl(path.join(ROOT, 'node_modules/@expo-google-fonts/geist/300Light/Geist_300Light.ttf'));
    const regular = await assetUrl(path.join(ROOT, 'node_modules/@expo-google-fonts/geist/400Regular/Geist_400Regular.ttf'));
    for (const [store, dimensions] of Object.entries(STORES) as [keyof typeof STORES, (typeof STORES)[keyof typeof STORES]][]) {
      const destination = path.join(OUTPUT, store);
      await mkdir(destination, { recursive: true });
      const page = await browser.newPage({ viewport: { width: dimensions.width, height: dimensions.height }, deviceScaleFactor: 1 });
      try {
        await page.goto(pathToFileURL(path.join(DESIGN, 'template.html')).href);
        await page.addStyleTag({ content: `@font-face { font-family: Geist; src: url('${light}'); font-weight: 300; } @font-face { font-family: Geist; src: url('${regular}'); font-weight: 400; }` });
        await page.evaluate(async () => { await Promise.all([document.fonts.load('300 72px Geist'), document.fonts.load('400 31px Geist')]); await document.fonts.ready; });
        for (const { id, step } of INTRO_SCREENSHOT_STEPS) {
          const title = copy[id]!.title ?? INTRO_STEPS[step - 1]?.title;
          if (!title) throw new Error(`No onboarding title for step ${step}.`);
          const image = await isolatedPhone(path.join(FRAMES, `${String(step).padStart(2, '0')}.jpg`));
          await page.evaluate(({ width, height, store, image, backdrop, title, subtitle }) => {
            document.documentElement.style.setProperty('--width', `${width}px`);
            document.documentElement.style.setProperty('--height', `${height}px`);
            document.documentElement.style.setProperty('--scale', String(width / 1080));
            document.documentElement.dataset.store = store;
            document.querySelector<HTMLImageElement>('.atmosphere')!.src = backdrop;
            document.querySelector<HTMLImageElement>('.artwork')!.src = image;
            document.querySelector<HTMLElement>('.title')!.textContent = title;
            document.querySelector<HTMLElement>('.subtitle')!.textContent = subtitle;
          }, { ...dimensions, store, image, backdrop, title, subtitle: copy[id]!.subtitle });
          await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0));
          const fits = await page.evaluate(() => {
            const heading = document.querySelector<HTMLElement>('.copy')!;
            const artwork = document.querySelector<HTMLElement>('.artwork')!;
            const copy = heading.getBoundingClientRect();
            const image = artwork.getBoundingClientRect();
            return copy.right <= innerWidth && copy.bottom + 36 * Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scale')) < image.top;
          });
          if (!fits) throw new Error(`The copy overlaps the device in ${store}/${id}; shorten the text in copy.json.`);
          const output = path.join(destination, `${id}.png`);
          const screenshot = await page.locator('.canvas').screenshot({ type: 'png' });
          await sharp(screenshot).flatten({ background: '#030507' }).png({ compressionLevel: 9, effort: 7 }).toFile(output);
          const metadata = await sharp(output).metadata();
          if (metadata.width !== dimensions.width || metadata.height !== dimensions.height || metadata.hasAlpha) throw new Error(`Invalid ${store}/${id} screenshot.`);
          if (args.includes('--publish')) {
            const publish = path.join(PUBLISH, dimensions.folder, `${id}.png`);
            await copyFile(output, publish);
          }
          console.log(`Rendered ${store}/${id}.png (${dimensions.width}x${dimensions.height})`);
        }
      } finally { await page.close(); }
      await contactSheet(store);
    }
  } finally { await browser.close(); }
  console.log(`Contact sheets: ${OUTPUT}/{apple,google}/contact-sheet.png`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
