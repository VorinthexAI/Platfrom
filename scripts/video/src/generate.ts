import { mkdir } from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import { nanoid } from "nanoid";
import { atomicWrite, ensureVideoRuntime } from "./filesystem";
import { OpenRouterVideoClient } from "./openrouter";
import { buildVideoPrompt } from "./prompts";
import { VideoRegistryStore } from "./registry";
import type { AspectRatio, Resolution, VideoConfig } from "./types";
import { hashText, rel } from "./utils";
import type { VideoTarget } from "./targets";

export async function generateForTarget(config: VideoConfig, target: VideoTarget, options: {
  prompt?: string;
  variants?: number;
  duration?: number;
  resolution?: Resolution;
  aspectRatio?: AspectRatio;
  referenceImage?: string;
  generateAudio?: boolean;
}): Promise<void> {
  await ensureVideoRuntime(config.rootDir);
  const registry = new VideoRegistryStore(config.rootDir);
  const client = new OpenRouterVideoClient(config);
  const asset = await registry.createAsset({
    slug: `${target.category}-${target.slug}`,
    name: target.name,
    category: target.category,
    entityId: target.entityId,
    description: target.description
  });

  const variants = options.variants ?? config.variants;
  for (let index = 0; index < variants; index += 1) {
    const nextNumber = Math.max(0, ...asset.versions.map((version) => version.version)) + 1;
    const versionId = `v${nextNumber}`;
    const runId = nanoid(12);
    const outputDir = path.join(config.rootDir, "outputs/videos", target.category, target.slug, versionId);
    const runDir = path.join(config.rootDir, "runs", runId);
    await mkdir(outputDir, { recursive: true });
    await mkdir(runDir, { recursive: true });

    const fullPrompt = buildVideoPrompt(config, target, options.prompt);
    const promptPath = path.join(outputDir, "prompt.md");
    const videoPath = path.join(outputDir, `${target.slug}-${versionId}.mp4`);
    const metadataPath = path.join(outputDir, "metadata.json");
    await atomicWrite(promptPath, fullPrompt);

    console.log(chalk.cyan(`Generating video ${target.category}/${target.slug} ${versionId}`));
    try {
      const submitted = await client.generate({
        model: config.model,
        prompt: fullPrompt,
        duration: options.duration ?? config.duration,
        resolution: options.resolution ?? config.resolution,
        aspectRatio: options.aspectRatio ?? config.aspectRatio,
        generateAudio: options.generateAudio ?? config.generateAudio,
        referenceImage: options.referenceImage
      });
      const completed = await client.waitForCompletion(submitted);
      await client.download(completed, videoPath);

      const metadata = {
        runId,
        target,
        provider: "openrouter",
        providerJobId: completed.id,
        model: config.model,
        duration: options.duration ?? config.duration,
        resolution: options.resolution ?? config.resolution,
        aspectRatio: options.aspectRatio ?? config.aspectRatio,
        generateAudio: options.generateAudio ?? config.generateAudio,
        promptHash: hashText(fullPrompt),
        promptPath: rel(config.rootDir, promptPath),
        videoPath: rel(config.rootDir, videoPath),
        createdAt: new Date().toISOString()
      };
      await atomicWrite(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
      await registry.addVersion(asset, {
        prompt: options.prompt ?? "",
        fullPrompt,
        model: config.model,
        duration: metadata.duration,
        resolution: metadata.resolution,
        aspectRatio: metadata.aspectRatio,
        providerJobId: completed.id,
        status: "completed",
        videoPath: metadata.videoPath,
        metadataPath: rel(config.rootDir, metadataPath)
      });
      console.log(chalk.green(`Generated ${metadata.videoPath}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await atomicWrite(metadataPath, `${JSON.stringify({ runId, target, status: "failed", error: message, createdAt: new Date().toISOString() }, null, 2)}\n`);
      await registry.addVersion(asset, {
        prompt: options.prompt ?? "",
        fullPrompt,
        model: config.model,
        duration: options.duration ?? config.duration,
        resolution: options.resolution ?? config.resolution,
        aspectRatio: options.aspectRatio ?? config.aspectRatio,
        status: "failed",
        metadataPath: rel(config.rootDir, metadataPath),
        error: message
      });
      console.error(chalk.red(`Failed ${target.slug}: ${message}`));
    }
  }
}
