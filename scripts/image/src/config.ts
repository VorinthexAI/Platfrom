import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import type { EngineConfig } from "./types";

const envSchema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_IMAGE_MODEL: z.preprocess((value) => value === "" ? undefined : value, z.string().default("gpt-image-1")),
  OPENAI_TEXT_MODEL: z.preprocess((value) => value === "" ? undefined : value, z.string().default("gpt-5.1")),
  DEFAULT_SIZE: z.preprocess((value) => value === "" ? undefined : value, z.custom<`${number}x${number}`>((value) => typeof value === "string" && /^\d+x\d+$/.test(value)).default("1024x1024")),
  DEFAULT_SOLID_BACKGROUND: z.preprocess((value) => value === "" ? undefined : value, z.string().default("#030405")),
  DEFAULT_OUTPUT_FORMAT: z.preprocess((value) => value === "" ? undefined : value, z.literal("png").default("png"))
});

export function loadConfig(rootDir = path.resolve(import.meta.dir, "..")): EngineConfig {
  dotenv.config({ path: path.join(rootDir, ".env"), quiet: true });
  const env = envSchema.parse(process.env);
  return {
    rootDir,
    openAiApiKey: env.OPENAI_API_KEY,
    imageModel: env.OPENAI_IMAGE_MODEL,
    textModel: env.OPENAI_TEXT_MODEL,
    defaultSize: env.DEFAULT_SIZE,
    defaultSolidBackground: env.DEFAULT_SOLID_BACKGROUND,
    defaultOutputFormat: env.DEFAULT_OUTPUT_FORMAT
  };
}
