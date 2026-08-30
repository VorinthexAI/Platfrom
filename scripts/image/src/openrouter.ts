import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EngineConfig, GenerateImageInput, ImageResult, ReviewImageInput, ReviewResult } from "./types";
import { retry } from "./utils";
import { reviewPrompt } from "../prompts/review";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

function imageMimeType(filePath: string): "image/png" | "image/jpeg" | "image/webp" {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}

async function imageDataUrl(filePath: string): Promise<string> {
  const bytes = await Bun.file(filePath).bytes();
  return `data:${imageMimeType(filePath)};base64,${Buffer.from(bytes).toString("base64")}`;
}

function aspectRatio(size: `${number}x${number}`): string | undefined {
  const [width, height] = size.split("x").map(Number) as [number, number];
  const divisor = (left: number, right: number): number => right === 0 ? left : divisor(right, left % right);
  const factor = divisor(width, height);
  const ratio = `${width / factor}:${height / factor}`;
  return new Set(["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9"]).has(ratio) ? ratio : undefined;
}

function extractImageBytes(response: unknown): Buffer {
  const data = (response as { data?: Array<{ b64_json?: string }> }).data;
  const base64 = data?.[0]?.b64_json;
  if (!base64) throw new Error("OpenRouter image response did not include image data.");
  return Buffer.from(base64, "base64");
}

function extractText(response: unknown): string {
  const content = (response as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.flatMap((part) => typeof part === "object" && part !== null && "text" in part && typeof part.text === "string" ? [part.text] : []).join("\n");
  return "";
}

export class OpenRouterClient {
  constructor(private readonly config: EngineConfig) {
    if (!config.openRouterApiKey || config.openRouterApiKey === "your_key_here") {
      throw new Error("OPENROUTER_API_KEY is missing from the environment and .github/environments.json.");
    }
  }

  private async post(pathname: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${OPENROUTER_BASE_URL}${pathname}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.openRouterApiKey}`,
        "content-type": "application/json",
        "HTTP-Referer": "https://vorinthex.com",
        "X-OpenRouter-Title": "Vorinthex Image Design Engine"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 2_000).replaceAll(this.config.openRouterApiKey!, "[redacted]");
      throw new Error(`OpenRouter request failed with status ${response.status}: ${detail}`);
    }
    return response.json();
  }

  private async createImage(input: GenerateImageInput, sourceImagePaths: string[]): Promise<ImageResult> {
    const size = input.size ?? this.config.defaultSize;
    const references = await Promise.all(sourceImagePaths.map(imageDataUrl));
    const result = await retry(async () => extractImageBytes(await this.post("/images", {
      model: this.config.imageModel,
      prompt: input.prompt,
      n: 1,
      resolution: "1K",
      output_format: this.config.defaultOutputFormat,
      ...(aspectRatio(size) ? { aspect_ratio: aspectRatio(size) } : {}),
      ...(references.length ? { input_references: references.map((url) => ({ type: "image_url", image_url: { url } })) } : {})
    })), 1);
    await mkdir(path.dirname(input.outputPath), { recursive: true });
    await writeFile(input.outputPath, result);
    return { path: input.outputPath, model: this.config.imageModel, size };
  }

  generateImage(input: GenerateImageInput): Promise<ImageResult> {
    return this.createImage(input, []);
  }

  editImage(input: GenerateImageInput): Promise<ImageResult> {
    const sourceImagePaths = input.sourceImagePaths?.length ? input.sourceImagePaths : input.sourceImagePath ? [input.sourceImagePath] : [];
    return this.createImage(input, sourceImagePaths);
  }

  async reviewImage(input: ReviewImageInput): Promise<ReviewResult> {
    const image = await imageDataUrl(input.imagePath);
    const response = await retry(() => this.post("/chat/completions", {
      model: this.config.imageModel,
      messages: [{ role: "user", content: [
        { type: "text", text: `${reviewPrompt}\n\nGeneration prompt:\n${input.prompt}` },
        { type: "image_url", image_url: { url: image } }
      ] }]
    }), 1);
    return { markdown: extractText(response) || "Review unavailable: model returned no text." };
  }

  async compareImages(input: { aPath: string; bPath: string; prompt: string }): Promise<string> {
    const [a, b] = await Promise.all([imageDataUrl(input.aPath), imageDataUrl(input.bPath)]);
    const response = await retry(() => this.post("/chat/completions", {
      model: this.config.imageModel,
      messages: [{ role: "user", content: [
        { type: "text", text: input.prompt },
        { type: "image_url", image_url: { url: a } },
        { type: "image_url", image_url: { url: b } }
      ] }]
    }), 1);
    return extractText(response) || "Comparison unavailable: model returned no text.";
  }
}
