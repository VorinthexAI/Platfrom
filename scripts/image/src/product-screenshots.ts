import { copyFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";
import sharp from "sharp";
import { z } from "zod";
import { loadConfig } from "./config";
import { OpenRouterClient } from "./openrouter";

const presetSchema = z.enum(["social", "apple", "google"]);
type PresetName = z.infer<typeof presetSchema>;

const screenInsetsSchema = z.object({
  top: z.number().min(0).max(25),
  right: z.number().min(0).max(25),
  bottom: z.number().min(0).max(25),
  left: z.number().min(0).max(25)
}).strict();

const screenshotManifestSchema = z.object({
  version: z.literal(1),
  defaults: z.object({
    logo: z.string().min(1),
    deviceFrame: z.string().min(1).optional(),
    screenInsets: screenInsetsSchema.default({ top: 2.35, right: 5.15, bottom: 2.35, left: 5.15 })
  }).strict(),
  screenshots: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
    title: z.string().min(1).max(80),
    description: z.string().min(1).max(240),
    screenshot: z.string().min(1),
    logo: z.string().min(1).optional(),
    deviceFrame: z.string().min(1).optional(),
    screenInsets: screenInsetsSchema.optional(),
    background: z.string().min(1).optional(),
    backgroundPrompt: z.string().min(1).max(1_500).optional(),
    screenshotPosition: z.enum(["top", "center", "bottom"]).default("top")
  }).strict()).min(1)
}).strict();

type Manifest = z.infer<typeof screenshotManifestSchema>;
type Card = Manifest["screenshots"][number];

const PRESETS: Record<PresetName, { width: number; height: number }> = {
  social: { width: 1080, height: 1920 },
  apple: { width: 1320, height: 2868 },
  google: { width: 1320, height: 2868 }
};

type Options = {
  configPath: string;
  outputDir: string;
  presets: PresetName[];
  generateBackgrounds: boolean;
  force: boolean;
  publish: boolean;
  help: boolean;
};

function argumentValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function parseArgs(args: string[], rootDir: string): Options {
  const preset = argumentValue(args, "--preset") ?? "social";
  const presets = preset === "all" ? presetSchema.options : [presetSchema.parse(preset)];
  return {
    configPath: path.resolve(argumentValue(args, "--config") ?? path.join(rootDir, "product-screenshots/screenshots.json")),
    outputDir: path.resolve(argumentValue(args, "--output") ?? path.join(rootDir, "outputs/product-screenshots")),
    presets,
    generateBackgrounds: args.includes("--generate-backgrounds"),
    force: args.includes("--force"),
    publish: args.includes("--publish"),
    help: args.includes("--help") || args.includes("-h")
  };
}

function printHelp(): void {
  console.log(`Render branded product screenshots from HTML and CSS.

Usage:
  bun run screenshots:render [options]

Options:
  --config <path>          Manifest path (default: product-screenshots/screenshots.json)
  --output <directory>     Output directory (default: outputs/product-screenshots)
  --preset <name>          social, apple, google, or all (default: social)
  --generate-backgrounds  Generate missing AI backgrounds with OpenRouter
  --force                 Regenerate cached AI backgrounds
  --publish               Copy Apple and Google renders into mobile store folders
  --help                  Show this help`);
}

function resolveFromManifest(manifestDir: string, filePath: string): string {
  return path.resolve(manifestDir, filePath);
}

function mimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".svg": return "image/svg+xml";
    default: return "image/png";
  }
}

async function dataUrl(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return `data:${mimeType(filePath)};base64,${bytes.toString("base64")}`;
}

async function readManifest(configPath: string): Promise<Manifest> {
  const parsed = JSON.parse(await readFile(configPath, "utf8"));
  const manifest = screenshotManifestSchema.parse(parsed);
  const duplicate = manifest.screenshots.find((card, index) => manifest.screenshots.findIndex((other) => other.id === card.id) !== index);
  if (duplicate) throw new Error(`Duplicate screenshot id: ${duplicate.id}`);
  return manifest;
}

function findChromeExecutable(): string | undefined {
  const candidates = process.platform === "win32"
    ? [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
      ]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return candidates.find(existsSync);
}

async function launchBrowser(): Promise<Browser> {
  const options = {
    headless: true as const,
    args: ["--disable-gpu", "--disable-dev-shm-usage"],
    timeout: 60_000
  };
  try {
    return await chromium.launch(options);
  } catch (bundledBrowserError) {
    const executablePath = findChromeExecutable();
    if (!executablePath) throw bundledBrowserError;
    return chromium.launch({ ...options, executablePath });
  }
}

async function generateBackgrounds(
  cards: Card[],
  outputDir: string,
  force: boolean
): Promise<Map<string, string>> {
  const backgrounds = new Map<string, string>();
  const candidates = cards.filter((card) => card.backgroundPrompt);
  if (candidates.length === 0) return backgrounds;

  const config = loadConfig();
  const client = new OpenRouterClient(config);
  const backgroundDir = path.join(outputDir, "_generated/backgrounds");
  await mkdir(backgroundDir, { recursive: true });

  for (const card of candidates) {
    const outputPath = path.join(backgroundDir, `${card.id}.png`);
    if (!force && existsSync(outputPath)) {
      backgrounds.set(card.id, outputPath);
      continue;
    }
    console.log(`Generating background for ${card.id}...`);
    await client.generateImage({
      prompt: `Create a premium vertical background plate for a Vorinthex AI product screenshot. ${card.backgroundPrompt}\n\nRequirements: 9:16 portrait, obsidian black first, restrained silver or chrome detail, high contrast, low clutter, clear central negative space for a phone, no text, no letters, no logos, no watermark, no phone, no user interface.`,
      outputPath,
      background: "opaque",
      size: "1080x1920"
    });
    backgrounds.set(card.id, outputPath);
  }
  return backgrounds;
}

async function renderCard(input: {
  browser: Browser;
  templatePath: string;
  manifestDir: string;
  manifest: Manifest;
  card: Card;
  preset: PresetName;
  outputPath: string;
  generatedBackground?: string;
}): Promise<{ usedFallbackFrame: boolean }> {
  const dimensions = PRESETS[input.preset];
  const logoPath = resolveFromManifest(input.manifestDir, input.card.logo ?? input.manifest.defaults.logo);
  const screenshotPath = resolveFromManifest(input.manifestDir, input.card.screenshot);
  const configuredFrame = input.card.deviceFrame ?? input.manifest.defaults.deviceFrame;
  const framePath = configuredFrame ? resolveFromManifest(input.manifestDir, configuredFrame) : undefined;
  const configuredBackground = input.card.background
    ? resolveFromManifest(input.manifestDir, input.card.background)
    : input.generatedBackground;

  if (!existsSync(logoPath)) throw new Error(`Logo not found for ${input.card.id}: ${logoPath}`);
  if (!existsSync(screenshotPath)) throw new Error(`Screenshot not found for ${input.card.id}: ${screenshotPath}`);
  if (input.card.background && configuredBackground && !existsSync(configuredBackground)) {
    throw new Error(`Background not found for ${input.card.id}: ${configuredBackground}`);
  }

  const usedFallbackFrame = !framePath || !existsSync(framePath);
  const insets = input.card.screenInsets ?? input.manifest.defaults.screenInsets;
  const page = await input.browser.newPage({ viewport: dimensions, deviceScaleFactor: 1 });
  try {
    await page.goto(pathToFileURL(input.templatePath).href, { waitUntil: "load" });
    await page.evaluate((renderInput) => {
      const canvas = document.querySelector<HTMLElement>(".canvas")!;
      const logo = document.querySelector<HTMLImageElement>(".brand-logo")!;
      const screen = document.querySelector<HTMLImageElement>(".screen")!;
      const frame = document.querySelector<HTMLImageElement>(".device-frame")!;
      const background = document.querySelector<HTMLImageElement>(".background")!;
      const title = document.querySelector<HTMLElement>(".title")!;
      const description = document.querySelector<HTMLElement>(".description")!;

      document.documentElement.style.setProperty("--canvas-width", `${renderInput.width}px`);
      document.documentElement.style.setProperty("--canvas-height", `${renderInput.height}px`);
      document.documentElement.style.setProperty("--scale", String(renderInput.width / 1080));
      document.documentElement.style.setProperty("--screen-top", `${renderInput.insets.top}%`);
      document.documentElement.style.setProperty("--screen-right", `${renderInput.insets.right}%`);
      document.documentElement.style.setProperty("--screen-bottom", `${renderInput.insets.bottom}%`);
      document.documentElement.style.setProperty("--screen-left", `${renderInput.insets.left}%`);

      canvas.setAttribute("aria-label", `${renderInput.title}. ${renderInput.description}`);
      title.textContent = renderInput.title;
      description.textContent = renderInput.description;
      logo.src = renderInput.logo;
      logo.alt = `${renderInput.title} logo`;
      screen.src = renderInput.screenshot;
      screen.alt = `${renderInput.title} product screen`;
      screen.style.objectPosition = `center ${renderInput.screenshotPosition}`;
      if (renderInput.frame) {
        frame.src = renderInput.frame;
        canvas.classList.add("has-frame");
      }
      if (renderInput.background) {
        background.src = renderInput.background;
        canvas.classList.add("has-background");
      }
    }, {
      width: dimensions.width,
      height: dimensions.height,
      insets,
      title: input.card.title,
      description: input.card.description,
      screenshotPosition: input.card.screenshotPosition,
      logo: await dataUrl(logoPath),
      screenshot: await dataUrl(screenshotPath),
      frame: usedFallbackFrame ? undefined : await dataUrl(framePath),
      background: configuredBackground && existsSync(configuredBackground) ? await dataUrl(configuredBackground) : undefined
    });

    await page.waitForFunction(() => Array.from(document.images).filter((image) => image.src).every((image) => image.complete && image.naturalWidth > 0));
    await page.evaluate(() => document.fonts.ready);
    await mkdir(path.dirname(input.outputPath), { recursive: true });
    await page.locator(".canvas").screenshot({ path: input.outputPath, type: "png" });
  } finally {
    await page.close();
  }

  const metadata = await sharp(input.outputPath).metadata();
  if (metadata.width !== dimensions.width || metadata.height !== dimensions.height || metadata.format !== "png") {
    throw new Error(`Invalid ${input.preset} render for ${input.card.id}: expected ${dimensions.width}x${dimensions.height} PNG, got ${metadata.width}x${metadata.height} ${metadata.format}.`);
  }
  return { usedFallbackFrame };
}

async function publishRender(rootDir: string, preset: PresetName, cardId: string, outputPath: string): Promise<void> {
  const destination = preset === "apple"
    ? path.resolve(rootDir, "../../mobile/scripts/assets/screenshots/apple/iphone-6-7", `${cardId}.png`)
    : preset === "google"
      ? path.resolve(rootDir, "../../mobile/scripts/assets/screenshots/google/phone", `${cardId}.png`)
      : undefined;
  if (!destination) return;
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(outputPath, destination);
  console.log(`Published ${path.relative(process.cwd(), destination)}`);
}

export async function runProductScreenshotRenderer(argv = process.argv.slice(2)): Promise<void> {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const options = parseArgs(argv, rootDir);
  if (options.help) {
    printHelp();
    return;
  }

  const manifest = await readManifest(options.configPath);
  const manifestDir = path.dirname(options.configPath);
  const generatedBackgrounds = options.generateBackgrounds
    ? await generateBackgrounds(manifest.screenshots, options.outputDir, options.force)
    : new Map<string, string>();
  const cachedBackgroundDir = path.join(options.outputDir, "_generated/backgrounds");
  for (const card of manifest.screenshots) {
    const cached = path.join(cachedBackgroundDir, `${card.id}.png`);
    if (!generatedBackgrounds.has(card.id) && existsSync(cached)) generatedBackgrounds.set(card.id, cached);
  }

  const browser = await launchBrowser();
  let fallbackReported = false;
  try {
    for (const preset of options.presets) {
      for (const card of manifest.screenshots) {
        const outputPath = path.join(options.outputDir, preset, `${card.id}.png`);
        const result = await renderCard({
          browser,
          templatePath: path.join(rootDir, "product-screenshots/template.html"),
          manifestDir,
          manifest,
          card,
          preset,
          outputPath,
          generatedBackground: generatedBackgrounds.get(card.id)
        });
        if (result.usedFallbackFrame && !fallbackReported) {
          console.warn("Device frame asset is missing; using the deterministic CSS frame. Run `bun run frame:generate` to create it.");
          fallbackReported = true;
        }
        console.log(`Rendered ${path.relative(process.cwd(), outputPath)}`);
        if (options.publish) await publishRender(rootDir, preset, card.id, outputPath);
      }
    }
  } finally {
    await browser.close();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runProductScreenshotRenderer().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
