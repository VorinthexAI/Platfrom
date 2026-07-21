import { z } from "zod";

export const videoCategorySchema = z.enum(["master-brand", "product", "capability", "orchestrator"]);
export const aspectRatioSchema = z.enum(["16:9", "9:16"]);
export const resolutionSchema = z.enum(["720p", "1080p"]);

export type VideoCategory = z.infer<typeof videoCategorySchema>;
export type AspectRatio = z.infer<typeof aspectRatioSchema>;
export type Resolution = z.infer<typeof resolutionSchema>;

export const videoVersionSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  prompt: z.string(),
  fullPrompt: z.string(),
  model: z.string(),
  duration: z.number().int().min(1),
  resolution: resolutionSchema,
  aspectRatio: aspectRatioSchema,
  providerJobId: z.string().optional(),
  status: z.enum(["pending", "completed", "failed"]),
  videoPath: z.string().optional(),
  thumbnailPath: z.string().optional(),
  metadataPath: z.string(),
  error: z.string().optional(),
  createdAt: z.string()
});

export const videoAssetSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  category: videoCategorySchema,
  entityId: z.string().optional(),
  description: z.string().optional(),
  currentVersionId: z.string().optional(),
  versions: z.array(videoVersionSchema),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const videoRegistrySchema = z.object({
  videos: z.array(videoAssetSchema)
});

export type VideoVersion = z.infer<typeof videoVersionSchema>;
export type VideoAsset = z.infer<typeof videoAssetSchema>;

export type VideoConfig = {
  rootDir: string;
  openRouterApiKey?: string;
  baseUrl: string;
  model: string;
  duration: number;
  resolution: Resolution;
  aspectRatio: AspectRatio;
  variants: number;
  generateAudio: boolean;
  sendAudioParam: boolean;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  style: {
    visualLanguage: string;
    motionLanguage: string;
    audioLanguage: string;
    negativePrompt: string;
  };
};

export type GenerateVideoInput = {
  model: string;
  prompt: string;
  duration: number;
  resolution: Resolution;
  aspectRatio: AspectRatio;
  generateAudio: boolean;
  referenceImage?: string;
};

export type VideoJob = {
  id: string;
  status: string;
  pollingUrl?: string;
  contentUrl?: string;
  error?: string;
};
