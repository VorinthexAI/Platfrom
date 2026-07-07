import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import type { AudioConfig } from "./types";
import { audioFormatSchema, audioModeSchema } from "./types";

const fileConfigSchema = z.object({
  defaults: z.object({
    mode: audioModeSchema,
    model: z.string(),
    ttsModel: z.string(),
    duration: z.number().int().min(1).max(120),
    format: audioFormatSchema,
    variants: z.number().int().min(1).max(20),
    voice: z.string(),
    bpm: z.number().int().min(30).max(220)
  }),
  style: z.object({
    soundtrackLanguage: z.string(),
    ttsLanguage: z.string(),
    negativePrompt: z.string()
  })
});

function envString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export async function loadAudioConfig(rootDir = path.resolve(import.meta.dir, "..")): Promise<AudioConfig> {
  dotenv.config({ path: path.join(rootDir, ".env"), quiet: true });
  dotenv.config({ path: path.resolve(rootDir, "../video/.env"), quiet: true });
  const fileConfig = fileConfigSchema.parse(await Bun.file(path.join(rootDir, "audio.config.json")).json());
  return {
    rootDir,
    openRouterApiKey: envString(process.env.OPENROUTER_API_KEY),
    baseUrl: envString(process.env.OPENROUTER_BASE_URL) ?? "https://openrouter.ai/api/v1",
    model: envString(process.env.OPENROUTER_AUDIO_MODEL) ?? fileConfig.defaults.model,
    ttsModel: envString(process.env.OPENROUTER_TTS_MODEL) ?? fileConfig.defaults.ttsModel,
    mode: audioModeSchema.parse(envString(process.env.AUDIO_DEFAULT_MODE) ?? fileConfig.defaults.mode),
    duration: Number(envString(process.env.AUDIO_DEFAULT_DURATION) ?? fileConfig.defaults.duration),
    format: audioFormatSchema.parse(envString(process.env.AUDIO_DEFAULT_FORMAT) ?? fileConfig.defaults.format),
    variants: Number(envString(process.env.AUDIO_DEFAULT_VARIANTS) ?? fileConfig.defaults.variants),
    voice: envString(process.env.AUDIO_DEFAULT_VOICE) ?? fileConfig.defaults.voice,
    bpm: Number(envString(process.env.AUDIO_DEFAULT_BPM) ?? fileConfig.defaults.bpm),
    style: fileConfig.style
  };
}
