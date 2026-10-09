#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BACKDROP = path.join(ROOT, "scripts/image/onboarding-store-screenshots/graphite-backdrop.jpg");
const MARK = path.join(ROOT, "mobile/app/assets/brand/vorinthex-mark.png");
const FONT_LIGHT = path.join(ROOT, "node_modules/@expo-google-fonts/geist/300Light/Geist_300Light.ttf");
const FONT_REGULAR = path.join(ROOT, "node_modules/@expo-google-fonts/geist/400Regular/Geist_400Regular.ttf");
const OUT = path.join(ROOT, "mobile/scripts/assets/apple-heroes");
const WIDTH = 5244;
const HEIGHT = 2950;

function fontUrl(file: string) {
  return pathToFileURL(file).href;
}

function copySvg() {
  const x = WIDTH / 2;
  const titleY = 1860;
  const subtitleY = 2020;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <defs>
    <style>
      @font-face { font-family: GeistLight; src: url('${fontUrl(FONT_LIGHT)}'); }
      @font-face { font-family: GeistRegular; src: url('${fontUrl(FONT_REGULAR)}'); }
    </style>
  </defs>
  <text x="${x}" y="${titleY}" text-anchor="middle" fill="#f5f7f8" font-family="GeistLight, Geist, Arial" font-size="240" font-weight="300" letter-spacing="-8">Vorinthex AI</text>
  <text x="${x}" y="${subtitleY}" text-anchor="middle" fill="#c5cdd1" font-family="GeistRegular, Geist, Arial" font-size="84" font-weight="400">Your personal AI memory</text>
</svg>`);
}

async function render(layout: "header" | "search", file: string) {
  const markWidth = 720;
  const mark = await sharp(MARK).resize(markWidth).png().toBuffer();
  const markLeft = Math.round((WIDTH - markWidth) / 2);
  const markTop = 860;
  const veil = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}"><defs><radialGradient id="g" cx="50%" cy="48%" r="72%"><stop offset="0%" stop-color="#030507" stop-opacity=".18"/><stop offset="100%" stop-color="#030507" stop-opacity=".55"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
  await sharp(BACKDROP)
    .resize(WIDTH, HEIGHT, { fit: "cover", position: layout === "header" ? "top" : "bottom" })
    .composite([
      { input: veil, top: 0, left: 0 },
      { input: mark, top: markTop, left: markLeft },
      { input: copySvg(), top: 0, left: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toFile(file);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const header = path.join(OUT, "header.png");
  const search = path.join(OUT, "search-results.png");
  await render("header", header);
  await render("search", search);
  for (const file of [header, search]) {
    const metadata = await sharp(file).metadata();
    if (metadata.width !== WIDTH || metadata.height !== HEIGHT) throw new Error(`Invalid ${path.basename(file)} size.`);
    console.log(`Rendered ${path.basename(file)} (${metadata.width}x${metadata.height})`);
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
