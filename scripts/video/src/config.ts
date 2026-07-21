import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import type { VideoConfig } from "./types";
import { aspectRatioSchema, resolutionSchema } from "./types";

const fileConfigSchema = z.object({
  defaults: z.object({
    model: z.string(),
    duration: z.number().int().min(1).max(30),
    resolution: resolutionSchema,
    aspectRatio: aspectRatioSchema,
    variants: z.number().int().min(1).max(20),
    generateAudio: z.boolean().optional()
  }),
  style: z.object({
    visualLanguage: z.string(),
    motionLanguage: z.string(),
    audioLanguage: z.string(),
    negativePrompt: z.string()
  })
});

function envString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export async function loadVideoConfig(rootDir = path.resolve(import.meta.dir, "..")): Promise<VideoConfig> {
  dotenv.config({ path: path.join(rootDir, ".env"), quiet: true });
  const fileConfig = fileConfigSchema.parse(await Bun.file(path.join(rootDir, "video.config.json")).json());
  return {
    rootDir,
    openRouterApiKey: envString(process.env.OPENROUTER_API_KEY),
    baseUrl: envString(process.env.OPENROUTER_BASE_URL) ?? "https://openrouter.ai/api/v1",
    model: envString(process.env.OPENROUTER_VIDEO_MODEL) ?? fileConfig.defaults.model,
    duration: Number(envString(process.env.VIDEO_DEFAULT_DURATION) ?? fileConfig.defaults.duration),
    resolution: resolutionSchema.parse(envString(process.env.VIDEO_DEFAULT_RESOLUTION) ?? fileConfig.defaults.resolution),
    aspectRatio: aspectRatioSchema.parse(envString(process.env.VIDEO_DEFAULT_ASPECT_RATIO) ?? fileConfig.defaults.aspectRatio),
    variants: Number(envString(process.env.VIDEO_DEFAULT_VARIANTS) ?? fileConfig.defaults.variants),
    generateAudio: parseBoolean(envString(process.env.VIDEO_DEFAULT_AUDIO), fileConfig.defaults.generateAudio ?? true),
    sendAudioParam: parseBoolean(envString(process.env.VIDEO_SEND_AUDIO_PARAM), false),
    pollIntervalMs: Number(envString(process.env.VIDEO_POLL_INTERVAL_MS) ?? 8000),
    pollTimeoutMs: Number(envString(process.env.VIDEO_POLL_TIMEOUT_MS) ?? 900000),
    style: fileConfig.style
  };
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
