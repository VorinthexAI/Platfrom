/**
 * Agent Tool: generateSlideshowTemplate (Azure Foundry version)
 * -------------------------------------------------------------
 * Generates a slideshow template via the Azure OpenAI Images API using
 * gpt-image-2, deployed in Microsoft Foundry.
 *
 * No agent SDK dependency. This defines a small custom AgentTool shape
 * (name, description, JSON schema, execute) that mirrors how most agent
 * frameworks describe a callable tool. Wire it into OpenAI function calling,
 * LangChain, or a custom loop by reading `.name`, `.description`,
 * `.parameters`, and calling `.execute()`.
 *
 * Runs locally or on your own server, not inside the Foundry portal.
 *
 * Required environment variables:
 * - AZURE_OPENAI_ENDPOINT, for example https://example.openai.azure.com/openai/v1/
 * - AZURE_OPENAI_API_KEY
 *
 * Example:
 * bun launch/tools/genereate-slideshow-template/index.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { z } from "zod";
import { estimateImageTurnCostUsd, loadEnvFile } from "../utilities";

const TOOL_SLUG = "generate-slideshow-template";
const TOOL_DIR = import.meta.dir;
const DEFAULT_OUTPUT_ROOT = path.resolve(TOOL_DIR, "../../agents/slideshow-director/outputs");
const ENV_PATH = path.resolve(TOOL_DIR, "../../.env");

loadEnvFile(ENV_PATH);

const MODEL_ID = process.env.AZURE_OPENAI_IMAGE_DEPLOYMENT ?? "gpt-image-2";
const IMAGE_QUALITY = "low" as const;
const IMAGE_SIZE = "1024x1536" as const;

const PRICE_PER_M_TEXT_INPUT = 5.0;
const PRICE_PER_M_IMAGE_INPUT = 8.0;
const PRICE_PER_M_IMAGE_OUTPUT = 30.0;

const SlideshowTemplateInputSchema = z.object({
  scenes: z
    .array(z.string().min(1))
    .min(2)
    .max(20)
    .describe("List of scene descriptions, one per slide, in order. At least 2."),
  baseStyle: z
    .string()
    .min(1)
    .describe("Fixed style description sent in the first turn and retained through conversation memory."),
  outputName: z
    .string()
    .min(1)
    .optional()
    .describe("Optional human-readable label stored in metadata. Agent output folders always use a random UUID."),
  saveImages: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to save generated PNG files to disk."),
});

type SlideshowTemplateInput = z.input<typeof SlideshowTemplateInputSchema>;
type ParsedSlideshowTemplateInput = z.output<typeof SlideshowTemplateInputSchema>;

interface GeneratedSlide {
  index: number;
  imageBase64: string;
  responseId: string;
  estimatedCostUsd: number;
  imagePath?: string;
}

interface SlideshowTemplateResult {
  slides: GeneratedSlide[];
  totalEstimatedCostUsd: number;
  slideCount: number;
  outputDir?: string;
}

interface AgentTool<TInput, TOutput> {
  name: string;
  description: string;
  parameters: z.ZodType<TInput>;
  execute: (input: TInput) => Promise<TOutput>;
}

function createAzureOpenAIClient(): OpenAI {
  const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const azureApiKey = process.env.AZURE_OPENAI_API_KEY;

  if (!azureEndpoint || !azureApiKey) {
    throw new Error("Missing AZURE_OPENAI_ENDPOINT or AZURE_OPENAI_API_KEY environment variables.");
  }

  return new OpenAI({
    baseURL: azureEndpoint,
    apiKey: azureApiKey,
  });
}

function outputFolderName(): string {
  return randomUUID();
}

async function runSlideshowTemplatePipeline(
  input: SlideshowTemplateInput,
): Promise<SlideshowTemplateResult> {
  const parsed = SlideshowTemplateInputSchema.parse(input);
  const { scenes, baseStyle, saveImages } = parsed;
  const openai = createAzureOpenAIClient();
  const outputDir = saveImages ? path.join(DEFAULT_OUTPUT_ROOT, outputFolderName()) : undefined;

  if (outputDir) await mkdir(outputDir, { recursive: true });

  const slides: GeneratedSlide[] = [];
  let totalEstimatedCostUsd = 0;

  for (let index = 0; index < scenes.length; index += 1) {
    const promptText = [
      baseStyle,
      "",
      `Slide ${index + 1} of ${scenes.length}.`,
      "Keep the same protagonist, material language, lighting, palette, camera grammar, and premium Vorinthex Hunt campaign style as the full sequence.",
      scenes[index],
    ].join("\n");

    const response = await openai.images.generate({
      model: MODEL_ID,
      prompt: promptText,
      quality: IMAGE_QUALITY,
      size: IMAGE_SIZE,
      output_format: "png",
      n: 1,
    } as never);

    const imageBase64 = await extractImageBase64(response);

    if (!imageBase64) {
      throw new Error(`No image was returned for slide ${index + 1}.`);
    }

    const cost = estimateImageTurnCostUsd((response as { usage?: unknown }).usage, {
      textInputPerMillion: PRICE_PER_M_TEXT_INPUT,
      imageInputPerMillion: PRICE_PER_M_IMAGE_INPUT,
      imageOutputPerMillion: PRICE_PER_M_IMAGE_OUTPUT,
    });
    const slide: GeneratedSlide = {
      index,
      imageBase64,
      responseId: `image-${index + 1}`,
      estimatedCostUsd: cost,
    };

    if (outputDir) {
      const imagePath = path.join(outputDir, `slide-${String(index + 1).padStart(2, "0")}.png`);
      await writeFile(imagePath, Buffer.from(imageBase64, "base64"));
      slide.imagePath = imagePath;
    }

    slides.push(slide);
    totalEstimatedCostUsd += cost;
  }

  if (outputDir) {
    await writeFile(
      path.join(outputDir, "metadata.json"),
      `${JSON.stringify(
        {
          tool: TOOL_SLUG,
          model: MODEL_ID,
          imageQuality: IMAGE_QUALITY,
          imageSize: IMAGE_SIZE,
          outputName: parsed.outputName,
          outputId: path.basename(outputDir),
          slideCount: slides.length,
          totalEstimatedCostUsd,
          createdAt: new Date().toISOString(),
          scenes,
          baseStyle,
        },
        null,
        2,
      )}\n`,
    );
  }

  return {
    slides,
    totalEstimatedCostUsd,
    slideCount: slides.length,
    outputDir,
  };
}

export const generateSlideshowTemplateTool: AgentTool<
  SlideshowTemplateInput,
  SlideshowTemplateResult
> = {
  name: "generate_slideshow_template",
  description:
    "Generates a vertical slideshow template with consistent visual style through Azure Foundry's " +
    "Images API and gpt-image-2. Saves PNG slides under the agent outputs folder by default.",
  parameters: SlideshowTemplateInputSchema,
  execute: runSlideshowTemplatePipeline,
};

async function main(): Promise<void> {
  const result = await generateSlideshowTemplateTool.execute({
    scenes: [
      "packing a suitcase in a bedroom, morning light",
      "checking the weather forecast on a phone in the hallway",
      "waiting for a train on a platform",
    ],
    baseStyle:
      "flat vector illustration style, warm orange and teal palette, " +
      "soft lighting, character: young woman with short red hair and blue jacket, ",
    outputName: "example",
  });

  console.log(
    `${result.slideCount} slides generated, estimated cost: $${result.totalEstimatedCostUsd.toFixed(3)}`,
  );
  if (result.outputDir) console.log(`Saved to ${result.outputDir}`);
}

if (path.resolve(process.argv[1] ?? "") === path.join(TOOL_DIR, "index.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

async function extractImageBase64(response: unknown): Promise<string | undefined> {
  const image = (response as { data?: Array<{ b64_json?: string; url?: string }> }).data?.[0];
  if (image?.b64_json) return image.b64_json;
  if (!image?.url) return undefined;

  const downloaded = await fetch(image.url);
  if (!downloaded.ok) {
    throw new Error(`Failed to download generated image: ${downloaded.status} ${downloaded.statusText}`);
  }
  return Buffer.from(await downloaded.arrayBuffer()).toString("base64");
}
