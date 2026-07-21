import { z } from "zod";

export const audioCategorySchema = z.enum(["master-brand", "product", "capability", "orchestrator"]);
export const audioModeSchema = z.enum(["soundtrack", "tts"]);
export const audioFormatSchema = z.enum(["mp3", "wav", "flac", "opus", "pcm", "pcm16"]);

export type AudioCategory = z.infer<typeof audioCategorySchema>;
export type AudioMode = z.infer<typeof audioModeSchema>;
export type AudioFormat = z.infer<typeof audioFormatSchema>;

export const audioVersionSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  prompt: z.string(),
  fullPrompt: z.string(),
  mode: audioModeSchema,
  model: z.string(),
  voice: z.string().optional(),
  language: z.string().optional(),
  duration: z.number().int().min(1),
  format: audioFormatSchema,
  status: z.enum(["pending", "completed", "failed"]),
  audioPath: z.string().optional(),
  metadataPath: z.string(),
  error: z.string().optional(),
  createdAt: z.string()
});

export const audioAssetSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  category: audioCategorySchema,
  entityId: z.string().optional(),
  description: z.string().optional(),
  currentVersionId: z.string().optional(),
  versions: z.array(audioVersionSchema),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const audioRegistrySchema = z.object({
  audio: z.array(audioAssetSchema)
});

export type AudioVersion = z.infer<typeof audioVersionSchema>;
export type AudioAsset = z.infer<typeof audioAssetSchema>;

export type AudioConfig = {
  rootDir: string;
  openRouterApiKey?: string;
  baseUrl: string;
  model: string;
  ttsModel: string;
  mode: AudioMode;
  duration: number;
  format: AudioFormat;
  variants: number;
  voice: string;
  bpm: number;
  style: {
    soundtrackLanguage: string;
    ttsLanguage: string;
    negativePrompt: string;
  };
};

export type GenerateSoundtrackInput = {
  model: string;
  prompt: string;
  format: AudioFormat;
};

export type GenerateSpeechInput = {
  model: string;
  input: string;
  voice: string;
  format: AudioFormat;
  speed?: number;
};
