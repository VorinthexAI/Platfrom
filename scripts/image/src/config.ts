import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { EngineConfig } from "./types";

const envSchema = z.object({
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_IMAGE_MODEL: z.preprocess((value) => value === "" ? undefined : value, z.string().default("google/gemini-3.1-flash-lite-image")),
  DEFAULT_SIZE: z.preprocess((value) => value === "" ? undefined : value, z.custom<`${number}x${number}`>((value) => typeof value === "string" && /^\d+x\d+$/.test(value)).default("1024x1024")),
  DEFAULT_SOLID_BACKGROUND: z.preprocess((value) => value === "" ? undefined : value, z.string().default("#030405")),
  DEFAULT_OUTPUT_FORMAT: z.preprocess((value) => value === "" ? undefined : value, z.literal("png").default("png"))
});

export function loadConfig(rootDir = path.resolve(import.meta.dir, "..")): EngineConfig {
  const environmentsPath = path.resolve(rootDir, "..", "..", ".github", "environments.json");
  let registryApiKey: string | undefined;
  try {
    const registry = JSON.parse(readFileSync(environmentsPath, "utf8")) as { secrets?: { dev?: { backend?: { OPENROUTER_API_KEY?: string } } } };
    registryApiKey = registry.secrets?.dev?.backend?.OPENROUTER_API_KEY;
  } catch {}
  const env = envSchema.parse({ ...process.env, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? registryApiKey });
  return {
    rootDir,
    openRouterApiKey: env.OPENROUTER_API_KEY,
    imageModel: env.OPENROUTER_IMAGE_MODEL,
    defaultSize: env.DEFAULT_SIZE,
    defaultSolidBackground: env.DEFAULT_SOLID_BACKGROUND,
    defaultOutputFormat: env.DEFAULT_OUTPUT_FORMAT
  };
}
