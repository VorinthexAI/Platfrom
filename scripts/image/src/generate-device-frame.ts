import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { loadConfig } from "./config";
import { createTransparentFromSolid } from "./image";
import { OpenRouterClient } from "./openrouter";

const FRAME_WIDTH = 900;
const FRAME_HEIGHT = 1950;
const SCREEN = { left: 46, top: 46, width: 808, height: 1858, radius: 86 };

function argumentValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function screenMask(): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME_WIDTH}" height="${FRAME_HEIGHT}">
    <rect x="${SCREEN.left}" y="${SCREEN.top}" width="${SCREEN.width}" height="${SCREEN.height}" rx="${SCREEN.radius}" fill="#fff"/>
  </svg>`);
}

function dynamicIsland(): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME_WIDTH}" height="${FRAME_HEIGHT}">
    <rect x="315" y="61" width="270" height="52" rx="26" fill="#010203" stroke="#242a2e" stroke-width="2"/>
  </svg>`);
}

async function hasUsefulAlpha(filePath: string): Promise<boolean> {
  const metadata = await sharp(filePath).metadata();
  if (!metadata.hasAlpha) return false;
  const stats = await sharp(filePath).ensureAlpha().stats();
  return (stats.channels[3]?.min ?? 255) < 250;
}

async function prepareFrame(sourcePath: string, outputPath: string, temporaryDir: string): Promise<void> {
  let transparentSource = sourcePath;
  if (!await hasUsefulAlpha(sourcePath)) {
    transparentSource = path.join(temporaryDir, "device-frame-transparent.png");
    const config = loadConfig();
    await createTransparentFromSolid(sourcePath, transparentSource, { ...config, defaultSize: "1024x1024" });
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  const normalized = await sharp(transparentSource)
    .ensureAlpha()
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize(FRAME_WIDTH, FRAME_HEIGHT, {
      fit: "fill"
    })
    .png()
    .toBuffer();

  await sharp(normalized)
    .composite([
      { input: screenMask(), blend: "dest-out" },
      { input: dynamicIsland(), blend: "over" }
    ])
    .png()
    .toFile(outputPath);

  const metadata = await sharp(outputPath).metadata();
  const stats = await sharp(outputPath).ensureAlpha().stats();
  if (metadata.width !== FRAME_WIDTH || metadata.height !== FRAME_HEIGHT || !metadata.hasAlpha || stats.channels[3]?.min !== 0) {
    throw new Error("Generated device frame failed size or transparency validation.");
  }
}

async function run(argv = Bun.argv.slice(2)): Promise<void> {
  const rootDir = path.resolve(import.meta.dir, "..");
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`Generate and normalize the reusable product screenshot device frame.

Usage:
  bun run frame:generate [--force]
  bun run frame:generate --source <existing-image>

Options:
  --source <path>  Normalize an existing generated frame without an API call
  --output <path>  Override the final transparent frame path
  --force          Replace an existing final frame
  --help           Show this help`);
    return;
  }

  const outputPath = path.resolve(argumentValue(argv, "--output") ?? path.join(rootDir, "../../shared/brand/device-frames/iphone-frame.png"));
  const force = argv.includes("--force");
  if (existsSync(outputPath) && !force) {
    throw new Error(`Device frame already exists: ${outputPath}. Use --force to replace it.`);
  }

  const temporaryDir = path.join(rootDir, "outputs/product-screenshots/_generated/device-frame");
  await mkdir(temporaryDir, { recursive: true });
  const suppliedSource = argumentValue(argv, "--source");
  const sourcePath = suppliedSource ? path.resolve(suppliedSource) : path.join(temporaryDir, "device-frame-source.png");
  if (suppliedSource && !existsSync(sourcePath)) throw new Error(`Source frame not found: ${sourcePath}`);

  if (!suppliedSource) {
    const client = new OpenRouterClient(loadConfig());
    console.log("Generating reusable device frame with OpenRouter...");
    await client.generateImage({
      prompt: `Create one isolated, photorealistic premium modern smartphone frame for deterministic product mockups.

Composition:
- perfectly front-facing with no perspective, rotation, tilt, hands, stand, or environment
- current iPhone-style proportions with very thin symmetrical black bezels and softly rounded corners
- polished graphite and silver titanium outer rails with restrained realistic reflections
- device centered and filling about 88 percent of a 9:16 portrait canvas
- screen area completely empty and transparent, with a small clean black Dynamic Island at the top
- outside the device completely transparent

Hard constraints:
- no Apple logo, no brand marks, no text, no letters, no watermark
- no content, icons, gradients, wallpaper, reflections, or UI inside the screen opening
- no cast shadow outside the device
- exact bilateral symmetry and clean production-ready edges`,
      outputPath: sourcePath,
      background: "transparent",
      size: "1080x1920"
    });
  }

  await prepareFrame(sourcePath, outputPath, temporaryDir);
  if (!suppliedSource) await rm(path.join(temporaryDir, "device-frame-transparent.png"), { force: true });
  console.log(`Device frame ready: ${path.relative(process.cwd(), outputPath)}`);
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
