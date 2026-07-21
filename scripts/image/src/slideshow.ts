import { existsSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import { nanoid } from "nanoid";
import prompts from "prompts";
import { z } from "zod";
import { slideshowNegativePrompt, slideshowSystemPrompt } from "../prompts/slideshow";
import { loadConfig } from "./config";
import { atomicWrite, ensureRuntime, exists, readText } from "./filesystem";
import { normalizeVerticalSlide } from "./image";
import { OpenAIClient } from "./openai";
import { RegistryStore } from "./registry";
import { assetCategorySchema } from "./types";
import type { AssetCategory, EngineConfig } from "./types";
import { hashText, nowIso, rel, slugify } from "./utils";

const slideSchema = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  visual: z.string().optional(),
  prompt: z.string().optional()
}).refine((slide) => Boolean(slide.title || slide.body || slide.visual || slide.prompt), "Each slide needs title, body, visual, or prompt.");

const briefSchema = z.object({
  slug: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  category: assetCategorySchema.default("experiment"),
  assetSlug: z.string().optional(),
  style: z.string().optional(),
  references: z.array(z.string()).optional(),
  chainPreviousSlide: z.boolean().optional(),
  slides: z.array(slideSchema).min(1)
});

type SlideshowBrief = z.infer<typeof briefSchema>;

type SlideshowOptions = {
  briefPath?: string;
  workspaceDir?: string;
  slug?: string;
  title?: string;
  description?: string;
  category?: AssetCategory;
  assetSlug?: string;
  style?: string;
  references?: string[];
  slides?: Array<z.infer<typeof slideSchema>>;
  chainPreviousSlide?: boolean;
};

const verticalSize = "1024x1536" as const;
const tiktokWidth = 1080;
const tiktokHeight = 1920;

function usage(): string {
  return `Usage:
  bun run slideshow
  bun run slideshow -- ./slideshow/orbit-launch
  bun run slideshow -- --brief ./brief.json
  bun run slideshow -- --slug orbit-launch --title "Orbit Launch" --slides "Hook|Problem|Solution" --references references

Options:
  <folder>                Slideshow folder containing slideshow.json
  --brief <file>          JSON brief with title, style, references, slides
  --slug <slug>           Campaign slug
  --title <title>         Campaign title
  --description <text>    Campaign description
  --category <category>   Asset category, defaults to experiment
  --asset-slug <slug>     Attach to an existing/new asset slug
  --style <text>          Shared style direction
  --references <paths>    Comma-separated files/folders, or "none"
  --slides <items>        Pipe-separated slide titles/prompts
  --chain                 Include the previous generated slide as a continuity reference`;
}

function parseArgs(argv: string[]): SlideshowOptions & { help?: boolean } {
  const options: SlideshowOptions & { help?: boolean } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--brief") options.briefPath = next, index += 1;
    else if (arg === "--slug") options.slug = next, index += 1;
    else if (arg === "--title") options.title = next, index += 1;
    else if (arg === "--description") options.description = next, index += 1;
    else if (arg === "--category") options.category = assetCategorySchema.parse(next), index += 1;
    else if (arg === "--asset-slug") options.assetSlug = next, index += 1;
    else if (arg === "--style") options.style = next, index += 1;
    else if (arg === "--references") options.references = splitList(next), index += 1;
    else if (arg === "--slides") options.slides = splitSlides(next), index += 1;
    else if (arg === "--chain") options.chainPreviousSlide = true;
    else if (!arg.startsWith("-") && !options.briefPath && !options.workspaceDir) {
      const resolved = path.resolve(arg);
      if (existsSync(resolved) && statSync(resolved).isDirectory()) {
        options.workspaceDir = arg;
        options.briefPath = path.join(arg, "slideshow.json");
      } else {
        options.briefPath = arg;
      }
    }
  }
  return options;
}

function splitList(value = ""): string[] {
  if (value.trim().toLowerCase() === "none") return [];
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function splitSlides(value = ""): Array<z.infer<typeof slideSchema>> {
  return value.split("|").map((entry) => entry.trim()).filter(Boolean).map((entry) => ({ prompt: entry }));
}

async function resolveBrief(options: SlideshowOptions, config: EngineConfig): Promise<SlideshowBrief> {
  const fileBrief = options.briefPath
    ? briefSchema.partial().parse(await Bun.file(path.resolve(options.briefPath)).json())
    : {};
  const merged = {
    ...fileBrief,
    ...defined({
      slug: options.slug,
      title: options.title,
      description: options.description,
      category: options.category,
      assetSlug: options.assetSlug,
      style: options.style,
      references: options.references,
      chainPreviousSlide: options.chainPreviousSlide,
      slides: options.slides
    })
  };
  if (!merged.title || !merged.slides?.length) return promptForBrief(merged, config);
  return briefSchema.parse(merged);
}

function defined<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}

async function promptForBrief(seed: Partial<SlideshowBrief>, config: EngineConfig): Promise<SlideshowBrief> {
  const answer = await prompts([
    { type: "text", name: "title", message: "Slideshow title:", initial: seed.title ?? "Vorinthex AI TikTok slideshow", validate: (value: string) => value.trim().length > 0 || "Title is required." },
    { type: "text", name: "slug", message: "Slug:", initial: slugify(seed.slug ?? seed.title ?? "vorinthex-slideshow") },
    { type: "text", name: "description", message: "Description:", initial: seed.description ?? "" },
    { type: "select", name: "category", message: "Asset category:", choices: assetCategorySchema.options.map((value) => ({ title: value, value })), initial: assetCategorySchema.options.indexOf(seed.category ?? "experiment") },
    { type: "text", name: "style", message: "Shared visual style:", initial: seed.style ?? "Premium Vorinthex AI: obsidian black, polished chrome, dark glass, restrained reflections, cinematic enterprise AI." },
    { type: "text", name: "references", message: "Reference files/folders, comma-separated, or none:", initial: seed.references?.join(",") ?? "none" },
    { type: "list", name: "slides", message: "Slide prompts/titles:", initial: seed.slides?.map((slide) => slide.prompt || slide.title || slide.visual || "").join(", ") ?? "Hook, Problem, Solution" },
    { type: "confirm", name: "chainPreviousSlide", message: "Use previous generated slide as continuity reference?", initial: seed.chainPreviousSlide ?? false }
  ]);
  return briefSchema.parse({
    title: answer.title,
    slug: answer.slug,
    description: answer.description,
    category: answer.category,
    style: answer.style,
    references: splitList(answer.references),
    slides: (answer.slides as string[]).map((prompt) => ({ prompt })),
    chainPreviousSlide: answer.chainPreviousSlide
  });
}

async function resolveReferenceImages(config: EngineConfig, references: string[] = [], workspaceDir?: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of references) {
    const resolved = path.isAbsolute(entry)
      ? entry
      : workspaceDir
        ? path.resolve(workspaceDir, entry)
        : path.resolve(config.rootDir, entry);
    if (!await exists(resolved)) continue;
    const file = Bun.file(resolved);
    if ((await file.stat()).isDirectory()) {
      for (const child of await readdir(resolved)) {
        const childPath = path.join(resolved, child);
        if (isImageFile(childPath)) files.push(childPath);
      }
    } else if (isImageFile(resolved)) {
      files.push(resolved);
    }
  }
  return [...new Set(files)];
}

function isImageFile(filePath: string): boolean {
  return [".png", ".jpg", ".jpeg", ".webp"].includes(path.extname(filePath).toLowerCase());
}

function buildStyleBible(brief: SlideshowBrief, referenceCount: number): string {
  const referenceRules = referenceCount > 0
    ? [
      `- Reference priority: ${referenceCount} reference image(s) are the highest-priority visual source.`,
      "- Match the references for style, palette, material language, lighting, mood, camera distance, composition density, typography behavior, and brand feel.",
      "- Do not let a single slide title, visual field, or prompt override the reference image direction.",
      "- Use slide-specific visual text only to choose the subject or scene variation inside the referenced style system.",
      "- If the written slide instruction conflicts with the references, follow the references and adapt the instruction conservatively."
    ]
    : [
      "- No reference images supplied. The shared style text is the highest-priority visual source."
    ];
  return [
    "Campaign consistency contract:",
    `- Campaign: ${brief.title}`,
    brief.description ? `- Description: ${brief.description}` : undefined,
    `- Shared style: ${brief.style || "Premium Vorinthex AI: obsidian black, polished chrome, dark glass, restrained reflections, cinematic enterprise AI."}`,
    `- References supplied: ${referenceCount}.`,
    ...referenceRules,
    "- Use one coherent palette, material system, camera language, lighting setup, depth treatment, and typography style across all slides.",
    "- Compose for TikTok 9:16 with safe margins at top and bottom.",
    "- Preserve continuity while changing the subject/action per slide."
  ].filter(Boolean).join("\n");
}

function buildSlidePrompt(brief: SlideshowBrief, slide: z.infer<typeof slideSchema>, index: number, total: number, styleBible: string): string {
  const forbidsRenderedText = /\bno text\b|\bno text rendered\b|\bwithout text\b/i.test(brief.style ?? "");
  return `${slideshowSystemPrompt}

${styleBible}

Slide ${index + 1} of ${total}:
${slide.title ? `Slide message for campaign planning, do not render as image text unless explicitly allowed: ${slide.title}` : ""}
${slide.body ? `Body message for campaign planning, do not render as image text unless explicitly allowed: ${slide.body}` : ""}
${slide.visual ? `Slide subject idea, lower priority than references: ${slide.visual}` : ""}
${slide.prompt ? `Slide-specific instruction, lower priority than references: ${slide.prompt}` : ""}

Output requirements:
- Native vertical image.
- Final image should work as one slide in a consistent TikTok carousel.
- Keep the reference-driven visual system intact across this slide.
${forbidsRenderedText ? "- Do not render any words, letters, labels, captions, UI text, numbers, or typography inside the image." : "- If adding text, keep it short, premium, readable, and placed safely."}

Negative prompt:
${slideshowNegativePrompt}`;
}

export async function generateSlideshow(options: SlideshowOptions = {}): Promise<void> {
  const config = loadConfig();
  await ensureRuntime(config);
  const registry = new RegistryStore(config.rootDir);
  const client = new OpenAIClient(config);
  const brief = await resolveBrief(options, config);
  const slug = slugify(brief.slug || brief.title);
  const assetSlug = slugify(brief.assetSlug || slug);
  const workspaceDir = path.resolve(
    config.rootDir,
    options.workspaceDir ?? (options.briefPath ? path.dirname(path.resolve(options.briefPath)) : path.join("slideshow", slug))
  );
  const referenceImages = await resolveReferenceImages(config, brief.references, workspaceDir);
  const asset = await registry.createAsset({
    name: brief.title,
    slug: assetSlug,
    category: brief.category,
    description: brief.description,
    designIntent: `TikTok slideshow campaign. ${brief.style ?? ""}`.trim()
  });

  const versionId = `v${Math.max(0, ...asset.versions.map((version) => version.version)) + 1}`;
  const runId = nanoid(12);
  const assetDir = path.join(config.rootDir, "assets", brief.category, assetSlug, versionId);
  const outputDir = path.join(workspaceDir, "outputs", versionId);
  const runDir = path.join(config.rootDir, "runs", runId);
  const styleBible = buildStyleBible(brief, referenceImages.length);
  const slidePaths: string[] = [];
  const promptParts: string[] = [`# ${brief.title}`, "", "## Style Bible", "", styleBible];

  await registry.appendRun({ runId, assetId: asset.id, versionId, action: "Generate slideshow", createdAt: nowIso(), status: "started" });
  let previousSlidePath: string | undefined;
  for (let index = 0; index < brief.slides.length; index += 1) {
    const slide = brief.slides[index];
    const prompt = buildSlidePrompt(brief, slide, index, brief.slides.length, styleBible);
    const rawPath = path.join(outputDir, `slide-${String(index + 1).padStart(2, "0")}-raw.png`);
    const finalPath = path.join(outputDir, `slide-${String(index + 1).padStart(2, "0")}.png`);
    const sourceImagePaths = [...referenceImages, ...(brief.chainPreviousSlide && previousSlidePath ? [previousSlidePath] : [])];
    console.log(chalk.cyan(`Generating slide ${index + 1}/${brief.slides.length}${sourceImagePaths.length ? ` with ${sourceImagePaths.length} reference image(s)` : " with no reference images"}`));
    await client.editImage({
      prompt,
      outputPath: rawPath,
      background: "opaque",
      sourceImagePaths,
      size: verticalSize
    });
    await normalizeVerticalSlide(rawPath, finalPath, tiktokWidth, tiktokHeight);
    previousSlidePath = finalPath;
    slidePaths.push(rel(config.rootDir, finalPath));
    promptParts.push("", `## Slide ${index + 1}`, "", prompt);
  }

  const promptPath = path.join(assetDir, "prompt.md");
  const metadataPath = path.join(assetDir, "metadata.json");
  const manifestPath = path.join(outputDir, "slideshow.json");
  await atomicWrite(promptPath, `${promptParts.join("\n")}\n`);
  const metadata = {
    runId,
    assetId: asset.id,
    versionId,
    kind: "slideshow",
    model: config.imageModel,
    generationSize: verticalSize,
    outputSize: `${tiktokWidth}x${tiktokHeight}`,
    createdAt: nowIso(),
    promptHash: hashText(await readText(promptPath)),
    fullPromptPath: rel(config.rootDir, promptPath),
    slideshowPath: rel(config.rootDir, manifestPath),
    previewPath: slidePaths[0],
    slidePaths,
    referenceImagePaths: referenceImages.map((filePath) => rel(config.rootDir, filePath)),
    chainPreviousSlide: Boolean(brief.chainPreviousSlide),
    brief
  };
  await atomicWrite(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  await atomicWrite(manifestPath, `${JSON.stringify(metadata, null, 2)}\n`);

  const version = await registry.addVersion(asset, {
    prompt: brief.description ?? brief.title,
    fullPrompt: await readText(promptPath),
    slideshowPath: rel(config.rootDir, manifestPath),
    previewPath: slidePaths[0],
    slidePaths,
    referenceImagePaths: metadata.referenceImagePaths,
    metadataPath: rel(config.rootDir, metadataPath),
    accepted: false,
    rejected: false,
    notes: `TikTok slideshow: ${slidePaths.length} slides, ${referenceImages.length} reference image(s).`
  });
  await registry.appendRun({ runId, assetId: asset.id, versionId, action: "Generate slideshow", createdAt: nowIso(), status: "completed" });
  await registry.appendHistory(asset, `Generated slideshow ${version.id}`, version.notes, [metadata.slideshowPath, ...slidePaths]);

  console.log(chalk.green(`Generated slideshow ${asset.slug} ${version.id}`));
  console.log(`- ${metadata.slideshowPath}`);
  for (const slidePath of slidePaths) console.log(`- ${slidePath}`);
}

if (import.meta.main) {
  const options = parseArgs(Bun.argv.slice(2));
  if (options.help) {
    console.log(usage());
    process.exit(0);
  }
  generateSlideshow(options).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
