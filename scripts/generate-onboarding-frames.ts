#!/usr/bin/env bun
/**
 * Generate ten screenshot-free frames or one screenshot-guided ambient concept.
 *
 * Run from the repository root: bun run scripts/generate-onboarding-frames.ts
 * Results are local design drafts under scripts/image/outputs/onboarding-frames/.
 * Use --integrated for the separate eleventh concept with the first screenshot.
 * Existing drafts are reused; --force deliberately pays to regenerate them.
 * The key is read only from the unlocked, git-crypt-protected prod backend env.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { INTRO_SCREENSHOT_STEPS } from '../mobile/app/src/data/intro-screenshot-steps';

const ROOT = resolve(import.meta.dir, '..');
const OUTPUT_DIR = join(ROOT, 'scripts', 'image', 'outputs', 'onboarding-frames');
const MODEL = 'openai/gpt-image-2.5-sunburst';
const WIDTH = 1080;
const HEIGHT = 1920;
const PANEL = { left: 126, top: 224, width: 828, height: 1472 } as const; // exactly 9:16
const INTEGRATED_ID = '11-ambient-silver';
const IPHONE_ID = '12-deep-graphite-iphone';
const FIRST_SCREENSHOT = join(ROOT, 'mobile', 'app', 'assets', 'onboarding', 'storage-root.jpg');
const ILLUSTRATION_DIR = join(OUTPUT_DIR, 'illustrations');
const ILLUSTRATION_ASSET_DIR = join(ROOT, 'mobile', 'app', 'assets', 'onboarding', 'illustrations');
const illustrations = [
  { id: '01-lost-item', step: 1, scene: 'A single unmarked photographic print peeking from among overlapping completely blank papers in a deep charcoal space. A soft silver glimmer finds its edge; the rest falls into layered shadow. Intimate and human, not an office desk.' },
  { id: '02-scattered-work', step: 2, scene: 'A few blank photographs, paper sheets, an unlabeled recording object, and a film still drifting apart at different depths through a graphite atmosphere. Their distance feels quietly overwhelming, without clutter or chaos.' },
  { id: '03-connected-context', step: 3, scene: 'Fine, restrained silver threads begin linking a small group of blank personal artifacts, photos, and notes across a dark space. The connections are softly luminous and organic, as if separate thoughts finally have a relationship.' },
  { id: '06-bring-what-matters', step: 6, scene: 'A tactile still life bringing together unmarked papers, a photographic print, a small unlabeled audio recorder, and a strip of film on a dark surface. A delicate pearl-silver light unifies the different materials without turning them into UI icons.' },
  { id: '08-ask-in-your-own-words', step: 8, scene: 'A quiet conversational exchange suggested by two distinct, softly luminous silver currents reaching toward one another across a deep graphite space. Their flowing shapes meet in a warm, human point of light, as if a question becomes the beginning of a thoughtful dialogue. Abstract and tactile, with no speech bubbles, people, devices, interface, or written marks.' },
  { id: '13-chats-become-knowledge', step: 13, scene: 'Several translucent, text-free layers of conversation-shaped glass and paper settling into a quiet dimensional archive. The layers softly illuminate one another, suggesting that thoughts accumulate into useful memory, not a chat interface.' },
  { id: '15-one-balance', step: 15, scene: 'A single flowing pearl-silver current quietly connecting a small arrangement of completely unmarked dark sculptural forms on one side with a warm creative glow on the other. Elegant, cohesive movement through layered graphite space. Use smooth stone and blank geometric forms only: absolutely no paper, photographs, books, pages, written surfaces, coins, money, numbers, or pricing imagery.' },
] as const;

const concepts = [
  { id: '01-silver-horizon', mood: 'A fine silver-blue horizon glow crossing behind the lower third, with faint cool refractions along the left and right outer margins. Quiet architectural symmetry.' },
  { id: '02-amber-afterglow', mood: 'A restrained molten amber-to-smoke gradient grazing the lower corners, fading to near-black toward the top. Warm, human, and understated.' },
  { id: '03-polar-aurora', mood: 'Subtle polar teal and ice-blue aurora ribbons barely visible along the far outer edges, with delicate diffuse haze and ample obsidian negative space.' },
  { id: '04-violet-nebula', mood: 'Velvety indigo-to-violet ambient light behind the frame, brightest at two opposite corners, with a barely perceptible soft haze.' },
  { id: '05-prismatic-chrome', mood: 'Controlled pearlescent chrome reflections following the perimeter, a faint spectrum at the edges only, with refined brushed-metal light rather than glitter.' },
  { id: '06-cobalt-current', mood: 'A cool cobalt and electric-cyan gradient flare rising from the bottom edge, flowing thinly around the side margins like a calm current.' },
  { id: '07-rose-gold-dusk', mood: 'Soft rose-gold and graphite illumination at the upper corners, tapering into black down the sides. Editorial, cinematic, and warm.' },
  { id: '08-frosted-glass', mood: 'An ultra-minimal silver-white frosted glow around the outer perimeter, gently feathered into deep charcoal with crisp studio lighting.' },
  { id: '09-ember-and-ash', mood: 'A desaturated copper and deep burgundy edge flare with a few soft reflected highlights, resembling embers seen through smoky glass, never flames.' },
  { id: '10-orbital-light', mood: 'Very fine elliptical arcs of cool pearl light appearing only behind the outer frame and disappearing into black, suggesting connected memory without an icon.' },
] as const;

const sharedPrompt = `Create an exceptionally polished vertical 9:16 visual frame concept for a premium personal AI onboarding experience. The overall composition is quiet obsidian black with a centered, front-facing, tall 9:16 black rectangular region taking about 77% of the canvas width. This central region is deliberately blank: a screenshot will be placed there later. Keep all interesting color and illumination OUTSIDE the central rectangle, restricted to the outer margins, edges, and corners. Leave the top and bottom margins quiet enough for typography to be added later. Soft directional gradients, edge flares, precise lighting, subtle depth, and luxurious restraint. Flat two-dimensional layout with clean bilateral balance, not a rendered phone or device. No screenshot, app interface, content inside the center, text, letters, numbers, logos, symbols, stars, particles, borders resembling a phone, or watermark. Never place legible writing anywhere.`;

type Entry = { id: string; prompt: string; file: string; source: string; costUsd?: number };

async function productionKey(): Promise<string> {
  let document: { secrets?: { prod?: { env?: { OPENROUTER_API_KEY?: string } } } };
  try { document = JSON.parse(await readFile(join(ROOT, '.github', 'environments.json'), 'utf8')); }
  catch { throw new Error('Unlock .github/environments.json with git-crypt before running this script.'); }
  const key = document.secrets?.prod?.env?.OPENROUTER_API_KEY?.trim();
  if (!key || key === 'your_key_here') throw new Error('The encrypted production backend OpenRouter key is unavailable.');
  return key;
}

async function generate(prompt: string, key: string, reference?: { bytes: Buffer; mimeType: 'image/png' | 'image/jpeg' }): Promise<{ bytes: Buffer; extension: 'png' | 'jpg' | 'webp'; costUsd?: number }> {
  const response = await fetch('https://openrouter.ai/api/v1/images', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://vorinthex.com',
      'X-OpenRouter-Title': 'Vorinthex Onboarding Frame Concepts',
    },
    body: JSON.stringify({ model: MODEL, prompt, n: 1, aspect_ratio: '9:16', quality: 'high', background: 'opaque',
      ...(reference ? { input_references: [{ type: 'image_url', image_url: { url: `data:${reference.mimeType};base64,${reference.bytes.toString('base64')}` } }] } : {}),
    }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1_000).replaceAll(key, '[redacted]');
    throw new Error(`OpenRouter image generation failed (${response.status}): ${detail}`);
  }
  const result = await response.json() as { data?: { b64_json?: string }[]; usage?: { cost?: number } };
  const base64 = result.data?.[0]?.b64_json;
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('OpenRouter returned no valid image bytes.');
  const bytes = Buffer.from(base64, 'base64');
  const info = await sharp(bytes).metadata();
  if (!info.width || !info.height || !['png', 'jpeg', 'webp'].includes(info.format ?? '')) throw new Error('The generated image could not be decoded.');
  return { bytes, extension: info.format === 'jpeg' ? 'jpg' : info.format as 'png' | 'webp', ...(typeof result.usage?.cost === 'number' ? { costUsd: result.usage.cost } : {}) };
}

function blackCenter(): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}"><rect x="${PANEL.left - 5}" y="${PANEL.top - 5}" width="${PANEL.width + 10}" height="${PANEL.height + 10}" rx="38" fill="none" stroke="#394147" stroke-opacity=".45" stroke-width="2"/><rect x="${PANEL.left}" y="${PANEL.top}" width="${PANEL.width}" height="${PANEL.height}" rx="32" fill="#000000"/></svg>`);
}

async function contactSheet(): Promise<void> {
  const cell = { width: 270, height: 480 };
  const gap = 18;
  const margin = 24;
  const tiles = await Promise.all(concepts.map(async ({ id }, index) => ({
    input: await sharp(join(OUTPUT_DIR, `${id}.png`)).resize(cell.width, cell.height).png().toBuffer(),
    left: margin + index % 5 * (cell.width + gap),
    top: margin + Math.floor(index / 5) * (cell.height + gap),
  })));
  await sharp({ create: { width: margin * 2 + 5 * cell.width + 4 * gap, height: margin * 2 + 2 * cell.height + gap, channels: 3, background: '#030405' } })
    .composite(tiles).png().toFile(join(OUTPUT_DIR, 'contact-sheet.png'));
}

async function blendedScreenshot(screenshot: Buffer): Promise<Buffer> {
  const width = 770;
  const height = Math.round(width * 2340 / 1080);
  const feather = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="26"/></filter></defs><rect x="42" y="44" width="${width - 84}" height="${height - 88}" rx="32" fill="#fff" filter="url(#soft)"/></svg>`);
  return sharp(screenshot).resize(width, height).ensureAlpha()
    .composite([{ input: feather, blend: 'dest-in' }])
    .rotate(-2.2, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
}

async function comparisonSheet(extraIds: string[], fileName: string): Promise<void> {
  const ids = [...concepts.map(({ id }) => id), ...extraIds];
  const width = 270;
  const height = 480;
  const gap = 18;
  const margin = 24;
  const tiles = await Promise.all(ids.map(async (id, index) => ({
    input: await sharp(join(OUTPUT_DIR, `${id}.png`)).resize(width, height).png().toBuffer(),
    left: margin + index % 5 * (width + gap),
    top: margin + Math.floor(index / 5) * (height + gap),
  })));
  await sharp({ create: { width: margin * 2 + 5 * width + 4 * gap, height: margin * 2 + Math.ceil(ids.length / 5) * height + (Math.ceil(ids.length / 5) - 1) * gap, channels: 3, background: '#030405' } })
    .composite(tiles).png().toFile(join(OUTPUT_DIR, fileName));
}

async function deviceOverlay(screenshot: Buffer): Promise<Buffer> {
  const device = { left: 137, top: 117, width: 806, height: 1686 };
  const screen = { left: device.left + 33, top: device.top + 41, width: 740, height: 1604 };
  const shell = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <defs>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="34"/></filter>
      <linearGradient id="rail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#060709"/><stop offset=".09" stop-color="#32373c"/><stop offset=".23" stop-color="#0b0d10"/><stop offset=".76" stop-color="#090b0d"/><stop offset=".94" stop-color="#262b30"/><stop offset="1" stop-color="#060709"/></linearGradient>
    </defs>
    <rect x="${device.left - 16}" y="${device.top + 24}" width="${device.width + 32}" height="${device.height + 12}" rx="118" fill="#000" opacity=".7" filter="url(#shadow)"/>
    <rect x="${device.left - 5}" y="${device.top + 340}" width="7" height="92" rx="3" fill="#202428"/>
    <rect x="${device.left - 5}" y="${device.top + 460}" width="7" height="92" rx="3" fill="#202428"/>
    <rect x="${device.left + device.width - 2}" y="${device.top + 388}" width="7" height="126" rx="3" fill="#22272c"/>
    <rect x="${device.left}" y="${device.top}" width="${device.width}" height="${device.height}" rx="108" fill="url(#rail)" stroke="#555a60" stroke-opacity=".48" stroke-width="3"/>
    <rect x="${device.left + 12}" y="${device.top + 12}" width="${device.width - 24}" height="${device.height - 24}" rx="98" fill="#020304" stroke="#13181d" stroke-width="3"/>
    <rect x="${screen.left - 3}" y="${screen.top - 3}" width="${screen.width + 6}" height="${screen.height + 6}" rx="72" fill="#000"/>
  </svg>`);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${screen.width}" height="${screen.height}"><rect width="${screen.width}" height="${screen.height}" rx="68" fill="#fff"/></svg>`);
  const display = await sharp(screenshot).resize(screen.width, screen.height, { fit: 'fill' }).ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  const island = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <rect x="${WIDTH / 2 - 95}" y="${screen.top + 18}" width="190" height="45" rx="23" fill="#010203" stroke="#171c21" stroke-width="2"/>
  </svg>`);
  return sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: shell }, { input: display, left: screen.left, top: screen.top }, { input: island }])
    .png().toBuffer();
}

async function generateIntegrated(key: string, force: boolean): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const finalPath = join(OUTPUT_DIR, `${INTEGRATED_ID}.png`);
  if (!force && await Bun.file(finalPath).exists()) {
    console.log(`Reusing ${INTEGRATED_ID}.png; pass --force --integrated for another paid generation.`);
    return;
  }
  const screenshot = Buffer.from(await readFile(FIRST_SCREENSHOT));
  const metadata = await sharp(screenshot).metadata();
  if (metadata.format !== 'jpeg' || metadata.width !== 1080 || metadata.height !== 2340) throw new Error('The first onboarding screenshot must be the original 1080×2340 JPEG.');
  const prompt = `Use the supplied real app screenshot as a visual reference for the dark, quiet interface palette. Create a new, premium 9:16 ambient silver environment in which that screenshot could be gently blended later. The background should feel like a cinematic soft-focus studio photograph of brushed silver and charcoal atmosphere, not a graphic frame. Diffuse pearl-white illumination, desaturated metallic gradient flares drifting in from the far outer edges, subtle analog film grain and atmospheric texture, and an almost-black softly lit middle. Organic, hazy transitions rather than sharp borders. Compose a little more light at the left and right edges, keep the center calm and dark enough to carry the screenshot, and reserve breathing room at the top and bottom. No phone mockup, no rigid black cutout, no nested rectangle, no device silhouette, no readable text, no logos, no symbols or UI drawn by the model. The reference is for mood and composition; do not duplicate its controls or words. Minimal but deeply tactile, sophisticated and human, softly luminous rather than glossy chrome. The final screenshot will sit in the center with a very slight counterclockwise tilt and feathered edges.`;
  console.log(`Generating paid screenshot-guided ${INTEGRATED_ID} with ${MODEL}...`);
  const output = await generate(prompt, key, { bytes: screenshot, mimeType: 'image/jpeg' });
  const source = `${INTEGRATED_ID}-source.${output.extension}`;
  await writeFile(join(OUTPUT_DIR, source), output.bytes);
  const backdrop = await sharp(output.bytes).resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre' }).png().toBuffer();
  const overlay = await blendedScreenshot(screenshot);
  const size = await sharp(overlay).metadata();
  if (!size.width || !size.height || size.width > WIDTH || size.height > HEIGHT) throw new Error('The tilted screenshot exceeds the portrait canvas.');
  await sharp(backdrop).composite([{ input: overlay, left: Math.round((WIDTH - size.width) / 2), top: Math.round((HEIGHT - size.height) / 2) }]).png().toFile(finalPath);
  const final = await sharp(finalPath).metadata();
  if (final.width !== WIDTH || final.height !== HEIGHT) throw new Error('The integrated image is not 1080×1920.');
  const manifestFile = join(OUTPUT_DIR, 'manifest.json');
  const previous = await Bun.file(manifestFile).json().catch(() => null) as { model?: string; canvas?: number[]; panel?: typeof PANEL; entries?: Entry[] } | null;
  await writeFile(manifestFile, JSON.stringify({ ...previous, model: MODEL, canvas: [WIDTH, HEIGHT],
    integrated: { id: INTEGRATED_ID, prompt, file: `${INTEGRATED_ID}.png`, source, reference: 'mobile/app/assets/onboarding/storage-root.jpg', ...(output.costUsd !== undefined ? { costUsd: output.costUsd } : {}) },
  }, null, 2));
  if (concepts.every(({ id }) => Bun.file(join(OUTPUT_DIR, `${id}.png`)).size > 0)) await comparisonSheet([INTEGRATED_ID], 'contact-sheet-11.png');
  console.log(`Saved ${finalPath}${output.costUsd !== undefined ? ` (provider reported $${output.costUsd.toFixed(4)})` : ''}`);
}

async function generateIphone(key: string, force: boolean, recompose: boolean): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const finalPath = join(OUTPUT_DIR, `${IPHONE_ID}.png`);
  const manifestFile = join(OUTPUT_DIR, 'manifest.json');
  const previous = await Bun.file(manifestFile).json().catch(() => null) as { device?: { source?: string; costUsd?: number }; [key: string]: unknown } | null;
  if (!force && !recompose && await Bun.file(finalPath).exists()) {
    console.log(`Reusing ${IPHONE_ID}.png; pass --iphone --recompose to update its layout without paying again.`);
    return;
  }
  const screenshot = Buffer.from(await readFile(FIRST_SCREENSHOT));
  const info = await sharp(screenshot).metadata();
  if (info.format !== 'jpeg' || info.width !== 1080 || info.height !== 2340) throw new Error('The first onboarding screenshot must be the original 1080×2340 JPEG.');
  const prompt = `Use the attached app screenshot only as a palette and composition reference. Generate a 9:16 photographic atmosphere for a premium dark AI experience. Make it MUCH darker than bright silver: 90% near-black graphite and deep charcoal, with restrained low-intensity gunmetal and smoke-silver illumination at the far edges. Give the backdrop visual depth through overlapping soft-focus planes, a gentle layered vignette, subtle brushed-metal texture, sparse fine film grain, faint light falloff and a barely visible cool silver haze behind the middle. The central 75% must remain dark and calm so a separate real black iPhone and its screenshot can be placed there afterwards. Keep the outer edges dimensional but not luminous white. No phone, no screenshot, no rectangular opening, no UI, no text, no logo, no particles, no rigid frame. This is a deep, quiet, cinematic graphite environment; the device will be composited locally to preserve the exact screenshot.`;
  let source = previous?.device?.source;
  let costUsd = previous?.device?.costUsd;
  let image: Buffer;
  if (recompose) {
    if (!source || !await Bun.file(join(OUTPUT_DIR, source)).exists()) throw new Error('No saved source image for the no-cost recompose.');
    image = Buffer.from(await readFile(join(OUTPUT_DIR, source)));
  } else {
    console.log(`Generating paid screenshot-guided ${IPHONE_ID} with ${MODEL}...`);
    const output = await generate(prompt, key, { bytes: screenshot, mimeType: 'image/jpeg' });
    source = `${IPHONE_ID}-source.${output.extension}`;
    costUsd = output.costUsd;
    image = output.bytes;
    await writeFile(join(OUTPUT_DIR, source), image);
  }
  const background = await sharp(image).resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre' }).png().toBuffer();
  await sharp(background).composite([{ input: await deviceOverlay(screenshot) }]).png().toFile(finalPath);
  const final = await sharp(finalPath).metadata();
  if (final.width !== WIDTH || final.height !== HEIGHT) throw new Error('The iPhone image is not 1080×1920.');
  await writeFile(manifestFile, JSON.stringify({ ...previous, model: MODEL, canvas: [WIDTH, HEIGHT],
    device: { id: IPHONE_ID, prompt, file: `${IPHONE_ID}.png`, source, reference: 'mobile/app/assets/onboarding/storage-root.jpg', ...(costUsd !== undefined ? { costUsd } : {}) },
  }, null, 2));
  if ([...concepts.map(({ id }) => id), INTEGRATED_ID].every((id) => Bun.file(join(OUTPUT_DIR, `${id}.png`)).size > 0)) await comparisonSheet([INTEGRATED_ID, IPHONE_ID], 'contact-sheet-12.png');
  console.log(`Saved ${finalPath}${!recompose && costUsd !== undefined ? ` (provider reported $${costUsd.toFixed(4)})` : ' (no new paid call)'}`);
}

async function composeAllScreenshots(): Promise<void> {
  const saved = await Bun.file(join(OUTPUT_DIR, 'manifest.json')).json().catch(() => null) as { device?: { source?: string } } | null;
  const source = saved?.device?.source;
  if (!source || !/^12-deep-graphite-iphone-source\.(?:png|jpg|webp)$/.test(source)) throw new Error('Generate image 12 with --iphone before composing all screenshots.');
  const background = await sharp(join(OUTPUT_DIR, source)).resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre' }).png().toBuffer();
  const folder = join(OUTPUT_DIR, 'new');
  await mkdir(folder, { recursive: true });
  const entries = [];
  for (const { id, source: name } of INTRO_SCREENSHOT_STEPS) {
    const screenshot = Buffer.from(await readFile(join(ROOT, 'mobile', 'app', 'assets', 'onboarding', `${name}.jpg`)));
    const info = await sharp(screenshot).metadata();
    if (info.format !== 'jpeg' || info.width !== 1080 || info.height !== 2340) throw new Error(`Unexpected screenshot size or format: ${name}`);
    const output = `${id}-${name}.png`;
    await sharp(background).composite([{ input: await deviceOverlay(screenshot) }]).png().toFile(join(folder, output));
    entries.push({ screenshot: `${name}.jpg`, file: output });
    console.log(`Created new/${output}`);
  }
  const cell = { width: 240, height: 427 };
  const gap = 18;
  const margin = 24;
  const columns = 4;
  const tiles = await Promise.all(entries.map(async ({ file }, index) => ({
    input: await sharp(join(folder, file)).resize(cell.width, cell.height).png().toBuffer(),
    left: margin + index % columns * (cell.width + gap),
    top: margin + Math.floor(index / columns) * (cell.height + gap),
  })));
  await sharp({ create: { width: margin * 2 + columns * cell.width + (columns - 1) * gap, height: margin * 2 + 2 * cell.height + gap, channels: 3, background: '#030405' } })
    .composite(tiles).png().toFile(join(folder, 'contact-sheet.png'));
  await writeFile(join(folder, 'manifest.json'), JSON.stringify({ backdrop: `../${source}`, canvas: [WIDTH, HEIGHT], entries }, null, 2));
  console.log(`Done: ${entries.length} screenshot images in ${folder}. No paid calls.`);
}

async function generateIllustrations(key: string, force: boolean, only?: string): Promise<void> {
  if (only && !illustrations.some(({ id }) => id === only)) throw new Error(`Unknown illustration: ${only}`);
  const saved = await Bun.file(join(OUTPUT_DIR, 'manifest.json')).json().catch(() => null) as { device?: { source?: string } } | null;
  const referenceName = saved?.device?.source;
  if (!referenceName || !/^12-deep-graphite-iphone-source\.(?:png|jpg|webp)$/.test(referenceName)) throw new Error('Generate image 12 with --iphone before generating matching illustrations.');
  const referenceBytes = Buffer.from(await readFile(join(OUTPUT_DIR, referenceName)));
  const referenceInfo = await sharp(referenceBytes).metadata();
  if (referenceInfo.format !== 'png' && referenceInfo.format !== 'jpeg') throw new Error('The saved graphite reference must be PNG or JPEG.');
  const reference = { bytes: referenceBytes, mimeType: referenceInfo.format === 'png' ? 'image/png' as const : 'image/jpeg' as const };
  await mkdir(ILLUSTRATION_DIR, { recursive: true });
  await mkdir(ILLUSTRATION_ASSET_DIR, { recursive: true });
  const manifestPath = join(ILLUSTRATION_DIR, 'manifest.json');
  const previous = await Bun.file(manifestPath).json().catch(() => null) as { entries?: Array<{ id: string; step: number; prompt: string; file: string; source: string; appAsset: string; costUsd?: number }> } | null;
  const entries = [];
  let paid = 0;
  let cost = 0;
  const artDirection = `Create one finished, full-bleed 9:16 editorial illustration for a personal AI onboarding story. Use the provided reference image ONLY for its color and material language: very dark layered graphite, charcoal-black depth, brushed gunmetal, fine atmospheric grain, and soft pearlescent silver light. Make the subject and its silver illumination just a little brighter than the reference, while keeping the scene deep and restrained. Fill the entire portrait canvas edge to edge with atmospheric detail; no empty central rectangle, vignette card, poster border, phone, frame, mockup, screenshot, graphic layout, or interface. Allow darker negative space behind future overlay copy but keep the composition full-bleed and dimensional. Cinematic, tactile, subtle, believable. Absolutely no text of any kind: no words, letters, numerals, glyphs, labels, printed marks, signage, logos, watermarks, or fake UI. Surfaces that could carry writing must be completely blank.`;
  for (const { id, step, scene } of illustrations) {
    const path = join(ILLUSTRATION_DIR, `${id}.png`);
    const prompt = `${artDirection}\n\nDistinct scene for intro step ${step}: ${scene}`;
    let entry = previous?.entries?.find((item) => item.id === id);
    if (only && id !== only) {
      if (!entry || !await Bun.file(path).exists()) throw new Error(`Missing prior illustration ${id}; generate the full set first.`);
      entries.push(entry);
      continue;
    }
    if (!force && await Bun.file(path).exists()) console.log(`Reusing illustration ${id}`);
    else {
      console.log(`Generating paid illustration ${id} (${paid + 1}/${only ? 1 : illustrations.length})...`);
      const output = await generate(prompt, key, reference);
      const source = `${id}-source.${output.extension}`;
      await writeFile(join(ILLUSTRATION_DIR, source), output.bytes);
      await sharp(output.bytes).resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre' }).png().toFile(path);
      entry = { id, step, prompt, file: `${id}.png`, source, appAsset: `${id}.jpg`, ...(output.costUsd !== undefined ? { costUsd: output.costUsd } : {}) };
      paid += 1;
      cost += output.costUsd ?? 0;
      console.log(`Saved ${id}.png${output.costUsd !== undefined ? ` ($${output.costUsd.toFixed(4)} reported)` : ''}`);
    }
    await sharp(path).jpeg({ quality: 88, mozjpeg: true }).toFile(join(ILLUSTRATION_ASSET_DIR, `${id}.jpg`));
    entries.push(entry ?? { id, step, prompt, file: `${id}.png`, source: `${id}-source.png`, appAsset: `${id}.jpg` });
    await writeFile(manifestPath, JSON.stringify({ model: MODEL, reference: `../${referenceName}`, canvas: [WIDTH, HEIGHT], entries }, null, 2));
  }
  const tile = { width: 270, height: 480 };
  const gap = 18;
  const margin = 24;
  const columns = 3;
  const tiles = await Promise.all(illustrations.map(async ({ id }, index) => ({
    input: await sharp(join(ILLUSTRATION_DIR, `${id}.png`)).resize(tile.width, tile.height).png().toBuffer(),
    left: margin + index % columns * (tile.width + gap),
    top: margin + Math.floor(index / columns) * (tile.height + gap),
  })));
  const rows = Math.ceil(illustrations.length / columns);
  await sharp({ create: { width: margin * 2 + columns * tile.width + (columns - 1) * gap, height: margin * 2 + rows * tile.height + (rows - 1) * gap, channels: 3, background: '#030405' } })
    .composite(tiles).png().toFile(join(ILLUSTRATION_DIR, 'contact-sheet.png'));
  console.log(`Done: ${illustrations.length} illustrations, ${paid} paid generations in this run${paid ? `, $${cost.toFixed(4)} reported provider cost` : ''}.`);
  console.log(`Browse ${join(ILLUSTRATION_DIR, 'contact-sheet.png')}`);
}

async function main() {
  if (Bun.argv.slice(2).some((arg) => !['--force', '--help', '--check', '--integrated', '--iphone', '--recompose', '--all-screenshots', '--illustrations'].includes(arg) && !arg.startsWith('--only='))) throw new Error('Supported flags: --force, --check, --integrated, --iphone, --recompose, --all-screenshots, --illustrations, --only=<illustration-id>, --help');
  if ([Bun.argv.includes('--integrated'), Bun.argv.includes('--iphone'), Bun.argv.includes('--all-screenshots'), Bun.argv.includes('--illustrations')].filter(Boolean).length > 1) throw new Error('Choose only one generation mode.');
  if (Bun.argv.includes('--recompose') && (!Bun.argv.includes('--iphone') || Bun.argv.includes('--force'))) throw new Error('--recompose is only valid with --iphone, without --force.');
  const only = Bun.argv.slice(2).find((arg) => arg.startsWith('--only='))?.slice('--only='.length);
  if (only !== undefined && !Bun.argv.includes('--illustrations')) throw new Error('--only is only valid with --illustrations.');
  if (Bun.argv.includes('--help')) {
    console.log(`bun run scripts/generate-onboarding-frames.ts [--check | --force | --integrated | --iphone [--recompose] | --all-screenshots | --illustrations [--only=<illustration-id>]]\nGenerates ten blank frames by default, one paid variation with --integrated or --iphone, ${illustrations.length} paid full-bleed illustrations with --illustrations, or eight offline composites with --all-screenshots.`);
    return;
  }
  if (PANEL.width * 16 !== PANEL.height * 9) throw new Error('The screenshot placeholder must have a 9:16 aspect ratio.');
  if (Bun.argv.includes('--all-screenshots')) return composeAllScreenshots();
  const key = await productionKey();
  if (Bun.argv.includes('--check')) { console.log(`Production backend key is available. Model: ${MODEL}. Concepts: ${Bun.argv.includes('--illustrations') ? illustrations.length : concepts.length}${Bun.argv.includes('--integrated') || Bun.argv.includes('--iphone') ? ' plus one screenshot-guided variation' : ''}. No paid calls made.`); return; }
  if (Bun.argv.includes('--integrated')) return generateIntegrated(key, Bun.argv.includes('--force'));
  if (Bun.argv.includes('--iphone')) return generateIphone(key, Bun.argv.includes('--force'), Bun.argv.includes('--recompose'));
  if (Bun.argv.includes('--illustrations')) return generateIllustrations(key, Bun.argv.includes('--force'), only);
  await mkdir(OUTPUT_DIR, { recursive: true });
  const previous = await Bun.file(join(OUTPUT_DIR, 'manifest.json')).json().catch(() => null) as { entries?: Entry[]; integrated?: unknown; device?: unknown } | null;
  const entries: Entry[] = [];
  let paid = 0;
  let cost = 0;
  for (const { id, mood } of concepts) {
    const file = join(OUTPUT_DIR, `${id}.png`);
    const prompt = `${sharedPrompt}\n\nArt direction for this particular variation: ${mood}`;
    if (!Bun.argv.includes('--force') && await Bun.file(file).exists()) {
      console.log(`Reusing ${id}`);
      entries.push(previous?.entries?.find((entry) => entry.id === id) ?? { id, prompt, file: `${id}.png`, source: `${id}-source.png` });
      continue;
    }
    console.log(`Generating ${id} (${paid + 1} paid call${paid ? 's' : ''} so far)...`);
    const output = await generate(prompt, key);
    const source = `${id}-source.${output.extension}`;
    await writeFile(join(OUTPUT_DIR, source), output.bytes);
    await sharp(output.bytes).resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre' })
      .composite([{ input: blackCenter() }]).png().toFile(file);
    const metadata = await sharp(file).metadata();
    const center = await sharp(file).extract({ left: WIDTH / 2, top: HEIGHT / 2, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    if (metadata.width !== WIDTH || metadata.height !== HEIGHT || center.some((channel) => channel !== 0)) throw new Error(`${id} failed frame validation.`);
    paid += 1;
    cost += output.costUsd ?? 0;
    entries.push({ id, prompt, file: `${id}.png`, source, ...(output.costUsd !== undefined ? { costUsd: output.costUsd } : {}) });
    await writeFile(join(OUTPUT_DIR, 'manifest.json'), JSON.stringify({ model: MODEL, canvas: [WIDTH, HEIGHT], panel: PANEL, entries, ...(previous?.integrated ? { integrated: previous.integrated } : {}), ...(previous?.device ? { device: previous.device } : {}) }, null, 2));
    console.log(`Saved ${id}.png${output.costUsd !== undefined ? ` (provider reported $${output.costUsd.toFixed(4)})` : ''}`);
  }
  await contactSheet();
  await writeFile(join(OUTPUT_DIR, 'manifest.json'), JSON.stringify({ model: MODEL, canvas: [WIDTH, HEIGHT], panel: PANEL, entries, ...(previous?.integrated ? { integrated: previous.integrated } : {}), ...(previous?.device ? { device: previous.device } : {}) }, null, 2));
  console.log(`Done: ${concepts.length} frames, ${paid} paid generations in this run${paid ? `, $${cost.toFixed(4)} reported provider cost` : ''}.`);
  console.log(`Browse ${join(OUTPUT_DIR, 'contact-sheet.png')}`);
}

if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : 'Frame generation failed.'); process.exitCode = 1; });
