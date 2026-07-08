import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EngineConfig } from "./types";
import { nowIso } from "./utils";

export const runtimeDirs = [
  "memory",
  "registry",
  "assets/master-brand",
  "assets/products",
  "assets/orchestrators",
  "assets/capabilities",
  "assets/experiments",
  "outputs/latest",
  "outputs/transparent",
  "outputs/solid",
  "outputs/packages",
  "outputs/review-sheets",
  "slideshow",
  "runs",
  "backups"
] as const;

const designSystem = `# Vorinthex AI Design System

## Brand Essence

Vorinthex AI should feel like obsidian intelligence: dark, premium, metallic, exact and futuristic.

## Visual Language

- Obsidian black base
- Chrome silver highlights
- Dark glass materials
- Subtle glow only
- No colorful gradients
- No gold unless explicitly requested
- No blue unless explicitly requested
- No neon cyberpunk colors
- No childish effects
- No cartoon styling
- No excessive sparkles
- No glitter overload
- Premium, minimal, industrial
- Apple x Nothing x Dyson x Interstellar
- High contrast
- Sharp geometry
- Symmetry
- Lots of negative space

## Logo Requirements

- 3D chrome / polished metal
- Clean silhouette
- Strong app-icon readability
- Works at small size
- Should look premium on black
- Should also work on transparent background
- Avoid overcomplicated internal details
- Avoid random symbols
- Avoid extra text in logo exports

## Export Requirements

Every generated logo must produce:

1. 1024x1024 PNG with solid obsidian background
2. 1024x1024 PNG with full transparent background
3. Metadata JSON
4. Prompt snapshot
5. Review notes
6. Optional lock file if accepted
`;

const baselinePrompt = `# Baseline Image Prompt

Create a premium, minimal, 3D metallic logo/icon for Vorinthex AI.

Use a dark obsidian and chrome design language.
The logo must be centered, symmetrical and fill most of a 1024x1024 canvas.
Use realistic polished metal with subtle reflections.
Keep the background clean.
Do not include text unless explicitly requested.
Do not add unrelated symbols.
Do not add excessive glitter, stars, flares or noise.
The result must feel like a high-end AI company asset.
`;

export async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function atomicWrite(filePath: string, content: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content);
  await rename(tempPath, filePath);
}

export async function readText(filePath: string, fallback = ""): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  if (!(await exists(filePath))) return fallback;
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function appendMarkdown(filePath: string, content: string): Promise<void> {
  const current = await readText(filePath);
  await atomicWrite(filePath, `${current}${current.endsWith("\n") || current.length === 0 ? "" : "\n"}${content}\n`);
}

export async function ensureRuntime(config: EngineConfig): Promise<void> {
  await mkdir(config.rootDir, { recursive: true });
  for (const dir of runtimeDirs) await mkdir(path.join(config.rootDir, dir), { recursive: true });

  const seeds: Record<string, string> = {
    ".env": "OPENAI_API_KEY=your_key_here\nOPENAI_IMAGE_MODEL=gpt-image-1\nOPENAI_TEXT_MODEL=gpt-5.1\nDEFAULT_SIZE=1024x1024\nDEFAULT_SOLID_BACKGROUND=#030405\nDEFAULT_OUTPUT_FORMAT=png\n",
    "design-system.md": designSystem,
    "baseline-prompt.md": baselinePrompt,
    "memory/history.md": "# History\n",
    "memory/decisions.md": "# Decisions\n",
    "memory/locked-rules.md": "# Locked Rules\n",
    "memory/rejected-directions.md": "# Rejected Directions\n",
    "registry/assets.json": `${JSON.stringify({ assets: [] }, null, 2)}\n`,
    "registry/runs.json": "[]\n",
    "registry/exports.json": "[]\n"
  };

  for (const [relativePath, content] of Object.entries(seeds)) {
    const filePath = path.join(config.rootDir, relativePath);
    if (!(await exists(filePath))) await atomicWrite(filePath, content);
  }

  const locksPath = path.join(config.rootDir, "registry/locks.json");
  if (!(await exists(locksPath))) {
    await writeJson(locksPath, {
      "vorinthex-ai": {
        assetId: "master-brand-vorinthex-ai",
        lockedVersionId: "template",
        lockedAt: new Date().toISOString(),
        lockLevel: "strict",
        rules: [
          "Circular chrome ring",
          "Downward triangular nexus mark",
          "Minimal inner negative space",
          "Strong centered geometry",
          "No extra text",
          "No overdesigned reflections",
          "No red/pink/blue/gold background",
          "Export must include transparent version"
        ]
      }
    });
  }

  const assetsPath = path.join(config.rootDir, "registry/assets.json");
  const assetsRegistry = await readJson<{ assets: Array<Record<string, unknown>> }>(assetsPath, { assets: [] });
  if (!assetsRegistry.assets.some((asset) => asset.slug === "vorinthex-ai")) {
    const now = nowIso();
    assetsRegistry.assets.push({
      id: "master-brand-vorinthex-ai",
      slug: "vorinthex-ai",
      name: "Vorinthex AI",
      category: "master-brand",
      status: "locked",
      locked: true,
      lockedVersionId: "template",
      description: "A minimal chrome circular ring enclosing a sharp downward triangular nexus emblem. The icon should be clean, dark, premium and metallic. The inner field should be dark/transparent depending on export. No text. No extra glitter. The symbol should fill most of the 1024x1024 canvas.",
      designIntent: "Default master-brand lock template for the Vorinthex AI logo.",
      currentVersionId: undefined,
      versions: [],
      createdAt: now,
      updatedAt: now
    });
    await writeJson(assetsPath, assetsRegistry);
  }
}
