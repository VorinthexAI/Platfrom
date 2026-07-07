import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import type { EngineConfig, GenerateImageInput, ImageResult, ReviewImageInput, ReviewResult } from "./types";
import { retry } from "./utils";
import { reviewPrompt } from "../prompts/review";

async function extractImageBytes(response: unknown): Promise<Buffer> {
  const data = (response as { data?: Array<{ b64_json?: string; url?: string }> }).data;
  const base64 = data?.[0]?.b64_json;
  if (base64) return Buffer.from(base64, "base64");
  const url = data?.[0]?.url;
  if (url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to download generated image: ${response.status} ${response.statusText}`);
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error("OpenAI image response did not include image data.");
}

function extractText(response: unknown): string {
  const outputText = (response as { output_text?: string }).output_text;
  if (outputText) return outputText;
  const output = (response as { output?: Array<{ content?: Array<{ text?: string }> }> }).output;
  return output?.flatMap((entry) => entry.content ?? []).map((entry) => entry.text).filter(Boolean).join("\n") || "";
}

export class OpenAIClient {
  private readonly client: OpenAI;

  constructor(private readonly config: EngineConfig) {
    if (!config.openAiApiKey || config.openAiApiKey === "your_key_here") {
      throw new Error("OPENAI_API_KEY is missing. Set it in scripts/image/.env before generating or reviewing images.");
    }
    this.client = new OpenAI({ apiKey: config.openAiApiKey });
  }

  async generateImage(input: GenerateImageInput): Promise<ImageResult> {
    const result = await retry(async () => {
      const response = await this.client.images.generate({
        model: this.config.imageModel,
        prompt: input.prompt,
        size: this.config.defaultSize,
        background: input.background ?? "auto",
        output_format: this.config.defaultOutputFormat
      } as never);
      return extractImageBytes(response);
    }, 1);
    await mkdir(path.dirname(input.outputPath), { recursive: true });
    await writeFile(input.outputPath, result);
    return { path: input.outputPath, model: this.config.imageModel, size: this.config.defaultSize };
  }

  async editImage(input: GenerateImageInput): Promise<ImageResult> {
    if (!input.sourceImagePath) return this.generateImage(input);
    const sourceImagePath = input.sourceImagePath;
    const result = await retry(async () => {
      const response = await this.client.images.edit({
        model: this.config.imageModel,
        image: createReadStream(sourceImagePath),
        prompt: input.prompt,
        size: this.config.defaultSize,
        background: input.background ?? "auto",
        output_format: this.config.defaultOutputFormat
      } as never);
      return extractImageBytes(response);
    }, 1);
    await mkdir(path.dirname(input.outputPath), { recursive: true });
    await writeFile(input.outputPath, result);
    return { path: input.outputPath, model: this.config.imageModel, size: this.config.defaultSize };
  }

  async reviewImage(input: ReviewImageInput): Promise<ReviewResult> {
    const image = await Bun.file(input.imagePath).bytes();
    const base64 = Buffer.from(image).toString("base64");
    const response = await retry(async () => this.client.responses.create({
      model: this.config.textModel,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: `${reviewPrompt}\n\nGeneration prompt:\n${input.prompt}` },
            { type: "input_image", image_url: `data:image/png;base64,${base64}` }
          ]
        }
      ]
    } as never), 1);
    const markdown = extractText(response) || "Review unavailable: model returned no text.";
    return { markdown };
  }

  async compareImages(input: { aPath: string; bPath: string; prompt: string }): Promise<string> {
    const [a, b] = await Promise.all([Bun.file(input.aPath).bytes(), Bun.file(input.bPath).bytes()]);
    const response = await retry(async () => this.client.responses.create({
      model: this.config.textModel,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: input.prompt },
            { type: "input_image", image_url: `data:image/png;base64,${Buffer.from(a).toString("base64")}` },
            { type: "input_image", image_url: `data:image/png;base64,${Buffer.from(b).toString("base64")}` }
          ]
        }
      ]
    } as never), 1);
    return extractText(response) || "Comparison unavailable: model returned no text.";
  }
}
