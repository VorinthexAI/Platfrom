import { z } from "zod";

export const assetStatusSchema = z.enum(["draft", "reviewed", "locked", "rejected", "archived", "needs_fix"]);
export const assetCategorySchema = z.enum(["master-brand", "product", "orchestrator", "capability", "experiment"]);
export const lockLevelSchema = z.enum(["soft", "medium", "strict", "frozen"]);

export type AssetStatus = z.infer<typeof assetStatusSchema>;
export type AssetCategory = z.infer<typeof assetCategorySchema>;
export type LockLevel = z.infer<typeof lockLevelSchema>;

export const assetVersionSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  prompt: z.string(),
  fullPrompt: z.string(),
  solidPath: z.string().optional(),
  transparentPath: z.string().optional(),
  solidSvgPath: z.string().optional(),
  transparentSvgPath: z.string().optional(),
  sourceImagePath: z.string().optional(),
  metadataPath: z.string(),
  reviewPath: z.string().optional(),
  accepted: z.boolean(),
  rejected: z.boolean(),
  notes: z.string().optional(),
  createdAt: z.string()
});

export const assetRecordSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  category: assetCategorySchema,
  status: assetStatusSchema,
  locked: z.boolean(),
  lockedVersionId: z.string().optional(),
  description: z.string().optional(),
  designIntent: z.string().optional(),
  currentVersionId: z.string().optional(),
  versions: z.array(assetVersionSchema),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const lockRecordSchema = z.object({
  assetId: z.string(),
  lockedVersionId: z.string(),
  lockedAt: z.string(),
  lockLevel: lockLevelSchema,
  rules: z.array(z.string())
});

export const runRecordSchema = z.object({
  runId: z.string(),
  assetId: z.string(),
  versionId: z.string(),
  action: z.string(),
  createdAt: z.string(),
  status: z.string(),
  notes: z.string().optional()
});

export const exportRecordSchema = z.object({
  exportId: z.string(),
  assetId: z.string(),
  versionId: z.string(),
  path: z.string(),
  createdAt: z.string()
});

export const registrySchema = z.object({
  assets: z.array(assetRecordSchema)
});

export const locksRegistrySchema = z.record(z.string(), lockRecordSchema);
export const runsRegistrySchema = z.array(runRecordSchema);
export const exportsRegistrySchema = z.array(exportRecordSchema);

export type AssetVersion = z.infer<typeof assetVersionSchema>;
export type AssetRecord = z.infer<typeof assetRecordSchema>;
export type LockRecord = z.infer<typeof lockRecordSchema>;
export type RunRecord = z.infer<typeof runRecordSchema>;
export type ExportRecord = z.infer<typeof exportRecordSchema>;

export type EngineConfig = {
  rootDir: string;
  openAiApiKey?: string;
  imageModel: string;
  textModel: string;
  defaultSize: `${number}x${number}`;
  defaultSolidBackground: string;
  defaultOutputFormat: "png";
};

export type GenerateImageInput = {
  prompt: string;
  outputPath: string;
  background?: "transparent" | "opaque" | "auto";
  sourceImagePath?: string;
};

export type ImageResult = {
  path: string;
  model: string;
  size: string;
};

export type ReviewImageInput = {
  imagePath: string;
  prompt: string;
};

export type ReviewResult = {
  markdown: string;
};

export type Metadata = {
  runId: string;
  assetId: string;
  versionId: string;
  model: string;
  size: string;
  createdAt: string;
  promptHash: string;
  fullPromptPath: string;
  solidPath?: string;
  transparentPath?: string;
  reviewPath?: string;
  designSystemHash: string;
  baselinePromptHash: string;
  lockRulesApplied: boolean;
};
